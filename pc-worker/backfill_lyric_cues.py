"""Backfill public line cues from saved local Troofs word timestamps."""
import argparse, difflib, json, os, re
from pathlib import Path
from common import API, load, save
from lyric_timing import WORD_FILES, make_cues

OVERRIDES = {
    # The final choir mix retains this exact Tony lead and its timeline.
    'medusa-church-choir': 'troofs-27-medusa-remix',
    # v3 owns the published delivery manifest and hashes.
    'movin-on-v6-extended': 'troofs-26-movin-on-extended-v3',
}


def clean(text):
    return '\n'.join(line.rstrip() for line in str(text or '').replace('\r\n', '\n').splitlines() if line.strip() != '[End]').strip()


def key(text):
    return ' '.join(re.findall(r'[a-z0-9]+', clean(text).casefold()))


def transcript(path):
    data = load(path)
    rows = data.get('segments', []) if isinstance(data, dict) else data
    return clean('\n'.join(row.get('text', '').strip() for row in rows if isinstance(row, dict))) if isinstance(rows, list) else ''


def published_hash(song):
    match = re.search(r'-([0-9a-f]{12,64})\.mp3(?:[?#].*)?$', str(song.get('url', '')), re.IGNORECASE)
    return match.group(1).lower() if match else ''


def delivery_hashes(directory):
    hashes = set()
    for name in ('delivery-manifest.json', 'desktop-delivery.json'):
        path = directory / name
        if not path.exists(): continue
        data = load(path)
        rows = data.get('files', []) if isinstance(data, dict) else data
        for row in rows if isinstance(rows, list) else []:
            value = str(row.get('sha256', '')).lower() if isinstance(row, dict) else ''
            if re.fullmatch(r'[0-9a-f]{64}', value): hashes.add(value)
    return hashes


def candidate(directory):
    if not any((directory / name).exists() for name in WORD_FILES): return None
    title, texts = directory.name, []
    for name in ('track.json', 'spec.json'):
        path = directory / name
        if not path.exists(): continue
        data = load(path)
        title = data.get('title') or title
        if data.get('lyrics'): texts.append(clean(data['lyrics']))
    for name in WORD_FILES:
        path = directory / name
        if path.exists(): texts.append(transcript(path))
    texts = [text for text in texts if text]
    return {
        'directory': directory,
        'title': title,
        'texts': texts,
        'keys': [key(text) for text in texts],
        'hashes': delivery_hashes(directory),
    } if texts else None


def choose(song, candidates, audio_hash=None):
    if song['id'] in OVERRIDES:
        item = next((item for item in candidates if item['directory'].name == OVERRIDES[song['id']]), None)
        return (item, 'verified production override') if item else (None, 'verified production override is missing')
    wanted_text, wanted_title = key(song['lyrics']['text']), key(song['title'])
    audio_hash = audio_hash or published_hash(song)
    hash_candidates = [item for item in candidates if audio_hash and any(value.startswith(audio_hash) for value in item.get('hashes', set()))]
    if len(hash_candidates) == 1:
        item = hash_candidates[0]
        text_score = max(difflib.SequenceMatcher(None, wanted_text, item_key, autojunk=False).ratio() for item_key in item['keys'])
        if text_score < .58:
            return None, f'published audio hash matched {item["directory"].name}, but lyric text score is only {text_score:.2f}'
        return item, f'published audio sha256={audio_hash}'
    if len(hash_candidates) > 1:
        return None, f'published audio hash is ambiguous across {len(hash_candidates)} saved productions'
    exact_candidates = [item for item in candidates if wanted_text in item['keys']]
    pool = exact_candidates
    if not pool:
        pool = sorted(candidates, key=lambda item: difflib.SequenceMatcher(None, wanted_title, key(item['title']), autojunk=False).ratio(), reverse=True)[:10]
    delivered = [item for item in pool if item.get('hashes')]
    if delivered: pool = delivered
    ranked = []
    for item in pool:
        title_score = difflib.SequenceMatcher(None, wanted_title, key(item['title']), autojunk=False).ratio()
        text_score = max(difflib.SequenceMatcher(None, wanted_text, item_key, autojunk=False).ratio() for item_key in item['keys'])
        exact = wanted_text in item['keys']
        score = (2 if exact else 0) + text_score * .8 + title_score * .2
        ranked.append((score, text_score, title_score, item))
    ranked.sort(key=lambda row: row[0], reverse=True)
    if not ranked: return None, 'no saved timing source'
    score, text_score, title_score, item = ranked[0]
    if score < .82 or (text_score < .58 and title_score < .94):
        return None, f'best match too weak: {item["directory"].name} text={text_score:.2f} title={title_score:.2f}'
    if len(ranked) > 1 and score < 2 and score - ranked[1][0] < .035:
        return None, f'ambiguous: {item["directory"].name} / {ranked[1][3]["directory"].name}'
    delivery = ' delivered' if item.get('hashes') else ''
    return item, f'text={text_score:.2f} title={title_score:.2f}{delivery}'


def sync_cues(config_path, songs):
    config = load(config_path)
    token = os.environ.get('DISTONYC_WORKER_TOKEN', '')
    if len(token) < 32: raise ValueError('The DPAPI-protected worker credential was not loaded')
    api = API(config['api'], config['worker_id'], token)
    for song in songs:
        api.call(f'/songs/{song["id"]}/lyrics/cues', {'lyrics': song['lyrics']})
        print(f'SYNC  {song["id"]}: {song["title"]} ({len(song["lyrics"]["cues"])} lines)')
    return len(songs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--studio-root', type=Path, required=True)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--replace', action='store_true')
    parser.add_argument('--require-all', action='store_true')
    parser.add_argument('--sync-config', type=Path, help='Immediately sync selected cues to Chairlift using the loaded worker credential')
    parser.add_argument('--song', action='append', help='Limit generation/sync to one song ID; repeat for additional songs')
    args = parser.parse_args()
    catalog = load(args.catalog)
    candidates = [item for item in (candidate(path) for path in args.studio_root.glob('troofs-*') if path.is_dir()) if item]
    selected = set(args.song or [])
    matched, unmatched, sync_rows = 0, [], []
    for song in catalog['songs']:
        if selected and song['id'] not in selected: continue
        if not song.get('lyrics'): continue
        if song['lyrics'].get('cues') and not args.replace:
            if args.sync_config: sync_rows.append(song)
            continue
        item, reason = choose(song, candidates)
        if not item:
            unmatched.append((song['id'], song['title'], reason)); continue
        cues = make_cues(item['directory'], song['lyrics']['text'], song['duration'])
        if not cues:
            unmatched.append((song['id'], song['title'], 'matched source produced no cues')); continue
        song['lyrics']['cues'] = cues; matched += 1
        if args.sync_config: sync_rows.append(song)
        print(f'MATCH {song["id"]}: {song["title"]} <- {item["directory"].name} ({reason}, {len(cues)} lines)')
    for identifier, title, reason in unmatched: print(f'MISS  {identifier}: {title} ({reason})')
    missing_ids = selected - {song['id'] for song in catalog['songs']}
    if missing_ids: raise ValueError('Unknown song ID: ' + ', '.join(sorted(missing_ids)))
    if args.require_all and unmatched: raise SystemExit(1)
    if args.write: save(args.catalog, catalog)
    synced = sync_cues(args.sync_config, sync_rows) if args.sync_config else 0
    print(json.dumps({'matched': matched, 'synced': synced, 'unmatched': len(unmatched), 'candidates': len(candidates)}))


if __name__ == '__main__': main()
