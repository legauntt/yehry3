"""Add saved request plans to a catalog, matching both request ID and recording hash.

Default is a read-only audit. --write updates only missing catalog songPlan fields.
--sync also fills missing API metadata through the authenticated worker endpoint.
No planning, generation, queue transitions or audio uploads are performed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
from common import API, load, save
from public_plan import public_plan


def candidates(catalog, jobs):
    records = {song['id']: song for song in catalog['songs']}
    matches, skipped = [], []
    for directory in sorted(Path(jobs).iterdir()):
        if not directory.is_dir():
            continue
        song_id = 'distonyc-' + hashlib.sha256(directory.name.encode()).hexdigest()[:24]
        song = records.get(song_id)
        if not song:
            continue
        if not (directory / 'plan.json').exists() or not (directory / 'render-result.json').exists():
            skipped.append({'id': song_id, 'reason': 'No saved plan or verified render result'})
            continue
        prompt = load(directory / 'prompt.json')
        result = load(directory / 'render-result.json')
        plan = load(directory / 'plan.json')['plan']
        if (directory / 'render-request.json').exists() and load(directory / 'render-request.json')['plan'] != plan:
            skipped.append({'id': song_id, 'reason': 'Saved plan differs from frozen render inputs'})
            continue
        mp3s = [item for item in result.get('files', []) if Path(item['path']).suffix.lower() == '.mp3']
        if prompt.get('id') != directory.name or prompt.get('songId') != song_id or len(mp3s) != 1 or result.get('status') != 'verified':
            skipped.append({'id': song_id, 'reason': 'Request or verified recording identity differs'})
            continue
        expected = f"https://github.com/legauntt/yehry3/releases/download/distonyc-v1/{song_id}-{mp3s[0]['sha256'][:12]}.mp3"
        if song['url'] != expected or song['title'] != plan['title']:
            skipped.append({'id': song_id, 'reason': 'Published title or recording hash differs'})
            continue
        public = public_plan(plan)
        # A later summary backfill must not replace or invalidate the original frozen plan.
        existing_settings = (song.get('songPlan') or {}).get('musicalSettings')
        if existing_settings is not None and 'musicalSettings' not in public:
            from musical_settings import public_settings
            public['musicalSettings'] = public_settings(existing_settings)
        if song.get('songPlan') is not None and song['songPlan'] != public:
            raise ValueError(f'A different song plan is already saved for {song_id}')
        matches.append({'id': song_id, 'title': song['title'], 'url': song['url'], 'songPlan': public})
    return matches, skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--jobs', type=Path, required=True)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--sync', action='store_true')
    parser.add_argument('--config', type=Path)
    args = parser.parse_args()
    catalog = load(args.catalog)
    matches, skipped = candidates(catalog, args.jobs)
    records = {song['id']: song for song in catalog['songs']}
    added = sum('songPlan' not in records[item['id']] for item in matches)
    for item in matches:
        records[item['id']]['songPlan'] = item['songPlan']
    if args.sync:
        if not args.config:
            parser.error('--sync requires --config')
        config = load(args.config)
        api = API(config['api'], config['worker_id'], os.environ.pop('DISTONYC_WORKER_TOKEN'))
        for item in matches:
            api.call('/songs/' + item['id'] + '/plan', {'url': item['url'], 'songPlan': item['songPlan']})
    if args.write and added:
        save(args.catalog, catalog)
    print(json.dumps({'matched': len(matches), 'added': added if args.write else 0,
                      'would_add': added, 'synced': len(matches) if args.sync else 0,
                      'without_plan': sum(not song.get('songPlan') for song in catalog['songs']),
                      'skipped': skipped, 'titles': [item['title'] for item in matches]}))


if __name__ == '__main__':
    main()
