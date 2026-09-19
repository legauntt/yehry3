"""Report Dehaka's replies, queue actions, outcomes and raw PC logs to the private Backstage thread.

The feed is advisory: failures never block triage, and each message is keyed so a retried pass
cannot duplicate it. Logs are admin-only, secret-redacted tails of files already on this PC.
"""
import hashlib, json, re, time, urllib.error, urllib.parse
from pathlib import Path

LOG_CHARS = 48000
TOTAL_CHARS = 220000
SENT_LIMIT = 80
JOB_LOGS = ('worker-error.json', 'renderer-error.json', 'renderer.log', 'planner.log', 'candidates.log',
            'vocal-recovery.log', 'upload.log', 'progress.json', 'delivery-check.json')
SECRETS = (re.compile(r'(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]{12,}'),
           re.compile(r'(?i)\b(authorization|password|token|secret|api[_-]?key)(["\']?\s*[:=]\s*["\']?)[^\s"\',}]{6,}'),
           re.compile(r'\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})'))


def redact(text):
    text = SECRETS[0].sub(r'\1 [redacted]', text)
    text = SECRETS[1].sub(r'\1\2[redacted]', text)
    return SECRETS[2].sub('[redacted]', text)


def tail(path, limit=LOG_CHARS):
    path = Path(path)
    size = path.stat().st_size
    with path.open('rb') as handle:
        handle.seek(max(0, size - limit * 2))
        text = handle.read().decode('utf-8', errors='replace')
    truncated = size > limit * 2 or len(text) > limit
    return redact(text[-limit:]), truncated


def consultation_dir(context, request_id):
    return Path(context.get('directory', '')) / 'shepherd' / ('guided-' + hashlib.sha256(request_id.encode()).hexdigest()[:16])


def raw_logs(context, request_id=None):
    """As much raw evidence as fits: Dehaka's own consultation first, then the job's saved logs."""
    if not context.get('directory'): return []
    directory = Path(context['directory'])
    paths = []
    if request_id:
        consulted = consultation_dir(context, request_id)
        paths += [(consulted / name, 'dehaka/' + name) for name in ('decision.json', 'journal.json', 'run.log')]
    paths += [(directory / name, name) for name in JOB_LOGS]
    failures = sorted((directory / 'failures').glob('*.json'), key=lambda path: path.stat().st_mtime)[-1:] if (directory / 'failures').is_dir() else []
    paths += [(path, 'failures/' + path.name) for path in failures]
    logs, total = [], 0
    for path, name in paths:
        if not path.is_file() or total >= TOTAL_CHARS: continue
        try: text, truncated = tail(path, min(LOG_CHARS, TOTAL_CHARS - total))
        except OSError: continue
        if not text.strip(): continue
        logs.append({'name': name, 'text': text, 'truncated': truncated}); total += len(text)
    stage_log = context.get('stage_log')
    if stage_log and total < TOTAL_CHARS:
        text = redact(stage_log[-min(LOG_CHARS, TOTAL_CHARS - total):])
        logs.append({'name': 'troofs/' + str(context.get('state', {}).get('stage') or 'stage') + '.log', 'text': text, 'truncated': True})
    return logs


def post(api, entry, prompt, key, logs=None, **fields):
    """Append one keyed thread entry; an unsent key is retried on the next monitor pass."""
    sent = entry.setdefault('dehaka_sent', [])
    if key in sent or getattr(api, 'dehaka_unavailable', False): return False
    body = {'key': key, 'version': prompt.get('version'), 'logs': logs or [],
            **{name: value for name, value in fields.items() if value}}
    path = '/admin/prompts/' + urllib.parse.quote(prompt['id'], safe='') + '/dehaka'
    try: api.call(path, 'POST', body)
    except urllib.error.HTTPError as error:
        # An older Chairlift has no thread endpoint; stop trying for this pass.
        if error.code in (404, 405): api.dehaka_unavailable = True
        entry['dehaka_error'] = f'HTTP {error.code}'
        return False
    except (urllib.error.URLError, OSError, ValueError) as error:
        entry['dehaka_error'] = str(error)[:300]
        return False
    sent.append(key); del sent[:-SENT_LIMIT]
    entry.pop('dehaka_error', None)
    entry.setdefault('dehaka_since', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    return True


def reply(api, entry, prompt, context, directive, decision, category, action, reason):
    """Answer each operator steer exactly once, whether a model was consulted or coded policy decided."""
    request_id = directive['requestId']
    if decision:
        fields = {'author': 'dehaka', 'kind': 'reply', 'action': decision['action'], 'text': decision['reason'] or 'No reason given.',
                  'evidence': decision.get('evidence')}
    elif action == 'retry':
        fields = {'author': 'dehaka', 'kind': 'reply', 'action': 'coded_repair',
                  'text': f'Known cause ({category}); the coded repair applies without a consultation. {reason} Your guidance is on record.'}
    else:
        fields = {'author': 'dehaka', 'kind': 'reply', 'action': 'review',
                  'text': f'This cause ({category}) is outside what guidance can authorize. {reason} Adjust the saved inputs or code, then steer again.'}
    return post(api, entry, prompt, 'reply:' + request_id, raw_logs(context, request_id), requestId=request_id, **fields)


def latest_failure(prompt):
    return next((item for item in reversed(prompt.get('history') or []) if item.get('status') == 'failed'), None)


def failure(api, entry, prompt, context):
    """After Dehaka has spoken, report each later failure with fresh raw logs so the operator can steer again."""
    since, failed = entry.get('dehaka_since'), latest_failure(prompt)
    if not since or not failed or str(failed.get('at', '')) <= since: return False
    return post(api, entry, prompt, 'failed:' + str(failed['at']), raw_logs(context), author='worker', kind='outcome', action='failed',
                text='Stopped again: ' + str(prompt.get('workerError') or 'unknown failure')[:5000])


def note(api, entry, prompt, key, action, text):
    if not entry.get('dehaka_since'): return False
    return post(api, entry, prompt, key, author='monitor', kind='action', action=action, text=text)


def outcome(api, entry, prompt, context=None):
    if not entry.get('dehaka_since') or prompt['status'] not in ('published', 'canceled'): return False
    text = ('Published and verified. ' + str(prompt.get('publishedUrl') or '')).strip() if prompt['status'] == 'published' else 'Canceled; the monitor will take no further action.'
    return post(api, entry, prompt, f"{prompt['status']}:{prompt.get('version')}", raw_logs(context) if context else [],
                author='worker', kind='outcome', action=prompt['status'], text=text)
