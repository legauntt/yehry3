"""Permit a pinned vocal warning while retaining every delivery verification."""
import math
from pathlib import Path

from common import inside, load, sha

MESSAGE = 'A vocal phrase may be missing.'
INPUTS = ('selected-vocals.wav', 'selected-backing.wav', 'matched-vocals.wav')


def warning_is_valid(work):
    work = Path(work)
    policy_path = work / 'vocal-quality-policy.json'
    report_path = work / 'mix-results.json'
    if not report_path.exists():
        return False
    if load(report_path).get('complete_movement_pcm_preserved'):
        return multipart_warning_is_valid(work, load(report_path))
    if not policy_path.exists(): return False
    policy, report = load(policy_path), load(report_path)
    legacy = policy.get('version') == 1 and policy.get('after_bounded_repair') is True
    current = (policy.get('version') == 2 and policy.get('recovery_disposition') in
               ('bounded_repair_exhausted', 'not_supported_for_voice_model'))
    if not (legacy or current):
        return False
    if policy.get('audio_changed') is not False or policy.get('other_integrity_checks_retained') is not True:
        return False
    if any(policy.get('inputs_sha256', {}).get(name) != sha(work / name) for name in INPUTS):
        return False
    longest = report.get('longest_missing_vocal_run_seconds')
    if not isinstance(longest, (int, float)) or not math.isfinite(longest) or longest <= .4:
        return False
    issues = [issue for issue in report.get('qualityIssues', []) if issue.get('code') == 'vocal_dropout']
    return len(issues) == 1 and isinstance(issues[0].get('seconds'), (int, float)) and issues[0]['seconds'] > .4


def multipart_warning_is_valid(work, report):
    """Carry only already verified, hash-pinned section warnings into assembly."""
    from longform import aggregate_issues
    parts = report.get('movement_provenance', [])
    if not 3 <= len(parts) <= 6 or report.get('complete_movement_pcm_preserved') is not True:
        return False
    reports = []
    for part in parts:
        result = part.get('result', {})
        if result.get('status') != 'verified': return False
        source = inside(result['work_path'], Path(work).parent)
        if source == Path(work): return False
        if sha(source/'mix-results.json') != part.get('mix_report_sha256'): return False
        saved = load(source/'mix-results.json')
        if saved.get('status') != 'completed' or not saved.get('voice_checks', {}).get('passed'):
            return False
        if saved.get('movement_provenance'): return False
        longest = saved.get('longest_missing_vocal_run_seconds')
        if not isinstance(longest, (int, float)) or not math.isfinite(longest) or longest < 0:
            return False
        if longest > .4 and not warning_is_valid(source): return False
        files = saved.get('files', [])
        if {Path(item.get('file', item.get('path'))).suffix for item in files} != {'.wav', '.mp3'}:
            return False
        for item in files:
            path = inside(item.get('file', item.get('path')), Path(work)/'private-movements')
            if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']: return False
        reports.append(saved)
    issues, _ = aggregate_issues(reports)
    return (report.get('qualityIssues') == issues
            and report.get('longest_missing_vocal_run_seconds') == max(r['longest_missing_vocal_run_seconds'] for r in reports)
            and any(i['code'] == 'vocal_dropout' for i in issues))


def adapt(engine):
    """Wrap the engine verifier, relaxing only its named dropout guard."""
    original = engine.verify_work

    def verify_work(work, output_dir=None):
        allow = warning_is_valid(work)
        original_need = engine.need

        def need(condition, message):
            if not condition and message == MESSAGE and allow:
                return None
            return original_need(condition, message)

        engine.need = need
        try:
            return original(work, output_dir)
        finally:
            engine.need = original_need

    engine.verify_work = verify_work
    return engine
