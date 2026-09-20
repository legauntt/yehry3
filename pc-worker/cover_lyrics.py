"""Retrieve the published words for a requested cover. Trusted code, one fixed lyrics service.

The planner never fetches anything. Before the first planning call, this module recognizes a
cover request that arrived without a lyric sheet, asks LRCLIB for the named song, verifies the
answer against the request's own words, and freezes the result in cover-lyrics.json. Every
retry re-applies that frozen journal, so the planning brief and its hash stay stable.
"""
import hashlib, json, re, urllib.error, urllib.parse, urllib.request
from pathlib import Path

from common import load, save, utc

SERVICE = 'https://lrclib.net/api/search'
AGENT = 'Distonyc worker (https://yehry3.app)'
JOURNAL = 'cover-lyrics.json'
COVER = re.compile(r"\b(?:covers?|covering|covered|rendition|remake)\b", re.I)
QUOTED = re.compile(r'["“]([^"“”\n]{1,120})["”]')
SINGING_RATE = 110
MAX_RESPONSE = 4_000_000


class LookupUnavailable(RuntimeError):
    """The lyrics service could not answer; retrying later is the supported repair."""


def normal(text):
    return ' '.join(re.sub(r"[^\w\s]", ' ', re.sub(r"['’]", '', str(text).casefold())).split())


def wording(brief):
    """The request's own words, unless it already brings a lyric sheet or a recorded source."""
    details = brief.get('details') or {}
    if (details.get('lyricSheet') or details.get('basisSongIds') or details.get('source')
            or details.get('remixSource')):
        return None
    return '\n'.join(str(value) for value in (brief.get('prompt', ''), details.get('direction', '')) if value)


def requested(brief):
    text = wording(brief)
    return text if text and COVER.search(text) else None


def queries(text, hint=None):
    """Most specific first. A hint is an artist/title pair named during guided recovery."""
    rows = []
    def add(title='', artist='', free=''):
        title, artist, free = (' '.join(str(value).split()).strip(' .,;:!?-')[:120] for value in (title, artist, free))
        row = {'q': free} if free else {'track_name': title, **({'artist_name': artist} if artist else {})}
        if (free or title) and row not in rows: rows.append(row)
    if hint and hint.get('title'): add(hint['title'], hint.get('artist', ''))
    match = COVER.search(text)
    rest = (text[match.end():] if match else text).split('\n')[0]
    rest = re.sub(r'^\s*(?:of|version of)\b', '', rest, flags=re.I)
    possessive = re.search(r"([^\"“”\n]{1,80}?)['’]s?\s+[\"“]([^\"“”\n]{1,120})[\"”]", rest)
    # "covers X covering Y's "Song"": the writer of the words is the artist nearest the title.
    if possessive: add(possessive.group(2), COVER.split(possessive.group(1))[-1])
    by = re.search(r'["“]([^"“”\n]{1,120})["”]\s+(?:by|from)\s+([^.,;()\n]{1,80})', text, re.I)
    if by: add(by.group(1), by.group(2))
    plain = re.search(r'^\s*(?:the song\s+)?([^"“”\n]{1,120}?)\s+by\s+([^.,;()\n]{1,80})', rest, re.I)
    if plain: add(plain.group(1), plain.group(2))
    for title in QUOTED.findall(text): add(title)
    add(free=re.sub(r'\s+', ' ', re.sub(r'[^\w\s\'’&-]', ' ', rest)).strip()[:120])
    return rows[:5]


def fetch(query, timeout=15):
    url = SERVICE + '?' + urllib.parse.urlencode(query)
    request = urllib.request.Request(url, headers={'User-Agent': AGENT, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            rows = json.loads(response.read(MAX_RESPONSE).decode('utf-8'))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        raise LookupUnavailable('Cover lyric lookup connection failed (temporary): ' + str(error)[:300]) from None
    return rows if isinstance(rows, list) else []


def usable(text):
    return (isinstance(text, str) and 20 <= len(text.split()) <= 3000
            and len(text.encode('utf-16-le')) // 2 <= 30000)


def choose(rows, text, hint=None):
    """Accept only a song the request (or the operator's hint) names; prefer the most repeated sheet."""
    wanted = ' ' + normal(text + ' ' + ' '.join((hint or {}).values())) + ' '
    groups = {}
    for row in rows:
        if not isinstance(row, dict) or row.get('instrumental') or not usable(row.get('plainLyrics')): continue
        title, artist = normal(row.get('trackName', '')), normal(row.get('artistName', ''))
        if not title or f' {title} ' not in wanted: continue
        named = bool(artist) and f' {artist} ' in wanted
        key = (named, artist, title, hashlib.sha256(normal(row['plainLyrics']).encode()).hexdigest())
        groups.setdefault(key, []).append(row)
    if not groups: return None
    # A named artist outranks popularity; identical sheets from several releases outrank a lone upload.
    artists = {}
    for key, found in groups.items(): artists[key[:2]] = artists.get(key[:2], 0) + len(found)
    best = max(groups, key=lambda key: (key[0], artists[key[:2]], len(groups[key]), len(key[2])))
    return groups[best][0]


def tidy(text):
    lines = [line.strip() for line in text.replace('\r\n', '\n').replace('\r', '\n').split('\n')]
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip()


def lookup(text, hint=None, get=None):
    tried = []; get = get or fetch
    for query in queries(text, hint):
        tried.append(query)
        row = choose(get(query), text, hint)
        if row:
            words = tidy(row['plainLyrics'])
            return {'status': 'found', 'service': 'lrclib', 'id': row.get('id'), 'artist': row.get('artistName', ''),
                    'title': row.get('trackName', ''), 'query': query, 'text': words,
                    'sha256': hashlib.sha256(words.encode('utf-8')).hexdigest()}
    return {'status': 'not_found', 'service': 'lrclib', 'queries': tried}


def mode(record, brief):
    """Frozen with the journal, so a later policy change cannot move a planned job's brief hash."""
    if record.get('mode') in ('preserve', 'adapt'): return record['mode']
    details = brief.get('details') or {}
    duration = (details.get('generation') or {}).get('duration')
    # A hosted composer refuses published lyrics, and a paid refusal cannot be replanned: write a loose cover.
    if details.get('musicBackend', 'local') != 'local': return 'adapt'
    # Keep every word unless the confirmed length cannot hold them at a singable pace.
    return 'adapt' if type(duration) is int and len(record['text'].split()) > duration / 60 * SINGING_RATE else 'preserve'


def sheet(record, brief):
    return {'mode': mode(record, brief), 'text': record['text'], 'origin': 'cover_lookup',
            'artist': record['artist'], 'title': record['title']}


def held(brief):
    """True when the worker, not the planner, writes the retrieved words into the plan."""
    found = (brief.get('details') or {}).get('lyricSheet')
    return isinstance(found, dict) and found.get('origin') == 'cover_lookup' and found.get('mode') == 'preserve'


def labeled(text):
    """Section the retrieved words without changing one: repeated stanzas are the chorus."""
    stanzas = [part.strip() for part in re.split(r'\n\s*\n', text) if part.strip()]
    if len(stanzas) < 2:
        lines = [line for line in text.splitlines() if line.strip()]
        stanzas = ['\n'.join(lines[i:i + 4]) for i in range(0, len(lines), 4)]
    seen = {}
    for part in stanzas: seen[normal(part)] = seen.get(normal(part), 0) + 1
    rows, verse = [], 0
    for part in stanzas:
        if seen[normal(part)] > 1: label = '[Chorus]'
        else: verse += 1; label = f'[Verse {verse}]'
        rows.append(label + '\n' + part)
    return '\n\n'.join(rows) + '\n[End]'


def planning_view(view):
    """The planner's copy of a held sheet describes the words instead of carrying them."""
    if not held(view): return view
    found = view['details']['lyricSheet']
    summary = {key: found[key] for key in ('mode', 'origin', 'artist', 'title')}
    summary.update(wordCount=len(found['text'].split()), stanzas=labeled(found['text']).count('\n\n') + 1,
                   text='[held by the worker and inserted word for word after planning]')
    return {**view, 'details': {**view['details'], 'lyricSheet': summary}}


def fill(plan, brief):
    """Write the held words into a new-music plan before any validation reads its lyrics."""
    if not held(brief) or not isinstance(plan, dict) or plan.get('recipe') != 'new': return plan
    return {**plan, 'lyrics': labeled(brief['details']['lyricSheet']['text']), 'movements': []}

def apply(directory, brief, hint=None, get=None):
    """Return the planning brief, with the retrieved sheet when this job has one.

    Only a job that has not planned yet may look anything up: an existing plan or planning
    snapshot without a journal predates this lookup and keeps its original brief.
    """
    directory = Path(directory); path = directory / JOURNAL
    if path.exists(): record = load(path)
    else:
        # Guided recovery may name the song even when the request never says "cover".
        text = requested(brief) or (wording(brief) if hint and hint.get('title') else None)
        if text is None: return brief
        if any((directory / name).exists() for name in ('plan.json', 'planning-input.json',
                                                         'render-request.json', 'render-result.json')):
            return brief
        record = {**lookup(text, hint, get), 'at': utc(), 'hint': hint or None}
        if record['status'] == 'found': record['mode'] = mode(record, brief)
        save(path, record)
    if record.get('status') != 'found': return brief
    if hashlib.sha256(record['text'].encode('utf-8')).hexdigest() != record['sha256']:
        raise ValueError('The saved cover lyric sheet changed after it was retrieved')
    return {**brief, 'details': {**(brief.get('details') or {}), 'lyricSheet': sheet(record, brief)}}


GUIDANCE = """
COVER REQUEST WITH A LYRIC SHEET:
This request asks Tony to cover a named published song, and details.lyricSheet holds its words:
either the requester submitted them, or (details.lyricSheet.origin=cover_lookup, with
artist/title) trusted worker code retrieved them because the request named the song. Treat the
sheet exactly like any submitted lyric sheet in its stated mode. Use recipe=new: Tony and the
band perform these words over newly composed music in the spirit of the named song's genre, tempo
and energy, or in the genre the request asks for. A cover is not a source-dependent rendition:
it needs no basis recording, saved source material or isolated vocals unless the requester
selected one, so a missing source recording is never a reason for needs_attention here. Do not
promise the original recording's melody. Give it a title that names the covered song, such as
"<Song> (Tony C Cover)".
"""


def guidance(brief):
    """Planner guidance for a cover that has words and no recorded source of its own."""
    details = brief.get('details') or {}
    sheet = details.get('lyricSheet')
    if not isinstance(sheet, dict) or details.get('basisSongIds') or details.get('source') or details.get('remixSource'):
        return ''
    text = '\n'.join(str(value) for value in (brief.get('prompt', ''), details.get('direction', '')) if value)
    if sheet.get('origin') != 'cover_lookup': return GUIDANCE if COVER.search(text) else ''
    return GUIDANCE + (HELD if held(brief) else LOOSE if sheet.get('mode') == 'adapt' else '')


HELD = """The worker holds the retrieved words and writes them into the plan itself, word for word, with
section labels. This replaces the instruction to write the exact lyrics into the plan: return
lyrics as an empty string and movements=[]. details.lyricSheet gives wordCount and stanzas instead
of the text. Choose a duration that fits wordCount at 80-110 sung words per minute, and describe
in arrangement how the verses and repeated chorus stanzas build to a resolved ending.
"""

LOOSE = """Write this one as a loose cover. Keep the named song's story, point of view, hook idea and
section structure so it is recognizably that song, but write every line in fresh wording of your
own. Do not reproduce the published lines: the composer service refuses published lyrics, and a
verbatim sheet cannot be produced. Keep the title form "<Song> (Tony C Cover)".
"""
