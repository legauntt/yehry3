"""Wait for one request and delegate the completion contract to delivery_check."""
import argparse
import json
import os
import time

from common import load
from queue_monitor import AdminAPI
from operator_retry import find
from delivery_check import verify_delivery


def watch(config, api, ident, timeout):
    deadline, previous = time.monotonic() + timeout, None
    while time.monotonic() < deadline:
        prompt = find(api, ident)
        state = {key: prompt.get(key) for key in ('id', 'status', 'workerProgress', 'workerError')}
        if prompt['status'] == 'published':
            state['delivery'] = verify_delivery(config, prompt)
        if state != previous:
            print(json.dumps(state, ensure_ascii=False), flush=True)
            previous = state
        if prompt['status'] in ('failed', 'canceled'):
            return 2
        if state.get('delivery', {}).get('status') == 'verified':
            return 0
        time.sleep(30)
    raise TimeoutError('Request remains unfinished; saved work and scheduled jobs are retained')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--request-id', required=True)
    parser.add_argument('--timeout', type=int, default=7200)
    args = parser.parse_args()
    if not 30 <= args.timeout <= 14400: parser.error('Use a 30–14400 second deadline')
    config = load(args.config)
    password = os.environ.pop('DISTONYC_MONITOR_PASSWORD', '')
    if not password: raise ValueError('Load the monitor DPAPI credential first')
    api = AdminAPI(config['api'], password)
    del password
    raise SystemExit(watch(config, api, args.request_id, args.timeout))
