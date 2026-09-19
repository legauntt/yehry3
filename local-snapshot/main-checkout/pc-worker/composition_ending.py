"""One pre-conversion composition retry; keep the original as the fallback.

No waveform is cut, no finished song is regenerated, and no planning model is
called. Both candidates use the frozen lyrics, duration, genre and Tony voice.
"""
import math
import subprocess
import uuid
from pathlib import Path

from common import fingerprint, load, save, sha

VERSION = 1
RETRY_ABOVE_SECONDS = 20
REPORT = 'composition-ending-repair.json'
EVIDENCE_FILES = ('desktop-job.json', 'track.json', 'selected-mix.wav',
                  'selected-vocals.wav', 'selected-backing.wav', 'mix-config.json',
                  'arrangement-checks.json', 'quiet-tail-trim.json')


def identifier(request, repair=None, candidate=False):
    suffix = ':ending-v1' if repair else ':outro-v1' if candidate else ''
    return str(uuid.uuid5(uuid.NAMESPACE_URL, request['prompt_id'] + suffix))


def timing_instruction(duration):
    return (f'Ending arrangement: keep the singer active into the final section. '
            f'Place the last complete sung phrase around {duration - 10} seconds, '
            f'with its final sustained syllable ending between {duration - 12} and {duration - 8} seconds. '
            'Pace the supplied verses and final chorus across the whole song to reach that window. '
            'Then resolve one final chord and let it decay for 8-12 seconds. '
            'Do not finish the lyrics early and fill the remaining time with an instrumental loop. '
            'Keep every supplied lyric and the natural vocal tail. ')


class CompositionReady(Exception):
    """Intentional pause after ending checks, before any voice conversion starts."""
    def __init__(self, work):
        self.work = Path(work)


def preflight_runner(command, **kwargs):
    if len(command) >= 3 and Path(command[1]).name == 'convert_song.py' and command[2] == 'prepare':
        raise CompositionReady(kwargs['cwd'])
    return subprocess.Popen(command, **kwargs)


def input_hash(request):
    return fingerprint({'plan': request['plan'], 'basis': request['basis']})


def journal_for(request):
    path = Path(request['directory']) / REPORT
    if not path.exists(): return None
    journal = load(path)
    if (journal.get('version') != VERSION or journal.get('inputs_hash') != input_hash(request)
            or journal.get('attempt_limit') != 1 or type(journal.get('attempts')) is not int
            or journal.get('attempts') not in (0, 1)
            or journal.get('status') not in ('original', 'candidate', 'selected')):
        raise ValueError('Saved composition-ending repair inputs or budget changed')
    if journal['status'] == 'candidate' and journal['attempts'] != 1:
        raise ValueError('Missing composition retry budget')
    if journal['status'] == 'original' and journal['attempts'] != 0:
        raise ValueError('Invalid original composition budget')
    if journal['status'] in ('candidate', 'selected') and not journal.get('original_evidence'):
        raise ValueError('Missing original composition evidence')
    if journal['status'] == 'selected' and (journal.get('selected') not in ('original', 'candidate')
            or journal.get('selected') == 'candidate' and journal['attempts'] != 1):
        raise ValueError('Invalid saved composition selection')
    if journal.get('selected') == 'candidate' and not journal.get('candidate_evidence'):
        raise ValueError('Missing selected candidate evidence')
    return journal


def active_identifier(request, repair=None):
    # Voice dropout repairs must follow the selected composition's actual folder.
    if repair: return identifier(request, repair)
    journal = journal_for(request)
    candidate = bool(journal and journal.get('selected') == 'candidate')
    return identifier(request, candidate=candidate)


def work_path(request, candidate=False):
    return Path(request['config']['settings']['studio_dir']).parent / ('troofs-desktop-' + identifier(request, candidate=candidate))


def evidence(work):
    work = Path(work)
    state = load(work / 'desktop-status.json')
    if not {'generate', 'separate', 'words', 'configure', 'ending'} <= set(state['completed']):
        raise ValueError('Composition review requires all original arrangement and ending checks')
    if set(state['completed']) & {'prepare', 'features', 'pitch', 'diffuse', 'vocode', 'assemble', 'validate', 'finish'}:
        raise ValueError('Cannot choose another composition after voice conversion has started')
    arrangement, cfg = load(work / 'arrangement-checks.json'), load(work / 'mix-config.json')
    duration = arrangement['duration']
    if cfg.get('quiet_tail_trim'):
        if cfg['quiet_tail_trim'] != 'quiet-tail-trim.json': raise ValueError('Unsupported ending trim evidence')
        trim = load(work / 'quiet-tail-trim.json')
        if trim.get('status') != 'ready': raise ValueError('Incomplete ending trim evidence')
        duration = trim['output_duration']
    last = max(arrangement['last_detected_voice'], cfg.get('restored_quiet_vocal_end', 0))
    coverage = arrangement['voiced_energy_fraction']
    gap = max((row['seconds'] for row in arrangement['long_vocal_gaps']), default=0)
    if (not all(math.isfinite(x) for x in (duration, last, coverage, gap))
            or not 0 < last < duration or not 0 <= coverage <= 1 or gap < 0):
        raise ValueError('Invalid composition-ending measurements')
    sparse_intent = False
    if coverage < .5:
        policy = work / 'sparse-vocal-intent-policy.json'
        if not policy.exists(): raise ValueError('Invalid composition-ending measurements')
        from sparse_intent_policy import verify
        verify(work, arrangement)
        sparse_intent = True
    return {'duration': duration, 'last_detected_voice': last,
            'post_vocal_seconds': duration - last, 'voiced_energy_fraction': coverage,
            'longest_instrumental_break': gap,
            'inputs_sha256': {name: sha(work / name) for name in EVIDENCE_FILES},
            'operator_sparse_intent': sparse_intent, 'listening_review': False}


def verify_evidence(request, journal):
    for which in ('original', 'candidate'):
        saved = journal.get(which + '_evidence')
        if not saved: continue
        work = work_path(request, candidate=which == 'candidate')
        if set(saved.get('inputs_sha256', {})) != set(EVIDENCE_FILES):
            raise ValueError('Incomplete composition-ending provenance')
        if any(sha(work / name) != digest for name, digest in saved['inputs_sha256'].items()):
            raise ValueError('Saved composition audio or ending evidence changed')


def better_candidate(original, candidate):
    # A substantially shorter outro alone cannot justify a new long break or a
    # large loss of vocal activity elsewhere in the candidate.
    return (2 <= candidate['post_vocal_seconds'] <= 13
            and original['post_vocal_seconds'] - candidate['post_vocal_seconds'] >= 8
            and candidate['voiced_energy_fraction'] >= original['voiced_energy_fraction'] - .05
            and (candidate['longest_instrumental_break'] < 9.5
                 or original['longest_instrumental_break'] >= 9.5
                 and candidate['longest_instrumental_break'] <= original['longest_instrumental_break'] + .5))


def render_with_retry(request, repair, render_attempt):
    path = Path(request['directory']) / REPORT
    journal = journal_for(request)
    if repair or request.get('verify_existing'):
        return render_attempt(request, repair)
    if journal is None:
        if not request['config'].get('automatic_outro_retry', False):
            return render_attempt(request, repair)
        plan = request['plan']
        if (plan['recipe'] not in ('new', 'reinterpretation')
                or plan.get('allow_long_instrumental_outro') is not False
                or work_path(request).exists()):
            return render_attempt(request, repair)
        journal = {'version': VERSION, 'inputs_hash': input_hash(request), 'status': 'original',
                   'attempt_limit': 1, 'attempts': 0, 'trigger_above_seconds': RETRY_ABOVE_SECONDS,
                   'original_audio_retained': True, 'lyrics_changed': False,
                   'duration_changed': False, 'listening_review': False}
        save(path, journal)
    verify_evidence(request, journal)
    while journal['status'] != 'selected':
        which = journal['status']
        try:
            result = render_attempt(request, repair, preflight=True, composition_retry=which == 'candidate')
        except CompositionReady as ready:
            if ready.work.resolve() != work_path(request, candidate=which == 'candidate').resolve():
                raise ValueError('Composition review returned an unexpected work folder')
            measured = evidence(ready.work)
            journal[which + '_evidence'] = measured
            if which == 'original' and measured['post_vocal_seconds'] > RETRY_ABOVE_SECONDS:
                # Commit the single attempt before starting any candidate audio.
                journal.update(status='candidate', attempts=1)
            else:
                selected = 'candidate' if which == 'candidate' and better_candidate(journal['original_evidence'], measured) else 'original'
                journal.update(status='selected', selected=selected,
                    reason='Candidate resolves the long outro without worse measured spacing' if selected == 'candidate'
                    else 'Original retained: no substantial outro or candidate was not a sufficient improvement')
            save(path, journal)
        except RuntimeError as error:
            if which != 'candidate': raise
            # A failed optional candidate never discards the usable original.
            # Cancellation, changed inputs, filesystem errors and process death
            # are not swallowed here; a restart resumes the same candidate.
            journal.update(status='selected', selected='original',
                           reason='Optional composition retry failed; original retained',
                           candidate_error=str(error)[-2000:])
            save(path, journal)
        else:
            # A completed result is authoritative; never regenerate it on retry.
            return result
    verify_evidence(request, journal)
    if journal['selected'] == 'candidate':
        result = render_attempt(request, repair, composition_retry=True)
    else:
        result = render_attempt(request, repair)
    journal['delivery'] = {key: result[key] for key in ('status', 'work_path', 'duration', 'qualityIssues') if key in result}
    save(path, journal)
    return result
