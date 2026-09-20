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


def sheet(record, brief):
    """Keep every word unless the confirmed length cannot hold them at a singable pace."""
    duration = ((brief.get('details') or {}).get('generation') or {}).get('duration')
    count = len(record['text'].split())
    mode = 'adapt' if type(duration) is int and count > duration / 60 * SINGING_RATE else 'preserve'
    return {'mode': mode, 'text': record['text'], 'origin': 'cover_lookup',
            'artist': record['artist'], 'title': record['title']}


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
        save(path, record)
    if record.get('status') != 'found': return brief
    if hashlib.sha256(record['text'].encode('utf-8')).hexdigest() != record['sha256']:
        raise ValueError('The saved cover lyric sheet changed after it was retrieved')
    return {**brief, 'details': {**(brief.get('details') or {}), 'lyricSheet': sheet(record, brief)}}


GUIDANCE = """
COVER REQUEST WITH RETRIEVED WORDS:
details.lyricSheet.origin=cover_lookup means trusted worker code retrieved the published words of
the named song (details.lyricSheet.artist/title) because the request asks Tony to cover it. Treat
it exactly like a submitted lyric sheet in its stated mode. Use recipe=new: Tony and the band
perform these words over newly composed music in the spirit of the named song's genre, tempo and
energy. Do not promise the original recording's melody, and do not require basis recordings or
saved source material. A cover request with a retrieved sheet is not a reason for needs_attention.
Give it a title that names the covered song, such as "<Song> (Tony C Cover)".
"""
