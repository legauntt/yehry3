"""Backend selection is independent of the saved Tony voice profile."""
import math
from pathlib import Path
import re
import shutil

from common import fingerprint, load, save, sha

PAID = 'eleven_music'
CAPABILITY = 'eleven-music-v1'


def selected(prompt):
    value = (prompt.get('details') or {}).get('musicBackend', 'local')
    if value not in ('local', PAID): raise ValueError('Unsupported band generator')
    return value


def capabilities(config):
    path = config.get('paid_music_policy')
    if not path: return []
    from paid_music import policy, validate_ledger
    cfg = policy(path)
    if not cfg.get('enabled'): return []
    validate_ledger(load(cfg['ledger']))
    if not Path(cfg['credential']).is_file(): return []
    return [CAPABILITY]


def plan_constraints(plan, brief):
    if selected(brief) != PAID: return plan
    options = brief['details'].get('generation') or {}
    if (not options or options.get('candidates', 1) != 1 or options.get('variation', 'balanced') != 'balanced'
            or type(options.get('duration')) is not int or not 120 <= options['duration'] <= 600):
        raise ValueError('Eleven Music requires one composition and an explicit two-to-ten-minute length')
    if brief['details'].get('basisSongIds') or brief['details'].get('remixSource') or brief['details'].get('source'):
        raise ValueError('Use local generation for basis recordings and catalog remixes')
    if plan['recipe'] == 'needs_attention': return plan
    if plan['recipe'] != 'new' or plan['duration'] != options['duration'] or plan.get('movements'):
        raise ValueError('Eleven Music requires a new composition at the confirmed duration, without suite movements')
    if not plan['preserve_generated_backing']:
        raise ValueError('Retain the Eleven Music accompaniment; do not apply the local band adapter')
    return plan


def planning_guidance(brief):
    if selected(brief) != PAID: return ''
    return '''\nELEVEN MUSIC BACKEND: Compose new music at exactly details.generation.duration seconds.
Use recipe=new, preserve_generated_backing=true and no movements. Tony's selected local voice
is applied after Eleven Music supplies the composition and guide vocal. Basis audio, faithful
remakes and the local band adapter are unavailable. Honor the supplied lyric sheet, style,
instruments, tempo, key, meter, vocal-entry and ending targets. Use standard section headings.
The complete lyric sheet and musical arrangement are sent to ElevenLabs; private admin notes,
reference-page snapshots and Tony recordings are not sent. Do not put operational or private
account information in lyrics or arrangement. Never request additional paid takes or repairs.
'''


def composition(plan, seed):
    """Map the approved sheet to bounded v2.5 chunks without changing any lyric words."""
    from generation_controls import arrangement_guidance
    from lyric_sections import section_label
    options = plan['generation']
    total = plan['duration'] * 1000
    rows, label, lines = [], None, []
    for line in plan['lyrics'].splitlines():
        heading = section_label(line)
        if heading:
            if lines or label is not None: rows.append({'label': label or '[Section]', 'lines': lines})
            # End is a delimiter, never a section whose following words can be discarded.
            label, lines = (None if heading == '[End]' else heading), []
        elif line.strip(): lines.append(line)
    if lines or label is not None: rows.append({'label': label or '[Section]', 'lines': lines})
    if not rows or not any(row['lines'] for row in rows): raise ValueError('A paid composition needs complete lyrics')
    # Every section keeps its original position. Add an instrumental bookend only if absent.
    if rows[0]['lines'] and options.get('vocalEntry', 4) >= 3:
        rows.insert(0, {'label': '[Intro]', 'lines': []})
    if rows[-1]['lines']: rows.append({'label': '[Outro]', 'lines': []})
    fixed = {}
    for i, row in enumerate(rows):
        if not row['lines']:
            seconds = options.get('vocalEntry', 4) if i == 0 else options.get('endingSeconds', 10) if i == len(rows)-1 else 4
            fixed[i] = max(3000, seconds * 1000)
    vocal = [i for i, row in enumerate(rows) if row['lines']]
    available = total - sum(fixed.values())
    if available < len(vocal) * 3000: raise ValueError('Too many lyric sections for the paid song length')
    weights = {i: max(1, len(' '.join(rows[i]['lines']).split())) for i in vocal}
    extra = available - len(vocal) * 3000
    lengths = {i: 3000 + math.floor(extra * weights[i] / sum(weights.values())) for i in vocal}
    lengths[vocal[-1]] += available - sum(lengths.values())
    lengths.update(fixed)
    styles = [plan['arrangement'], arrangement_guidance(options),
              f"{plan['bpm']} BPM, {plan['keyscale']}",
              'Expressive male melodic lead, connected vowels, complete every written closing lyric']
    negative = options.get('avoidInstruments', [])
    chunks = []
    for i, row in enumerate(rows):
        count = math.ceil(lengths[i] / 120000)
        words = row['lines']
        if count > len(words) and words:
            # Splitting on whitespace preserves the approved ordered words even for one long line.
            words = ' '.join(words).split()
        for part in range(count):
            section = words[len(words)*part//count:len(words)*(part+1)//count]
            duration = lengths[i]//count + (lengths[i] % count if part == count-1 else 0)
            cues = ['Instrumental, no singing, final chord resolves and decays completely'] if i == len(rows)-1 and not words else []
            chunks.append({'text': row['label'] + ('\n' + '\n'.join(section) if section else ''),
                           'duration_ms': duration, 'positive_styles': styles + cues, 'negative_styles': negative})
    result = {'model_id': 'music_v2_5', 'composition_plan': {'chunks': chunks}, 'seed': seed}
    from paid_music import request_duration
    request_duration(result)
    return result


def configure(work, track, spec, request, manifest):
    work = Path(work)
    authorization = request.get('paid_authorization')
    if not isinstance(authorization, dict): raise ValueError('Missing confirmed paid music authorization')
    policy_path = request['config'].get('paid_music_policy')
    if not policy_path: raise ValueError('Paid music is not configured on this worker')
    body = composition(request['plan'], spec['seed'])
    for name in ('paid_music.py', 'common.py'):
        shutil.copy2(Path(__file__).with_name(name), work / name)
    save(work / 'paid-request.json', body)
    save(work / 'paid-inputs.json', {'version': 1, 'prompt_id': request['prompt_id'],
        'request_hash': fingerprint(body), 'authorization': authorization, 'policy_path': policy_path,
        'ffmpeg': request['config']['settings']['ffmpeg']})
    track.update(music_backend=PAID, composition_model='music_v2_5', backing_adapter=None,
        backing_decision='Keep Eleven Music accompaniment; apply the selected local Tony voice.', external_audio_upload=False)
    manifest['tasks'] = [task for task in manifest['tasks'] if task['name'] != 'backing']
    for task in manifest['tasks']:
        if task['name'] == 'generate':
            task['command'] = [request['config']['settings']['python'], str(work / 'paid_music.py'), '--work', str(work)]
    manifest['paid_inputs_sha256'] = {name: sha(work / name) for name in ('paid-request.json', 'paid-inputs.json')}


def verify(work, manifest):
    for name, digest in manifest.get('paid_inputs_sha256', {}).items():
        if sha(Path(work) / name) != digest: raise ValueError('Frozen paid music inputs changed')


def render(request, attempt, recover, warning):
    plan_constraints(request['plan'], {'details': {'musicBackend': PAID, 'generation': request['plan'].get('generation')}})
    if request['basis']: raise ValueError('Paid music cannot upload basis recordings')
    # Only local vocal recovery may run. Composition/outro/candidate retries must never spend.
    for _ in range(3):
        try:
            result = attempt(request)
            work = Path(result['work_path'])
            manifest = load(work / 'desktop-job.json')
            verify(work, manifest)
            receipt = load(work / 'paid-receipt.json')
            if receipt.get('prompt_id') != request['prompt_id'] or sha(work / 'paid-original.mp3') != receipt['sha256']:
                raise ValueError('The retained paid composition changed before delivery')
            result['music_backend'] = PAID
            return result
        except RuntimeError:
            try:
                if recover(request): continue
            except RuntimeError:
                if warning(request): continue
                raise
            if warning(request): continue
            raise
    raise RuntimeError('Local vocal recovery exhausted; the paid composition is retained')


def payment_attention(message):
    text = str(message).casefold()
    return any(term in text for term in ('paid music needs reconciliation', 'paid music budget',
        'paid music is disabled', 'paid music is not configured', 'paid music policy',
        'paid music spending ledger', 'paid music ledger', 'paid music authorization',
        'paid reservation', 'saved elevenlabs credential'))
