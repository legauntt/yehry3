"""Frozen explicit lyric limits and advisory pacing for fresh V8 planning."""
import re
from pathlib import Path
from common import fingerprint, load, save

VERSION = 1
HEADER = re.compile(r'^\[(?:verse|chorus|pre[- ]?chorus|post[- ]?chorus|intro|outro|bridge|breakdown|refrain|hook|end|instrumental|solo|interlude|movement|spoken intro|spoken verse|final chorus|final verse|final tag|tag|turn)(?:\s+\d+)?\]$', re.I)
TOKEN = re.compile(r"[^\W_]+(?:['’\-][^\W_]+)*", re.UNICODE)
QUOTED = re.compile(r"(?:\"[^\"]*\"|“[^”]*”|(?<!\w)\x27[^\x27]*\x27(?!\w))", re.S)
NUMBER = r'(\d{1,6})'
PATTERNS = [
    ('range', re.compile(r'\bbetween\s+'+NUMBER+r'\s+and\s+'+NUMBER+r'\s+(?:lyric\s+)?words?\b', re.I)),
    ('range', re.compile(r'\b'+NUMBER+r'\s*[-–]\s*'+NUMBER+r'\s+(?:lyric\s+)?words?\b', re.I)),
    ('exact', re.compile(r'\b(?:exactly|a total of)\s+'+NUMBER+r'\s+(?:lyric\s+)?words?\b', re.I)),
    ('max', re.compile(r'\b(?:no more than|at most|maximum(?: of)?|up to|do not exceed|don.t exceed)\s+'+NUMBER+r'\s+(?:lyric\s+)?words?\b', re.I)),
    ('min', re.compile(r'\b(?:at least|minimum(?: of)?|no fewer than)\s+'+NUMBER+r'\s+(?:lyric\s+)?words?\b', re.I)),
    ('below', re.compile(r'\b(?:under|fewer than|below|less than)\s+'+NUMBER+r'\s+(?:lyric\s+)?words?\b', re.I)),
    ('above', re.compile(r'\b(?:more than|over)\s+'+NUMBER+r'\s+(?:lyric\s+)?words?\b', re.I)),
]


def lyric_words(text):
    """Count sung tokens, including repetitions; skip only known standalone labels."""
    return TOKEN.findall('\n'.join(line for line in text.splitlines() if not HEADER.fullmatch(line.strip())))


def extract(text):
    """Recognize a deliberately narrow set of whole-sheet numeric instructions."""
    if not isinstance(text, str):
        return []
    masked = QUOTED.sub(lambda m: ' ' * len(m.group()), text)
    limits = []
    for clause in re.split(r'[.;!?\n]', masked):
        occupied = []
        for kind, pattern in PATTERNS:
            for match in pattern.finditer(clause):
                if any(match.start() < b and a < match.end() for a, b in occupied):
                    continue
                prefix, suffix = clause[:match.start()].strip(' :,-\t'), clause[match.end():]
                # Treat numbers as instructions only in direct whole-sheet forms.
                # Narrative facts, per-section counts and quoted lyrics stay creative data.
                direct = re.fullmatch(
                    r"(?:please\s+)?(?:(?:write|use|include|keep|limit|target|aim for|make)(?:\s+|$))?"
                    r"(?:(?:the|this|my|a|your)\s+)?(?:(?:whole|entire|complete|full)\s+)?"
                    r"(?:(?:song|lyrics|lyric sheet|sheet|word count|total lyric word count)\s*)?"
                    r"(?:(?:to|at|within|of|with|in|should be|must be|must have|should have)\s*)?",
                    prefix, re.I)
                if not direct or re.search(r'\b(?:per|each|every|verse|chorus|bridge|line|letter|essay|novel)\b', suffix, re.I):
                    continue
                occupied.append(match.span())
                nums = [int(n) for n in match.groups()]
                if kind == 'range': lower, upper = nums
                elif kind == 'exact': lower = upper = nums[0]
                elif kind == 'max': lower, upper = 0, nums[0]
                elif kind == 'below': lower, upper = 0, nums[0]-1
                elif kind == 'min': lower, upper = nums[0], None
                else: lower, upper = nums[0]+1, None
                limits.append({'minimum': lower, 'maximum': upper})
    return limits


def prepare(directory, brief, admin_note=''):
    """Snapshot before the first call; leave accepted and pre-policy jobs alone."""
    directory = Path(directory)
    path = directory / 'lyric-constraints.json'
    identity = fingerprint({'brief': brief, 'adminNote': admin_note})
    if path.exists():
        saved = load(path)
        if saved.get('version') != VERSION or saved.get('inputHash') != identity:
            raise ValueError('Frozen lyric constraints belong to different planning inputs')
        return saved
    details = brief.get('details') or {}
    if details.get('voiceModel') not in (None, 'v8') or (details.get('voiceModel') is None and details.get('generation') is None):
        return None
    if any((directory / name).exists() for name in (
            'plan.json', 'planning-input.json', 'render-request.json', 'render-result.json',
            'material-planning-attempts.json')) or any(directory.glob('planner-result*.json')):
        return None
    submitted = extract(brief.get('prompt', ''))
    for field in ['direction', 'keep']:
        submitted.extend(extract(details.get(field, '')))
    private = extract(admin_note)
    chosen = private or submitted
    low = max([r['minimum'] for r in chosen], default=0)
    uppers = [r['maximum'] for r in chosen if r['maximum'] is not None]
    from generation_controls import normalize
    options = normalize(details.get('generation')) or {}
    value = {
        'version': VERSION, 'inputHash': identity,
        'limits': {'minimum': low, 'maximum': min(uppers) if uppers else None},
        'explicit_limit': bool(chosen),
        'limit_source': 'private_creative_note' if private else 'submitted_brief' if submitted else None,
        'vocal_entry_seconds': options.get('vocalEntry', 0),
        'ending_seconds': options.get('endingSeconds'),
        'density_is_advisory': True,
        'counting': 'Unicode word tokens; contractions and hyphenated words count once; known standalone section labels omitted; sung repeats count each time.',
    }
    save(path, value)
    return value


def guidance(contract):
    if not contract:
        return ''
    return ('\nMeasured lyric planning: count every written repetition as sung words, '
            'omit only standalone section labels, and count contractions/hyphenated words once. '
            'Honor these frozen whole-sheet word limits: ' + str(contract['limits']) +
            '. Required phrases, locked lines and supplied preserve-mode wording must remain intact. '
            'If those requirements conflict, use needs_attention with a concise explanation of '
            'incompatible creative constraints; do not silently cut protected words or expose a private note. '
            'Allocate verse/chorus development across the available vocal time. Reserve '
            f"{str(contract['ending_seconds']) + ' seconds for the ending' if contract['ending_seconds'] is not None else '8–12 seconds for the ending unless a longer ending is explicitly requested'}, and "
            f"{contract['vocal_entry_seconds']} seconds before vocal entry. "
            'Word density is planning evidence, not proof of an achieved singing speed or ending.')


def pacing(plan, contract):
    sections = []
    heading, count = 'Opening', 0
    for line in plan.get('lyrics', '').splitlines():
        if HEADER.fullmatch(line.strip()):
            if count:
                sections.append({'section': heading, 'words': count})
            heading, count = line.strip(), 0
        else:
            count += len(TOKEN.findall(line))
    if count:
        sections.append({'section': heading, 'words': count})
    words = sum(s['words'] for s in sections)
    ending = contract['ending_seconds']
    if ending is None and not plan.get('allow_long_instrumental_outro'):
        ending = 10
    available = max(0., plan['duration']-contract['vocal_entry_seconds']-ending) if ending is not None else None
    rate = words*60/available if available else None
    return {
        'version': VERSION, 'words': words, 'sections': sections,
        'available_vocal_seconds': available, 'words_per_vocal_minute': rate,
        'explicit_limits': contract['limits'], 'density_is_advisory': True,
        'density_note': 'Requested long-ending timing has no default density estimate.' if rate is None else 'Above the existing 80–110 melodic-word/minute guidance; assess delivery and available vocal time.'
            if rate is not None and rate > 110 else
            'Below the existing melodic-word/minute guidance; check sustained phrasing and avoid padding.'
            if rate is not None and rate < 80 else 'Within the existing melodic-word/minute guidance.',
        'achieved_timing_verified': False,
    }


def validate(plan, contract, directory):
    if not contract or plan['recipe'] not in ('new', 'reinterpretation'):
        return plan
    evidence = pacing(plan, contract)
    lower, upper = contract['limits']['minimum'], contract['limits']['maximum']
    count = evidence['words']
    error = None
    if contract['explicit_limit']:
        if upper is not None and upper < lower:
            error = 'Explicit whole-sheet lyric word limits conflict. Preserve protected wording and use needs_attention for incompatible creative constraints.'
        elif count < lower or (upper is not None and count > upper):
            target = f'{lower}–{upper}' if upper is not None else f'at least {lower}'
            error = (f'Lyric word count is {count}; the explicit whole-sheet limit is {target} words. '
                     'Count repeated sung lines, excluding standalone section headings. '
                     'Revise only unprotected wording; keep required phrases, locked lines and preserve-mode lyrics. '
                     'Use needs_attention if these creative constraints cannot coexist.')
    evidence.update(status='rejected' if error else 'accepted', error=error)
    save(Path(directory) / 'lyric-pacing.json', evidence)
    if error:
        raise ValueError(error)
    return plan
