"""Set a refused plan aside so the planner can run once more. Only before audio production starts.

Dehaka recommends; this trusted code decides whether a replan is allowed, keeps every earlier
planning file under replans/<n>/, and leaves one directive for the next planning pass. The
submitted brief is never edited. Nothing here can run after a render request exists.
"""
from pathlib import Path

from common import load, save, utc

DIRECTIVE = 'replan.json'
GUIDED_LIMIT = 3
AUTOMATIC_LIMIT = 1
STARTED = ('render-request.json', 'render-result.json', 'approved-plan.json')
PLANNING = ('plan.json', 'planning-input.json', 'plan-schema.json', 'duration-policy.json',
            'lyric-constraints.json', 'lyric-vocabulary-context.json', 'material-planning-attempts.json',
            'source-material.json', 'cover-lyrics.json', DIRECTIVE)
PATTERNS = ('planner-result*.json', 'planner*.log', 'material-planner-*.log', 'plan-before-*.json', '*-upgrade.json')


def bounded(value, limit):
    return ' '.join(str(value or '').split())[:limit]


def journal(directory):
    path = Path(directory) / 'replans' / 'journal.json'
    return load(path) if path.exists() else {'version': 1, 'replans': []}


def refusal(directory, guided, consultation=None):
    """Why this job cannot be replanned now, or None."""
    directory = Path(directory)
    if not directory.is_dir(): return 'The saved job folder is missing on this PC.'
    if any((directory / name).exists() for name in STARTED):
        return 'Audio production or a requester review has started; its frozen plan cannot be replaced.'
    rows = journal(directory)['replans']
    if consultation and any(row['consultation'] == consultation for row in rows): return None
    limit = GUIDED_LIMIT if guided else AUTOMATIC_LIMIT
    if len(rows) >= limit: return f'This request has used its {limit} replanning pass{"es" if limit > 1 else ""}.'
    return None


def prepare(directory, consultation, guided, note='', cover=None):
    """Archive the refused planning files and save the directive. One archive per consultation."""
    directory = Path(directory)
    blocked = refusal(directory, guided, consultation)
    if blocked: raise ValueError(blocked)
    record = journal(directory)
    existing = next((row for row in record['replans'] if row['consultation'] == consultation), None)
    if existing: return existing
    cover = {'artist': bounded(cover.get('artist'), 120), 'title': bounded(cover.get('title'), 120)} if cover and cover.get('title') else None
    row = {'number': len(record['replans']) + 1, 'consultation': consultation, 'guided': bool(guided), 'at': utc(),
           # Only an authenticated operator steer may redirect the song's creative plan.
           'note': bounded(note, 1500) if guided else '', 'cover': cover, 'files': []}
    archive = directory / 'replans' / str(row['number'])
    archive.mkdir(parents=True, exist_ok=True)
    paths = [directory / name for name in PLANNING]
    for pattern in PATTERNS: paths += sorted(directory.glob(pattern))
    # Journal first: an interrupted archive is finished by the next call instead of spending another pass.
    row['files'] = sorted({path.name for path in paths if path.is_file()})
    record['replans'].append(row); save(directory / 'replans' / 'journal.json', record)
    finish(directory, row)
    return row


def finish(directory, row):
    directory = Path(directory); archive = directory / 'replans' / str(row['number'])
    for name in row['files']:
        source = directory / name
        if not source.is_file() or (name == DIRECTIVE and load(source).get('number') == row['number']): continue
        source.replace(archive / name)
    save(directory / DIRECTIVE, {'version': 1, 'number': row['number'], 'consultation': row['consultation'],
                                 'note': row['note'], 'cover': row['cover'], 'at': row['at']})


def directive(directory):
    """The pending direction for the next planning pass, completing an interrupted archive first."""
    directory = Path(directory)
    rows = journal(directory)['replans']
    if not rows: return None
    latest = rows[-1]
    path = directory / DIRECTIVE
    if not path.exists() or load(path).get('number') != latest['number']:
        if any((directory / name).exists() for name in STARTED): return None
        finish(directory, latest)
    return load(path)
