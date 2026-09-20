"""Report the settled paid music ledger to Chairlift so its budget counter matches.

Both sides reserve a conservative $1.00/minute before the only billable call while Eleven
Music bills $0.15/minute. reconcile_paid_music.py settles this PC's ledger against the
provider's credit history; Chairlift cannot do that itself, because the ElevenLabs
credential is deliberately PC-only. This sends the settled cost per ledger row over the
existing admin API, and Chairlift maps those rows onto the requests that authorized them.

Only request ids and settled amounts are sent: no lyrics, prompts, audio, receipts,
provider identifiers or credentials. The endpoint can only ever lower the counter.

Run it through paid-budget-reconcile.ps1, which loads the monitor credential the same way
monitor-run.ps1 does; the password is read from the environment, never the command line.
"""
import argparse
import json
import os
from pathlib import Path

from common import load
from paid_music import charged_cents, policy, validate_ledger
from queue_monitor import AdminAPI


def settlement_rows(ledger):
    """One row per ledger entry: what it settled at, and whether that is final."""
    rows = []
    for row in ledger['requests']:
        retry = row.get('operator_retry')
        settled = charged_cents(row) + (charged_cents(retry) if retry else 0)
        pending = row.get('reconciled_cents') is None or (retry is not None and retry.get('reconciled_cents') is None)
        rows.append({'id': row['id'], 'settled': settled, 'pending': bool(pending)})
    return rows


def push(config_path, policy_path, password):
    config = load(config_path)
    ledger = load(policy(policy_path)['ledger'])
    validate_ledger(ledger)
    rows = settlement_rows(ledger)
    api = AdminAPI(config['api'], password)
    return api.call('/admin/music-budget/reconcile', 'POST', {'version': 1, 'rows': rows})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--policy', required=True, type=Path)
    args = parser.parse_args()
    password = os.environ.pop('DISTONYC_MONITOR_PASSWORD', '')
    if not password:
        raise ValueError('The monitor DPAPI credential was not loaded; run paid-budget-reconcile.ps1')
    result = push(args.config, args.policy, password)
    del password
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
