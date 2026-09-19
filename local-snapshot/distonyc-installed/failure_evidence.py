"""Read saved failure evidence without loading models or changing production inputs."""
import re
from pathlib import Path

from common import inside, load
from composition_ending import active_identifier


def tail(path, limit=24000):
    path = Path(path)
    if not path.is_file(): return ''
    with path.open('rb') as handle:
        handle.seek(max(0, path.stat().st_size - limit))
        return handle.read(limit).decode('utf-8', errors='replace')


def selected_work(config, directory):
    directory = Path(directory)
    root = Path(config['settings']['studio_dir']).parent
    result = directory / 'render-result.json'
    if result.exists() and load(result).get('work_path'):
        return inside(load(result)['work_path'], root)
    request_file = directory / 'render-request.json'
    if not request_file.exists(): return None
    request = load(request_file)
    sectional = directory / 'sectional-repair.json'
    if sectional.exists():
        from sectional_repair import selected_work as selected_section
        return selected_section(request, load(sectional))
    sparse_repair = directory / 'sparse-vocal-repair.json'
    if sparse_repair.exists():
        from sparse_vocal_repair import verify
        child = verify(request, load(sparse_repair))
        return inside(root / ('troofs-desktop-' + active_identifier(child)), root)
    length_repair = directory / 'lyric-length-repair.json'
    if length_repair.exists():
        from lyric_length_repair import verify
        child = verify(request, load(length_repair))
        return inside(root / ('troofs-desktop-' + active_identifier(child)), root)
    repair_file = directory / 'ending-repair.json'
    repair = load(repair_file) if repair_file.exists() else None
    return inside(root / ('troofs-desktop-' + active_identifier(request, repair)), root)


def evidence(config, ident, error=''):
    directory = inside(Path(config['state_dir']) / 'jobs' / ident, Path(config['state_dir']) / 'jobs')
    data = {'directory': str(directory), 'error': str(error), 'has_plan': (directory / 'plan.json').exists(),
            'has_request': (directory / 'render-request.json').exists(),
            'ending_attempted': (directory / 'ending-repair.json').exists(),
            'vocal_warnings_enabled': config.get('vocal_dropout_warnings', False)}
    messages = [str(error)]
    for name in ('worker-error.json', 'renderer-error.json'):
        path = directory / name
        if path.exists():
            saved = load(path)
            data[name] = saved
            messages.append(str(saved.get('message', '')))
    result = directory / 'render-result.json'
    if result.exists(): data['has_result'] = load(result).get('status') == 'verified'
    if data['has_request']:
        data['voice_model'] = load(directory / 'render-request.json').get('voice_model', 'v6')
    work = selected_work(config, directory)
    if work:
        data['work'] = str(work)
        for name, key in (('desktop-status.json', 'state'), ('vocal-repair/status.json', 'voice_repair')):
            if (work / name).exists(): data[key] = load(work / name)
        state = data.get('state', {})
        # Completed journals/logs describe old failures, not a new publication error.
        if state.get('status') == 'failed':
            messages.append(str(state.get('error') or ''))
            stage = state.get('stage', '')
            if re.fullmatch(r'[a-z][a-z0-9-]*', stage):
                for path in sorted((work / 'desktop-logs').glob(stage + '*'), key=lambda p: p.stat().st_mtime)[-1:]:
                    excerpt = tail(path)
                    data['stage_log'] = excerpt
                    # Keep the log for diagnosis, but classify the final failing traceback,
                    # not successful telemetry or recovered errors preceding it.
                    marker = 'Traceback (most recent call last):'
                    failure = excerpt.rfind(marker)
                    messages.append(excerpt[failure:] if failure >= 0 else excerpt)
    if not data['has_request']:
        # Include structured invocation errors only; omit generated lyrics and credentials.
        from planner import invocation_feedback
        if (directory / 'planner.log').exists():
            data['planner_error'] = invocation_feedback(RuntimeError(str(error) or 'Saved planner diagnostics'), directory / 'planner.log')
            messages.append(data['planner_error'])
        journal = directory / 'planner-result-attempts.json'
        data['planner_attempts'] = len(load(journal).get('attempts', [])) if journal.exists() else 0
        data['saved_planner_output'] = (directory / 'planner-result.json').exists()
    data['diagnostic_error'] = '\n'.join(dict.fromkeys(m for m in messages if m))[-32000:]
    return data


def historical_errors(config, ident):
    """All retained errors for an audit; timestamps may be absent in old append-only logs."""
    directory = inside(Path(config['state_dir']) / 'jobs' / ident, Path(config['state_dir']) / 'jobs')
    paths = list(directory.glob('*error*.json')) + list(directory.glob('*recovery*.json'))
    paths += list((directory / 'failures').glob('*.json'))
    paths += [directory / 'renderer.log', directory / 'planner.log']
    work = selected_work(config, directory)
    if work: paths += list((work / 'desktop-logs').glob('*.log'))
    rows = []
    pattern = re.compile(r'(?:Error:|Exception:|Missing vocal phrase|Long instrumental|Too much instrumental|Ending needs completion|invalid_organization)')
    for path in paths:
        if not path.is_file(): continue
        for line in tail(path, 256000).splitlines():
            if pattern.search(line) and 'agent_message' not in line:
                rows.append({'path': str(path), 'text': line.strip()[:1800]})
    return rows
