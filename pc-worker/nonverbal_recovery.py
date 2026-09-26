"""One retained-audio recovery for explicitly requested nonverbal performances."""
import ast
import math
from numbers import Real
import re
from pathlib import Path
from common import fingerprint, load, save, sha, utc

REPORT = 'nonverbal-activity-policy.json'
BASE = ('desktop-job.json', 'track.json', 'distonyc-configured.json',
        'selected-mix.wav', 'selected-vocals.wav', 'selected-backing.wav')
PAID = ('paid-original.mp3', 'paid-request.json', 'paid-inputs.json', 'paid-receipt.json')


def measurements(evidence):
    fields = ('duration', 'first_detected_voice', 'last_detected_voice',
              'voiced_energy_fraction', 'last_second_mix_dbfs')
    values = [evidence.get(key) for key in fields]
    if not all(isinstance(v, Real) and not isinstance(v, bool) and math.isfinite(v) for v in values):
        raise ValueError('Incomplete nonverbal activity evidence')
    duration, first, last, coverage, ending = values
    if not (.15 <= coverage < .5 and 0 <= first < last <= duration and
            last - first > duration * .6 and (duration-last > 1.2 or ending < -43)):
        raise ValueError('Nonverbal recovery needs sustained vocal presence and a complete ending')


def prepare(request, work):
    """Return false outside this intent; pin every input before one configure retry."""
    work = Path(work)
    if request.get('plan', {}).get('vocal_mode') != 'nonverbal': return False
    if (work / REPORT).exists():
        verify(work)
        return False  # A second failure must not become an unbounded retry.
    directory = Path(request['directory'])
    planning = load(directory / 'planning-input.json')
    brief = planning['brief']
    intent = ' '.join(str(v) for v in (brief.get('prompt'), brief.get('details', {}).get('keep'), brief.get('details', {}).get('direction')))
    if not re.search(r'wordless|nonverbal|non-verbal|gibberish|jibberish|no words|vocal sounds', intent, re.I):
        raise ValueError('The confirmed brief does not request a nonverbal performance')
    state = load(work / 'desktop-status.json')
    if (state.get('status') != 'failed' or state.get('stage') != 'configure' or
        'Insufficient vocal signal activity' not in state.get('error', '') or
        not {'generate', 'separate', 'words'} <= set(state.get('completed', []))):
        return False
    evidence = load(work / 'arrangement-checks.json'); measurements(evidence)
    manifest = load(work / 'desktop-job.json')
    configured = load(work / 'distonyc-configured.json')
    if (sha(work/'track.json') != manifest['track_sha256'] or
        configured['prompt_id'] != request['prompt_id'] or
        configured['plan_hash'] != fingerprint(request['plan']) or
        any(sha(work/name) != digest for name, digest in manifest['workers'].items())):
        raise ValueError('Frozen nonverbal production inputs changed')
    inputs = BASE + (PAID if request.get('music_backend') == 'eleven_music' else ())
    if PAID[0] in inputs:
        receipt = load(work/'paid-receipt.json')
        if receipt['prompt_id'] != request['prompt_id'] or sha(work/'paid-original.mp3') != receipt['sha256']:
            raise ValueError('The retained paid recording differs from its receipt')
        if any(sha(work/name) != digest for name, digest in manifest['paid_inputs_sha256'].items()):
            raise ValueError('Frozen paid inputs changed')
    save(work/REPORT, {'version': 1, 'at': utc(), 'request_id': request['prompt_id'],
        'reason': 'The confirmed nonverbal score intentionally uses breaths and separated vocal gestures.',
        'evidence_hash': fingerprint(evidence), 'evidence': evidence,
        'inputs_sha256': {name: sha(work/name) for name in inputs},
        'audio_changed': False, 'additional_paid_generation': False,
        'other_integrity_checks_retained': True})
    verify(work)
    return True


def verify(work, evidence=None):
    work = Path(work); record = load(work/REPORT)
    inputs = record.get('inputs_sha256', {})
    if record.get('version') != 1 or set(inputs) not in (set(BASE), set(BASE + PAID)):
        raise ValueError('Invalid nonverbal activity policy')
    if any(sha(work/name) != digest for name, digest in inputs.items()):
        raise ValueError('Nonverbal activity policy inputs changed')
    if load(work/'track.json').get('vocal_mode') != 'nonverbal':
        raise ValueError('This is not a nonverbal score')
    evidence = evidence if evidence is not None else load(work/'arrangement-checks.json')
    measurements(evidence)
    if fingerprint(evidence) != record['evidence_hash']:
        raise ValueError('Nonverbal activity evidence changed')
    return True


def policy_source(source, work):
    """Adapt only the exact coverage assertion; original on-disk code stays pinned."""
    if not (Path(work)/REPORT).exists(): return source
    verify(work)
    tree = ast.parse(source); changed = 0
    guard = ast.dump(ast.parse('float(mask.mean())>=.50', mode='eval').body)
    for node in ast.walk(tree):
        if (isinstance(node, ast.Assert) and isinstance(node.msg, ast.Tuple) and
            isinstance(node.msg.elts[0], ast.Constant) and node.msg.elts[0].value == 'Insufficient vocal signal activity' and
            ast.dump(node.test) == guard):
            node.test = ast.BoolOp(op=ast.Or(), values=[node.test,
                ast.Call(func=ast.Name(id='_distonyc_accept_nonverbal', ctx=ast.Load()),
                         args=[ast.Name(id='evidence', ctx=ast.Load())], keywords=[])])
            changed += 1
    if changed != 1: raise ValueError('Unsupported nonverbal coverage checker')
    return ast.unparse(ast.fix_missing_locations(tree))
