"""Authorize delivery of one hash-pinned, intentionally sparse paid performance.

This never generates audio or changes the frozen song. It records an operator
decision only after the paid receipt, plan, request, separated stems and measured
coverage all match the retained failed job. The arrangement adapter consumes the
record while leaving every other check active.
"""
import argparse
import math
import re
from pathlib import Path

from common import fingerprint, load, save, sha, utc
from composition_ending import work_path

REPORT = 'sparse-vocal-intent-policy.json'
INPUTS = ('desktop-job.json', 'track.json', 'distonyc-configured.json',
          'selected-mix.wav', 'selected-vocals.wav', 'selected-backing.wav',
          'paid-original.mp3', 'paid-request.json', 'paid-inputs.json',
          'paid-receipt.json', 'arrangement-checks.json')
PAID_REINTERPRETATION_INPUTS = INPUTS + ('source-material.json',)
LOCAL_INPUTS = ('desktop-job.json', 'track.json', 'distonyc-configured.json',
                'selected-mix.wav', 'selected-vocals.wav', 'selected-backing.wav',
                'source-material.json', 'arrangement-checks.json')
SPOKEN_JAZZ_SOURCE_SHA256 = 'd0c85e6f241fe1cb959c011de784ba788c54e7164a5c609ff1cfa7c36bb244aa'


def lyric_words(lyrics):
    body = '\n'.join(line for line in lyrics.splitlines()
                     if not re.fullmatch(r'\s*\[[^\]]+\]\s*', line))
    return re.findall(r'[a-z]+', body.casefold())


def validate_intent(request, planning):
    plan = request.get('plan', {})
    brief = planning.get('brief', {})
    prompt = str(brief.get('prompt', '')).casefold()
    arrangement = str(plan.get('arrangement', '')).casefold()
    words = lyric_words(str(plan.get('lyrics', '')))
    if request.get('music_backend') == 'eleven_music' and plan.get('recipe') == 'new':
        if not words or any(re.fullmatch(r'y+e+a+h+', word) is None for word in words):
            raise ValueError('The frozen lyrics are not the reviewed yeah-only sparse performance')
        if 'breath' not in prompt or 'yeah' not in prompt or 'breath' not in arrangement:
            raise ValueError('The confirmed brief and frozen arrangement do not explicitly request sparse breathing')
        if Path(request.get('directory', '')).name != request.get('prompt_id'):
            raise ValueError('The saved request directory does not match the request ID')
        return 'paid_original'
    details = brief.get('details', {})
    remix = details.get('remixSource', {})
    exact_source = (plan.get('recipe') == 'reinterpretation' and request.get('voice_model') == 'v8'
        and remix.get('title') == 'Yeah After Midnight'
        and remix.get('sha256') == SPOKEN_JAZZ_SOURCE_SHA256
        and 'heavy breathing' in prompt and 'smooth jazz' in prompt)
    local_source = exact_source and details.get('musicBackend') == 'local'
    movement = request.get('suite_progress', {})
    index, count = movement.get('index'), movement.get('count')
    if count == 3 and index in (0, 1, 2):
        number = index + 1
        prompt_id = request.get('prompt_id', '')
        sparse_attempt = bool(request.get('sparse_vocal_attempt'))
        expected_suffix = f':movement:{number}' + (':sparse-vocal-v1' if sparse_attempt else '')
        guidance = str(request.get('sparse_vocal_guidance', '')).casefold()
        if (not local_source or not prompt_id.endswith(expected_suffix)
                or f'movement {number}' not in str(plan.get('title', '')).casefold()
                or f'movement {number} of 3' not in arrangement
                or (sparse_attempt and (number != 1 or 'vocal arrangement recovery' not in guidance))):
            raise ValueError('Sparse-intent delivery is limited to the reviewed spoken-jazz suite movement')
        return 'spoken_jazz_movement'
    allowed = {'mmm', 'heh', 'that', 's', 'right', 'damn', 'woah'}
    sparse_words = words and all(re.fullmatch(r'y+e+a+h+', word) or word in allowed for word in words)
    paid_reinterpretation = (exact_source and request.get('music_backend') == 'eleven_music'
        and details.get('musicBackend') == 'eleven_music' and sparse_words
        and 'breath' in arrangement and 'jazz' in arrangement)
    if paid_reinterpretation:
        if Path(request.get('directory', '')).name != request.get('prompt_id'):
            raise ValueError('The saved request directory does not match the request ID')
        return 'paid_spoken_jazz_reinterpretation'
    if (not local_source or not sparse_words or 'breath' not in arrangement or 'jazz' not in arrangement):
        raise ValueError('Sparse-intent delivery is limited to the reviewed Yeah After Midnight spoken-jazz reinterpretation')
    return 'spoken_jazz_reinterpretation'
def validate_evidence(evidence, minimum_coverage=.15, minimum_span=.6):
    numbers = [evidence.get(name) for name in ('duration', 'first_detected_voice',
        'last_detected_voice', 'voiced_energy_fraction', 'last_second_mix_dbfs')]
    if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in numbers):
        raise ValueError('Sparse-intent measurements are incomplete')
    duration, first, last, coverage, last_mix = numbers
    if not (minimum_coverage <= coverage < 0.5 and 0 <= first < last <= duration
            and last - first > duration * minimum_span and (duration - last > 1.2 or last_mix < -43)
            and evidence.get('estimated_word_count', 0) > 0):
        raise ValueError('The retained performance lacks the reviewed sparse vocal span or complete ending')
    return True


def validate_evidence_for_kind(evidence, kind):
    if kind == 'spoken_jazz_movement':
        validate_evidence(evidence, .15, .4)
        duration = evidence['duration']
        if evidence['first_detected_voice'] >= duration * .3 or evidence['last_detected_voice'] <= duration * .6:
            raise ValueError('The retained spoken-jazz movement lacks its reviewed middle performance')
        return True
    return validate_evidence(evidence, .05 if kind in
        ('spoken_jazz_reinterpretation', 'paid_spoken_jazz_reinterpretation') else .15)


def inputs_for_kind(kind):
    if kind == 'paid_original': return INPUTS
    if kind == 'paid_spoken_jazz_reinterpretation': return PAID_REINTERPRETATION_INPUTS
    return LOCAL_INPUTS


def is_paid_kind(kind):
    return kind in ('paid_original', 'paid_spoken_jazz_reinterpretation')


def verify(work, evidence=None):
    work = Path(work).resolve()
    policy = load(work / REPORT)
    kind = policy.get('kind', 'paid_original')
    expected_inputs = inputs_for_kind(kind)
    if (policy.get('version') != 1 or policy.get('accepted') is not True
            or set(policy.get('inputs_sha256', {})) != set(expected_inputs)):
        raise ValueError('Invalid sparse-vocal intent policy')
    if any(sha(work / name) != digest for name, digest in policy['inputs_sha256'].items()):
        raise ValueError('Sparse-vocal intent inputs changed')
    current = load(work / 'arrangement-checks.json') if evidence is None else evidence
    validate_evidence_for_kind(current, kind)
    if fingerprint(current) != policy.get('evidence_hash'):
        raise ValueError('Sparse-vocal measurements changed')
    configured = load(work / 'distonyc-configured.json')
    if configured.get('prompt_id') != policy.get('prompt_id'):
        raise ValueError('Sparse-vocal intent request identity changed')
    if is_paid_kind(kind):
        receipt = load(work / 'paid-receipt.json')
        if receipt.get('prompt_id') != policy.get('prompt_id'):
            raise ValueError('Sparse-vocal intent request identity changed')
    return policy

def prepare(request_path):
    request_path = Path(request_path).resolve()
    request = load(request_path)
    directory = Path(request['directory']).resolve()
    if request_path != directory / 'render-request.json':
        raise ValueError('Use the saved render-request.json for this exact job')
    kind = validate_intent(request, load(directory / 'planning-input.json'))
    work = work_path(request).resolve()
    state = load(work / 'desktop-status.json')
    if (state.get('status') != 'failed' or state.get('stage') != 'configure'
            or 'Insufficient vocal signal activity' not in state.get('error', '')
            or set(state.get('completed', [])) != {'generate', 'separate', 'words'}):
        raise ValueError('Sparse-intent delivery requires the retained pre-conversion coverage failure')
    evidence = load(work / 'arrangement-checks.json')
    validate_evidence_for_kind(evidence, kind)
    manifest = load(work / 'desktop-job.json')
    configured = load(work / 'distonyc-configured.json')
    if (sha(work / 'track.json') != manifest.get('track_sha256')
            or any(sha(work / name) != digest for name, digest in manifest.get('workers', {}).items())
            or configured.get('plan_hash') != fingerprint(request['plan'])):
        raise ValueError('The frozen sparse-intent plan or recipe changed')
    if is_paid_kind(kind):
        paid_hashes = manifest.get('paid_inputs_sha256')
        if (not isinstance(paid_hashes, dict) or set(paid_hashes) != {'paid-request.json', 'paid-inputs.json'}
                or any(sha(work / name) != digest for name, digest in paid_hashes.items())):
            raise ValueError('The retained work is not a hash-pinned paid composition')
        receipt = load(work / 'paid-receipt.json')
        if (receipt.get('prompt_id') != request['prompt_id']
                or sha(work / 'paid-original.mp3') != receipt.get('sha256')):
            raise ValueError('The retained paid composition does not match its receipt')
    inputs = inputs_for_kind(kind)
    path = work / REPORT
    if path.exists(): return verify(work)
    record = {'version': 1, 'at': utc(), 'accepted': True,
              'prompt_id': request['prompt_id'], 'kind': kind,
              'reason': 'Operator accepted the explicitly requested breathing-and-yeah sparse vocal arrangement.',
              'evidence_hash': fingerprint(evidence), 'evidence': evidence,
              'inputs_sha256': {name: sha(work / name) for name in inputs},
              'audio_changed': False, 'additional_paid_generation': False,
              'other_integrity_checks_retained': True}
    save(path, record)
    return verify(work)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True, type=Path)
    args = parser.parse_args()
    result = prepare(args.request)
    print('Prepared hash-pinned sparse-vocal delivery for ' + result['prompt_id'])
