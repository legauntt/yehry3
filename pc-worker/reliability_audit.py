"""Reproducible request-level reliability metrics, including recovered failures."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from common import load, save, utc
from failure_evidence import historical_errors


def timestamp(value):
    if not value: return None
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def metrics(prompts, at=None, hours=72):
    end = timestamp(at) if at else datetime.now(timezone.utc)
    start = end - timedelta(hours=hours)
    def within(value):
        parsed = timestamp(value)
        return parsed is not None and start <= parsed <= end
    submitted = [p for p in prompts if within(p.get('confirmedAt'))]
    attempted = [p for p in submitted if any(h.get('action') == 'claimed' for h in p.get('history', []))]
    affected = [p for p in attempted if any(h.get('status') == 'failed' for h in p.get('history', []))]
    events = [h for p in prompts for h in p.get('history', []) if h.get('status') == 'failed' and within(h.get('at'))]
    claims = [h for p in prompts for h in p.get('history', []) if h.get('action') == 'claimed' and within(h.get('at'))]
    daily = {}
    for p in attempted:
        day = p['confirmedAt'][:10]
        row = daily.setdefault(day, {'attempted': 0, 'affected': 0})
        row['attempted'] += 1
        row['affected'] += p in affected
    return {'window_start': start.isoformat(), 'window_end': end.isoformat(), 'hours': hours,
            'confirmed': len(submitted), 'attempted': len(attempted), 'excluded_unattempted': len(submitted)-len(attempted),
            'affected': len(affected), 'request_failure_rate': len(affected)/len(attempted) if attempted else None,
            'failure_events': len(events), 'claims': len(claims), 'attempt_failure_rate': len(events)/len(claims) if claims else None,
            'published_after_failure': sum(p['status'] == 'published' for p in affected),
            'current_statuses': dict(Counter(p['status'] for p in attempted)), 'daily_utc': daily,
            'earliest_retained_confirmation': min((p['confirmedAt'] for p in prompts if p.get('confirmedAt')), default=None),
            'history_at_limit': [p['id'] for p in prompts if len(p.get('history', [])) >= 100],
            'affected_ids': [p['id'] for p in affected]}


def categories(text):
    text = text.casefold()
    rules = {
        'musical_spacing': ('long instrumental', 'too much instrumental'),
        'unfinished_ending': ('ending needs completion', 'final vocal has no complete ending'),
        'vocal_dropout': ('missing vocal phrase', 'missing phrase'),
        'voice_validation': ('insufficient mutually voiced', 'pitch error'),
        'windows_io': ('permissionerror', 'permission denied', 'winerror 5', 'winerror 32'),
        'unicode': ('unicodedecodeerror', "'charmap' codec"),
        'planner_format': ('invalid music settings', 'invalid planning result'),
        'planner_auth': ('invalid_organization', '401 unauthorized'),
        'missing_material_or_capability': ('not available', 'no basis song', 'none was supplied', 'dialogue is unavailable', 'thematic rewrite', 'no existing automatic recipe'),
        'dependency': ('project dependencies need attention', 'runtime hash', 'voice-runtime'),
    }
    return [name for name, terms in rules.items() if any(term in text for term in terms)]


def shepherd_outcomes(config, prompts):
    """Audit retained consultations against their controller actions, not eventual publication alone."""
    root = Path(config['state_dir'])
    ledger_path = root / 'monitor' / 'ledger.json'
    ledger = load(ledger_path).get('requests', {}) if ledger_path.exists() else {}
    rows = []
    for prompt in prompts:
        ident = prompt['id']; folder = root / 'jobs' / ident / 'shepherd'
        journals = ([folder / 'journal.json'] if (folder / 'journal.json').is_file() else []) + sorted(folder.glob('guided-*/journal.json'))
        for path in journals:
            journal = load(path); decision = journal.get('decision') or {}
            input_path = path.with_name('input.json'); inputs = load(input_path) if input_path.exists() else {}
            steer = inputs.get('consultation_id')
            attempts = [a for a in ledger.get(ident, {}).get('attempts', [])
                        if (a.get('steer') == steer and a.get('category') in ('shepherd', 'replan'))]
            # Failed/interrupted consultations have no supported decision to credit.
            if decision.get('action') not in ('replan', 'retry_saved_work'): attempts = []
            outcome = 'no_queue_action'
            if attempts:
                after = min(a.get('at', '') for a in attempts)
                events = [h for h in prompt.get('history', []) if h.get('at', '') >= after]
                queued = next((i for i, h in enumerate(events) if h.get('action') == 'status' and h.get('status') == 'queued'), None)
                if queued is None: outcome = 'unverified_action'
                else:
                    terminal = next((h for h in events[queued+1:] if h.get('status') in ('failed', 'published', 'canceled')
                                     or h.get('action') == 'shepherd'), {})
                    outcome = {'failed': 'failed_again', 'published': 'published_without_another_failure',
                               'canceled': 'canceled'}.get(terminal.get('status'), 'superseded' if terminal else 'pending')
            rows.append({'id': ident, 'prompt': prompt.get('prompt'), 'kind': 'guided' if steer else 'automatic',
                         'consultation': steer, 'action': decision.get('action', journal.get('status')),
                         'outcome': outcome, 'current_status': prompt.get('status'), 'journal': str(path)})
    return {'retained_consultations': len(rows), 'by_kind': dict(Counter(row['kind'] for row in rows)),
            'decisions': dict(Counter(row['action'] for row in rows)), 'outcomes': dict(Counter(row['outcome'] for row in rows)),
            'requests': rows,
            'limits': 'Retained journals and queue history only. Publication after a later failure or separate repair is not credited to the consultation.'}


def audit(config, snapshot, hours=72):
    prompts = snapshot['prompts']; summary = metrics(prompts, snapshot['at'], hours)
    rows = []
    for p in prompts:
        if p['id'] not in summary['affected_ids']: continue
        retained = historical_errors(config, p['id'])
        directory = Path(config['state_dir']) / 'jobs' / p['id']
        text = p.get('workerError', '') + '\n' + '\n'.join(r['text'] for r in retained)
        for path in directory.glob('plan-before-*.json'):
            text += '\n' + load(path).get('plan', {}).get('explanation', '')
        for path in directory.glob('worker-error.json'): text += '\n' + load(path).get('message', '')
        rows.append({'id': p['id'], 'title': p.get('result', {}).get('title', p['prompt']),
                     'status': p['status'], 'failures': sum(h.get('status') == 'failed' for h in p.get('history', [])),
                     'categories': categories(text), 'evidence': retained, 'directory': str(directory)})
    return {'at': snapshot['at'], 'metrics': summary, 'category_request_counts': dict(Counter(c for row in rows for c in row['categories'])),
            'requests': rows, 'shepherd': shepherd_outcomes(config, prompts)}


def markdown(report):
    m = report['metrics']
    lines = ['# Distonyc reliability audit', '', f"Window: {m['window_start']} through {m['window_end']}.", '',
             f"{m['affected']} of {m['attempted']} attempted requests hit Needs Attention ({m['request_failure_rate']:.1%}); "
             f"{m['failure_events']} failure events across {m['claims']} claims. "
             f"{m['published_after_failure']} affected requests subsequently published.", '',
             f"Current attempted-request states: {m['current_statuses']}. Excluded {m['excluded_unattempted']} unattempted request(s).", '',
             f"Earliest retained confirmation: {m['earliest_retained_confirmation']}. "
             'This covers all retained confirmed requests in the requested window, not necessarily deleted records or standalone experiments. '
             'Server history proves failure counts; old local logs sometimes retain only the latest error or lack per-attempt timestamps. '
             'Cause counts overlap and are evidence-based lower bounds, not a partition of the failure events.', '',
             '| Cause | Affected requests with retained evidence |', '| --- | ---: |']
    lines += [f'| {name} | {count} |' for name, count in sorted(report['category_request_counts'].items())]
    lines += ['', '| Request | Failures | Current state | Retained causes | Evidence |', '| --- | ---: | --- | --- | --- |']
    for row in report['requests']:
        title = row['title'].replace('|', '/').replace('\n', ' ')
        lines.append(f"| {title} | {row['failures']} | {row['status']} | {', '.join(row['categories']) or 'Insufficient retained detail'} | [{row['id'][-8:]}](<{row['directory']}>) |")
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--hours', type=int, default=72)
    args = parser.parse_args()
    report = audit(load(args.config), load(args.snapshot), args.hours)
    save(args.output / 'report.json', report)
    (args.output / 'report.md').write_text(markdown(report), encoding='utf-8')
    import json
    print(json.dumps({'metrics': report['metrics'], 'categories': report['category_request_counts']}))


if __name__ == '__main__': main()
