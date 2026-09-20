"""Explicit V8 generation choices, independent of the selected Tony checkpoint."""
import math
import re
from collections import Counter
from pathlib import Path

from common import load, save

CAPABILITY = 'generation-v8-v1'
RANGES = {'duration': (69, 666), 'bpm': (45, 220), 'vocalEntry': (0, 20),
          'endingSeconds': (2, 20), 'maxBreakSeconds': (0, 30), 'seed': (0, 2147481647),
          'candidates': (1, 3), 'vocalGainDb': (-12, 6), 'backingGainDb': (-12, 6)}
CHOICES = {'meter': ['2/4', '3/4', '4/4', '6/8'],
           'lyricWorkflow': ['auto', 'story', 'hook', 'rhythm'],
           'performance': ['natural', 'restrained', 'raw'],
           'energy': ['auto', 'build', 'waves', 'steady'],
           'variation': ['balanced', 'conservative', 'adventurous'],
           # How far the guide singer's tracked pitch is tidied before Tony sings it; pitchCompare asks for a B side.
           'pitchRepair': ['wild', 'haunted', 'clean'], 'pitchCompare': ['wild', 'haunted', 'clean']}
# Applied by the local voice runtime after composition; never shown to the song planner.
VOICE_ONLY = ('pitchRepair', 'pitchCompare')
TEXT_LIMITS = {'genre': 120, 'structure': 600, 'keyscale': 12}
LIST_LIMITS = {'instruments': (12, 60), 'avoidInstruments': (12, 60),
               'avoidPhrases': (30, 80), 'requiredPhrases': (12, 120), 'lockedLines': (20, 250)}
DEFAULTS = {'version': 1, 'candidates': 1, 'lyricWorkflow': 'auto', 'performance': 'natural',
            'energy': 'auto', 'variation': 'balanced', 'reviewLyrics': False,
            'vocalGainDb': 0, 'backingGainDb': 0}
KEY_PATTERN = r'[A-G](?:#|b)? (?:major|minor)'


def plain(value, limit, field):
    if not isinstance(value, str) or len(value.encode('utf-16-le')) // 2 > limit or re.search(r'[\x00-\x1f\x7f]', value):
        raise ValueError(f'Invalid {field}; use plain text up to {limit} characters')
    return value.strip()


def normalize(value):
    if value is None: return None
    if not isinstance(value, dict) or value.get('version') != 1 or type(value.get('version')) is not int:
        raise ValueError('Unsupported generation options version')
    allowed = {'version', 'reviewLyrics'} | set(RANGES) | set(CHOICES) | set(TEXT_LIMITS) | set(LIST_LIMITS)
    if set(value) - allowed: raise ValueError('Unknown generation option: ' + ', '.join(sorted(set(value) - allowed)))
    result = dict(DEFAULTS)
    for key, item in value.items():
        if key == 'version': continue
        if key == 'reviewLyrics':
            if type(item) is not bool: raise ValueError('Invalid lyric review choice')
            result[key] = item
        elif key in RANGES:
            if item is None and key not in DEFAULTS: continue
            low, high = RANGES[key]
            if type(item) not in (int, float) or not math.isfinite(item) or not low <= item <= high or (
                    key not in ('vocalGainDb', 'backingGainDb') and int(item) != item):
                raise ValueError(f'{key} must be between {low} and {high}' + (' in whole numbers' if key not in ('vocalGainDb', 'backingGainDb') else ''))
            result[key] = item if key.endswith('GainDb') else int(item)
        elif key in CHOICES:
            if item is None and key not in DEFAULTS: continue
            if item not in CHOICES[key]: raise ValueError('Unsupported ' + key)
            result[key] = item
        elif key in TEXT_LIMITS:
            if item is None: continue
            text = plain(item, TEXT_LIMITS[key], key)
            if text:
                if key == 'keyscale' and not re.fullmatch(KEY_PATTERN, text): raise ValueError('Choose a major or minor key')
                result[key] = text
        else:
            count, limit = LIST_LIMITS[key]
            if not isinstance(item, list) or len(item) > count: raise ValueError(f'{key} allows at most {count} entries')
            entries = [plain(x, limit, key) for x in item]
            if any(not x for x in entries) or len({x.lower() for x in entries}) != len(entries):
                raise ValueError(f'{key} contains empty or duplicate entries')
            if entries: result[key] = entries
    if result.get('duration', 0) > 600 and result['candidates'] > 1:
        raise ValueError('Songs over 600 seconds use connected movements. Choose 1 composition.')
    if set(map(str.lower, result.get('instruments', []))) & set(map(str.lower, result.get('avoidInstruments', []))):
        raise ValueError('An instrument cannot be both requested and excluded')
    if 'pitchCompare' in result and result.get('pitchRepair') in (None, result['pitchCompare']):
        raise ValueError('A B side needs a chosen pitch setting and a different one to compare')
    return result


def constraints(plan, brief):
    options = normalize(brief.get('details', {}).get('generation'))
    if not options: return plan
    if plan['recipe'] == 'needs_attention': return {**plan, 'generation': options}
    if plan['duration'] > 600 and options['candidates'] > 1:
        raise ValueError('Composition previews require a song of at most 600 seconds')
    if plan['recipe'] not in ('new', 'reinterpretation'):
        raise ValueError('Advanced generation controls require a new composition or reinterpretation; faithful source timing has a separate contract')
    if any(options.get(key) for key in ('genre', 'instruments', 'avoidInstruments')) and not plan['preserve_generated_backing']:
        raise ValueError('Retain the generated accompaniment for explicit style/instrument selections; do not replace it with the rock-band adapter')
    for key in ('duration', 'bpm', 'keyscale'):
        if key in options and plan[key] != options[key]:
            raise ValueError(f'The explicit {key} selection must be {options[key]}, not {plan[key]}')
    lines = {line.strip() for line in plan['lyrics'].splitlines()}
    for line in options.get('lockedLines', []):
        if line not in lines: raise ValueError('Retain this locked lyric line exactly: ' + line)
    from lyric_sections import sung_lines
    lyric_words = ' '.join(re.findall(r"\w+(?:['’]\w+)?", '\n'.join(sung_lines(plan['lyrics'])).lower()))
    for phrase in options.get('requiredPhrases', []):
        words = ' '.join(re.findall(r"\w+(?:['’]\w+)?", phrase.lower()))
        if words and (' ' + words + ' ') not in (' ' + lyric_words + ' '):
            raise ValueError('Include the explicitly required lyric phrase: ' + phrase)
    return {**plan, 'generation': options}


WORKFLOWS = {
    'story': 'Write a concrete narrative with a beginning, development and final payoff. Let any recurring refrain change meaning as the story progresses. Establish the plot before polishing rhymes.',
    'hook': 'Find one song-specific, singable hook first. Build contrasting verses and a final payoff around it. Use repetition only when compatible with the requested song form; keep the imagery specific to this song.',
    'rhythm': 'Start from stresses, bar lengths and the requested groove. Write rhythmically singable lines with varied internal rhyme. Use rap/spoken delivery only if requested.',
    'auto': 'Choose a writing approach that suits this particular brief; establish its form, development and final payoff before finishing the lyric sheet.',
}
CREATIVE_GUIDANCE = '''Current ending and lyric policy:
Voice descriptions concern the SOUND of Tony's delivery, not a stock vocabulary for the lyrics.
Keep his connected, rough phrasing and memorable melodies. Deliver the final meaningful lyric completely.
Do not replace the final verse/tag with an older section or fill the last 30–60 seconds with screaming,
wordless sounds, gibberish, repeated earlier verses or an instrumental loop. A brief expressive slur
or ad-lib can suit the song; keep it purposeful and normally under two seconds. Preserve explicitly
requested raw delivery or long endings, while still giving the song a complete lyrical finish.
Write concrete imagery from this brief. Do not habitually reach for crooked/grin/shoe/boot/brass imagery.
Explicitly requested words, supplied lyrics and locked lines take priority over general avoidance.
Do not treat avoidance as a ban on actual requested instruments or intentional chorus repetition.
'''


def planning_guidance(brief, recent=None):
    options = normalize(brief.get('details', {}).get('generation')) or DEFAULTS
    import json
    return (CREATIVE_GUIDANCE + '\nWriting approach: ' + WORKFLOWS[options['lyricWorkflow']] +
            '\nExplicit musical/lyric selections (Auto fields omitted; honor these throughout the plan):\n' +
            json.dumps({key: item for key, item in options.items() if key not in VOICE_ONLY}, ensure_ascii=False) +
            '\nAvoid-phrase preferences are soft constraints when the current brief explicitly requests those words. '
            'Required phrases, locked lines and preserve-mode lyrics retain priority. Musical timing/key/meter are targets, not proof of an achieved performance.\n' +
            ('Recent planned-song vocabulary counts, for novelty awareness only:\n' + json.dumps(recent, ensure_ascii=False) if recent else ''))


def recent_vocabulary(config, directory):
    path = Path(directory) / 'lyric-vocabulary-context.json'
    if path.exists(): return load(path)
    jobs = Path(config.get('state_dir', directory)) / 'jobs'
    counts = Counter()
    files = []
    if jobs.is_dir():
        candidates = sorted(jobs.glob('*/plan.json'), key=lambda p: p.stat().st_mtime, reverse=True)
        for candidate in candidates:
            if candidate.parent.resolve() == Path(directory).resolve(): continue
            try:
                data = load(candidate)['plan']
                text = data.get('lyrics', '').casefold()
                if not text: continue
                words = set(re.findall(r"\b[a-z]{4,}\b", text))
                counts.update(words)
                files.append(candidate.parent.name)
                if len(files) == 30: break
            except (OSError, ValueError, KeyError, TypeError): continue
    watched = ['crooked', 'grin', 'shoes', 'boots', 'brass', 'neon', 'whiskey', 'dust', 'rust']
    result = {'version': 1, 'planned_songs': len(files), 'song_counts': {w: counts[w] for w in watched if counts[w]},
              'scope': 'Recent local written plans; not a claim of publication or model training.'}
    save(path, result)
    return result


def arrangement_guidance(options):
    options = normalize(options)
    if not options: return ''
    parts = []
    if options.get('genre'): parts.append('Musical style: ' + options['genre'] + '.')
    if options.get('instruments'): parts.append('Prominent instruments: ' + ', '.join(options['instruments']) + '.')
    if options.get('avoidInstruments'): parts.append('Avoid these instruments: ' + ', '.join(options['avoidInstruments']) + '.')
    if options.get('meter'): parts.append('Use ' + options['meter'] + ' meter.')
    if options.get('structure'): parts.append('Section order: ' + options['structure'] + '.')
    if 'vocalEntry' in options: parts.append(f"Target the first sung phrase at {options['vocalEntry']} seconds.")
    if 'maxBreakSeconds' in options: parts.append(f"Target no instrumental break longer than {options['maxBreakSeconds']} seconds.")
    if options['energy'] != 'auto': parts.append('Energy pattern: ' + {'build': 'grow toward the final section', 'waves': 'alternate quiet and strong sections', 'steady': 'keep a consistent groove with clear section contrasts'}[options['energy']] + '.')
    parts.append({'natural': 'Expressive connected Tony phrasing with complete, catchable lyric endings.',
                  'restrained': 'Intimate controlled singing, clear lyrical endings, no screamed or wordless closing coda.',
                  'raw': 'Raw expressive singing with brief deliberate outbursts; complete the final lyrics before resolving.'}[options['performance']])
    return ' '.join(parts) + ' '


def synthesis_options(options):
    options = normalize(options) or DEFAULTS
    result = {'timesignature': options.get('meter', '').split('/')[0]}
    result['lm_temperature'] = {'conservative': .6, 'balanced': .75, 'adventurous': .9}[options['variation']]
    return result
