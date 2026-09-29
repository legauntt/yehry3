"""Find saved original mixes that still correspond to the released Tony mix."""
import argparse
import json
from pathlib import Path

from common import load
from guide_audio import capture
from publish import asset_url, backfill_catalog_guide, update_guide_catalog, upload_asset


def candidates(config, catalog):
    published = {song['id']: song for song in catalog['songs'] if song.get('url')}
    jobs = Path(config['state_dir']) / 'jobs'
    for directory in jobs.iterdir():
        if not directory.is_dir() or not (directory / 'render-result.json').is_file() or not (directory / 'prompt.json').is_file():
            continue
        prompt, result = load(directory / 'prompt.json'), load(directory / 'render-result.json')
        song = published.get(prompt.get('songId'))
        if not song or song.get('guide'):
            continue
        if not any(asset_url(song['id'], row['sha256']) == song['url']
                   for row in result.get('files', []) if str(row.get('path', '')).lower().endswith('.mp3')):
            continue
        work = Path(result.get('work_path') or '')
        if not (directory / 'guide.json').is_file() and not any((work / name).is_file()
                                                             for name in ('paid-original.mp3', 'generated.wav')):
            continue
        yield song, result, directory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--capture', action='store_true', help='Save and verify available original mixes locally')
    parser.add_argument('--upload-only', action='store_true', help='Upload and verify guide MP3s without catalog edits')
    parser.add_argument('--stage-local', action='store_true', help='Write verified guide rows into the local catalog and manifest')
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    config = load(args.config)
    catalog = load(args.catalog)
    seen = set()
    staged = {}
    for song, result, directory in candidates(config, catalog):
        if song['id'] in seen:
            continue
        seen.add(song['id'])
        print(f"{song['id']} | {song['title']} | {directory}", flush=True)
        if not (args.capture or args.upload_only or args.stage_local or args.publish):
            continue
        guide = capture(config, result, directory)
        if not guide:
            print('  No distinct guide mix', flush=True)
            continue
        if args.capture and not (args.upload_only or args.stage_local or args.publish):
            print(f"  Captured guide {guide['sha256'][:12]} ({guide['duration']:.1f}s)", flush=True)
            continue
        if args.upload_only or args.publish:
            upload_asset(config, song['id'], guide, directory / 'guide.mp3', directory)
            print(f"  Verified public guide {guide['sha256'][:12]}", flush=True)
        if args.publish:
            backfill_catalog_guide(config, song['id'], song['url'], guide)
            update_guide_catalog(config, song['id'], guide)
        if args.stage_local:
            row = {**guide, 'url': asset_url(song['id'], guide['sha256'])}
            song['guide'] = row
            staged[song['id']] = row
    if args.stage_local and staged:
        catalog_path = Path(args.catalog)
        catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        manifest = catalog_path.parent / 'assets' / 'guide-catalog.js'
        prefix = '// Published pre-replacement mixes, keyed by the song they accompany.\n'
        prefix += '// The Distonyc worker adds entries after verifying each public MP3.\n'
        current = manifest.read_text(encoding='utf-8')
        if not current.startswith(prefix + 'export default '):
            raise ValueError('Unexpected guide manifest format')
        guides = json.loads(current[len(prefix + 'export default '):].strip()[:-1])
        for song_id, row in staged.items():
            if song_id in guides and guides[song_id] != row:
                raise ValueError('Conflicting guide manifest entry')
            guides[song_id] = row
        manifest.write_text(prefix + 'export default ' + json.dumps(guides, ensure_ascii=False, indent=2, sort_keys=True) + ';\n', encoding='utf-8')
        print(f'Staged {len(staged)} guide pairs in local catalog and manifest', flush=True)


if __name__ == '__main__':
    main()
