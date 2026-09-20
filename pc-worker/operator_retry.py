"""Version-checked admin retry for one request whose failure cause an operator resolved.

The queue monitor only retries causes it can classify. A cause fixed outside the worker
- a reconciled paid music budget, a restored credential, freed disk - leaves the request
in Needs Attention with no automatic path back. This requeues exactly one request through
the same admin API and version check the monitor uses, and records the attempt in the
monitor's ledger so automatic retry budgets stay honest.

It never generates audio and never authorizes a repeat paid provider call: a request whose
paid reservation was already spent still stops in paid_music.compose for reconciliation.

Run it through operator-retry.ps1, which loads the monitor credential the same way
monitor-run.ps1 does; the password is read from the environment and never passed on
the command line.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

from common import load, save, utc
from queue_monitor import POLICY_VERSION, AdminAPI


def find(api, wanted):
    for prompt in api.prompts():
        if wanted in (prompt.get('id'), prompt.get('songId')):
            return prompt
    raise ValueError('No request matches ' + wanted)


def record(config, prompt, reason):
    """Append to the monitor ledger so this counts against the automatic retry budget."""
    path = Path(config['state_dir']) / 'monitor' / 'ledger.json'
    ledger = load(path) if path.exists() else {'version': 1, 'requests': {}, 'history': []}
    entry = ledger['requests'].setdefault(prompt['id'], {'first_seen': utc(), 'attempts': []})
    entry.setdefault('attempts', []).append({
        'at_epoch': int(time.time()), 'at': utc(), 'category': 'operator',
        'signature': entry.get('signature'), 'policy_version': POLICY_VERSION, 'reason': reason})
    entry['next_action'] = 'Queued by an operator after the failure cause was resolved.'
    save(path, ledger)


def retry(config_path, wanted, reason, password):
    if not isinstance(reason, str) or not 12 <= len(reason.strip()) <= 2000:
        raise ValueError('Record why this request may run again')
    config = load(config_path)
    api = AdminAPI(config['api'], password)
    prompt = find(api, wanted)
    if prompt['status'] != 'failed':
        raise ValueError('Only a failed request can be requeued; this one is ' + str(prompt['status']))
    if prompt.get('workerActive'):
        raise ValueError('The worker still owns this request; wait for its lease to end')
    updated = api.retry(prompt)  # Version-checked: a concurrent change refuses with 409.
    record(config, prompt, reason.strip())
    return {'id': prompt['id'], 'songId': prompt.get('songId'), 'from_version': prompt['version'],
            'version': updated['version'], 'status': updated['status'], 'at': utc(), 'reason': reason.strip()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--request', required=True, help='request id or songId')
    parser.add_argument('--reason', required=True)
    args = parser.parse_args()
    password = os.environ.pop('DISTONYC_MONITOR_PASSWORD', '')
    if not password:
        raise ValueError('The monitor DPAPI credential was not loaded; run operator-retry.ps1')
    result = retry(args.config, args.request, args.reason, password)
    del password
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
