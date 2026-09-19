"""Optional, brief vocal treatments; existing plans retain their original behavior."""
import json
import re
import shutil
from pathlib import Path

from common import load, save, sha

REFERENCE_ID = 'arabic-ornament-v1'
REFERENCE_SHA256 = '2bf5e4635ac605d06e6062d83ec1a7ee50e5ee51c1075fc67efdf6014882dd67'
SCHEMA = {'type': 'array', 'maxItems': 1, 'items': {
    'type': 'object', 'properties': {
        'section': {'type': 'string', 'enum': ['intro', 'bridge', 'outro']},
        'duration_seconds': {'type': 'integer', 'minimum': 4, 'maximum': 9},
        'words': {'type': 'string', 'minLength': 2, 'maxLength': 140},
    }, 'required': ['section', 'duration_seconds', 'words'], 'additionalProperties': False},
    'description': 'Usually empty. Optionally one brief Arabic/throat vocal accent using 2–8 words present in the song lyrics. Keep the main singing and arrangement.'}

PLANNING_GUIDANCE = '''
An optional Arabic/throat vocal accent is available for new originals and reinterpretations. Use vocal_accents=[] for most songs; choose it when specifically requested or when one brief contrast clearly suits the brief. It is a vocal treatment, not a whole-song genre, a replacement singer, or a requirement to use Arabic lyrics/instruments.
Use at most one 4–9-second phrase in an intro, bridge, or outro. Favor the low, connected, throaty resonance and flowing slurs in the preferred FIRST HALF of Arabic experiment 01; avoid extending into the less-preferred second-half delivery. Choose 2–8 words from the supplied song lyrics or retained Tony hook, write those words into the relevant lyric section, and put the exact phrase in words. Stretch its vowels, smear consonants and connect syllables while leaving a hint of the words recognizable. Do not substitute stock Ooom/ah/ya-layl filler or translate the lyric just to obtain this color. Return to the song's normal lead delivery after the phrase, and preserve its main instrumentation and hook.
Describe the short accent and its section in arrangement and tag the same section in lyrics. An outro accent is sung material: keep the last syllable in the normal final-vocal timing window, followed by the resolved ending. Do not add an instrumental tail to accommodate it. Faithful remix/acoustic/quartet recipes keep vocal_accents=[] because they retain source performance. In a connected suite, use the accent only once: intro in the first movement, bridge in the middle movement, or outro in the last; the chosen words must appear in that movement's lyrics.
'''


def tokens(text):
    return re.findall(r"[^\W_]+(?:'[^\W_]+)*", text.casefold().replace('’', "'"))


def movement_index(section, count):
    return {'intro': 0, 'bridge': count // 2, 'outro': count - 1}[section]


def for_movement(plan, index):
    accents = plan.get('vocal_accents', [])
    if not accents:
        return []
    return accents if movement_index(accents[0]['section'], len(plan['movements'])) == index else []


def validate(plan):
    accents = plan.get('vocal_accents', [])
    if not isinstance(accents, list) or len(accents) > 1:
        raise ValueError('vocal_accents must be empty or contain one brief phrase')
    if not accents:
        return
    if plan.get('recipe') not in ('new', 'reinterpretation'):
        raise ValueError('Vocal accents need an original or reinterpretation; retain faithful source performance')
    accent = accents[0]
    if not isinstance(accent, dict) or set(accent) != {'section', 'duration_seconds', 'words'}:
        raise ValueError('Invalid vocal accent fields')
    if accent['section'] not in ('intro', 'bridge', 'outro'):
        raise ValueError('Vocal accent section must be intro, bridge, or outro')
    if type(accent['duration_seconds']) is not int or not 4 <= accent['duration_seconds'] <= 9:
        raise ValueError('A sparse vocal accent targets 4–9 whole seconds')
    words = accent['words']
    if not isinstance(words, str) or not 2 <= len(words) <= 140 or not 2 <= len(tokens(words)) <= 8:
        raise ValueError('Vocal accent words must be 2–8 words from the song')
    lyrics = plan.get('lyrics', '')
    if plan.get('movements'):
        part = plan['movements'][movement_index(accent['section'], len(plan['movements']))]
        lyrics = part.get('lyrics', '')
    # Section labels are not sung words.
    available = tokens(re.sub(r'\[[^\]]*\]', ' ', lyrics))
    phrase = tokens(words)
    if not any(available[i:i + len(phrase)] == phrase for i in range(len(available) - len(phrase) + 1)):
        raise ValueError('Vocal accent words must appear in the selected song/movement lyrics')


def direction(accent):
    placement = {'intro': 'the opening sung phrase', 'bridge': 'one bridge phrase before the return to the main hook',
                 'outro': 'the final sung tag, ending in the planned final-vocal window'}[accent['section']]
    return (f"ONE brief vocal accent only, in {placement}, targeting {accent['duration_seconds']} seconds. "
            f"Sing these existing lyric words: {json.dumps(accent['words'], ensure_ascii=False)}. "
            'Use low, connected throat resonance, a restrained ringing overtone, Arabic-style melodic bends and Tony\'s loose slur: '
            'smear the consonants and carry the actual words on long joined vowels. Follow the preferred first-half technique reference. '
            'Keep a recognizable trace of the words. Use the normal planned lead delivery everywhere else. '
            'Keep the song\'s instrumentation, main hook, language and complete ending. ')


def preserve_caption(code):
    marker = 'planned=planned[0]'
    if code.count(marker) != 1:
        raise ValueError('Unknown composition recipe; cannot safely retain vocal-accent directions')
    return code.replace(marker, marker + "\n            save(HERE/'vocal-accent-lm-draft.json',planned)\n            planned['caption']=CAPTION")


def verify_frozen(work):
    work = Path(work)
    track = load(work / 'track.json')
    reference = track.get('vocal_accent_reference')
    if reference is not None:
        if reference.get('sha256') != REFERENCE_SHA256 or sha(work / 'vocal-accent-reference.wav') != REFERENCE_SHA256:
            raise ValueError('Frozen vocal-accent reference changed')


def configure(work, track, plan, settings):
    """Called only while preparing a new, unstarted, frozen work directory."""
    accents = plan.get('vocal_accents', [])
    if not accents:
        return
    validate(plan)
    work = Path(work)
    if (work / 'desktop-status.json').exists() and load(work / 'desktop-status.json').get('completed'):
        raise ValueError('Cannot add a vocal accent to started audio')
    profile_dir = Path(settings['studio_dir']) / 'vocal-techniques' / REFERENCE_ID
    profile = load(profile_dir / 'profile.json')
    reference = profile_dir / 'reference.wav'
    if (profile.get('id') != REFERENCE_ID or profile.get('reference_sha256') != REFERENCE_SHA256
            or profile.get('source_interval_seconds') != [0, 9.5] or sha(reference) != REFERENCE_SHA256):
        raise ValueError('The approved first-half vocal reference changed')
    base = work / 'generate_base.py'
    original = base if base.exists() else work / 'generate_song.py'
    code = preserve_caption(original.read_text('utf-8'))
    compile(code, 'generate_base.py', 'exec')
    # Reference audio is snapshotted for resumability, never spliced into a mix.
    shutil.copy2(reference, work / 'vocal-accent-reference.wav')
    shutil.copy2(Path(__file__).with_name('vocal_accent_runtime.py'), work / 'vocal_accent_runtime.py')
    base.write_text(code, 'utf-8')
    wrapper = 'import generate_base as base\n'
    if track.get('basis_sources'):
        wrapper += 'from basis_references import build_references\nbase.references=lambda:build_references(base)\n'
    wrapper += 'from vocal_accent_runtime import install\ninstall(base)\nbase.main()\n'
    (work / 'generate_song.py').write_text(wrapper, 'utf-8')
    track['caption'] = direction(accents[0]) + track['caption']
    track['vocal_accents'] = accents
    track['vocal_accent_reference'] = {'file': 'vocal-accent-reference.wav', 'sha256': REFERENCE_SHA256,
        'profile': REFERENCE_ID, 'source_interval_seconds': [0, 9.5]}
    save(work / 'vocal-accent-policy.json', {'version': 1, 'accents': accents, 'reference': track['vocal_accent_reference'],
        'duration_is_generation_guidance': True, 'automatic_style_verification': False,
        'audio_spliced_into_mix': False, 'new_training': False})
