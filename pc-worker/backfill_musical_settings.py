"""Add reviewed descriptions from existing public plans, without replanning recordings."""
import argparse
import copy
import json
import os
import re
from pathlib import Path
from common import API, fingerprint, load, save
from musical_settings import public_settings


def section_order(plan):
    headings = [line.strip()[1:-1] for line in plan.get('lyrics', '').splitlines()
                if re.fullmatch(r'\[[^\[\]]+\]', line.strip()) and line.strip().lower() != '[end]']
    result = ' → '.join(headings)
    return result if len(result.encode('utf-16-le')) // 2 <= 600 else ''


def prepare(catalog, manifest):
    if manifest.get('version') != 1 or manifest.get('source') != 'existing-public-song-plans':
        raise ValueError('Unsupported musical-settings backfill manifest')
    records = {song['id']: song for song in catalog['songs']}
    entries = manifest['songs']
    if len({entry['id'] for entry in entries}) != len(entries):
        raise ValueError('Duplicate song in backfill manifest')
    changes = []
    for entry in entries:
        song = records.get(entry['id'])
        if not song or not re.fullmatch(r'[a-z0-9-]{1,120}', entry['id']):
            raise ValueError('Unknown backfill song')
        if song['url'] != entry['url'] or song['title'] != entry['title']:
            raise ValueError('Backfill recording identity changed: ' + entry['id'])
        saved = song.get('songPlan')
        if not saved:
            raise ValueError('Backfill needs an existing saved public plan: ' + entry['id'])
        original = {key: value for key, value in saved.items() if key != 'musicalSettings'}
        if fingerprint(original) != entry['planHash']:
            raise ValueError('Saved public plan changed: ' + entry['id'])
        settings = public_settings(entry['musicalSettings'])
        if settings != entry['musicalSettings']:
            raise ValueError('Unknown musical metadata in manifest')
        # Every prose description is a reviewed excerpt of the original arrangement.
        arrangement = original['arrangement'].casefold()
        for value in [settings[key] for key in ('genre', 'meter', 'performance', 'energy', 'lyricWorkflow')] + settings['instruments']:
            if value.casefold() not in arrangement:
                raise ValueError('Description has no saved arrangement evidence: ' + entry['id'])
        if settings['structure'] != section_order(original):
            raise ValueError('Section order does not match the saved lyrics: ' + entry['id'])
        if 'musicalSettings' in saved and saved['musicalSettings'] != settings:
            raise ValueError('A different musical summary is already saved: ' + entry['id'])
        changes.append({'id': song['id'], 'url': song['url'],
                        'songPlan': {**copy.deepcopy(original), 'musicalSettings': settings},
                        'missing': 'musicalSettings' not in saved})
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--sync', action='store_true')
    parser.add_argument('--config', type=Path)
    args = parser.parse_args()
    catalog = load(args.catalog)
    changes = prepare(catalog, load(args.manifest))  # Validate the whole batch before any write.
    if args.sync:
        if not args.config:
            parser.error('--sync requires --config')
        config = load(args.config)
        api = API(config['api'], config['worker_id'], os.environ.pop('DISTONYC_WORKER_TOKEN'))
        for index, change in enumerate(changes, 1):
            api.call('/songs/' + change['id'] + '/plan',
                     {'url': change['url'], 'songPlan': change['songPlan']})
            print(json.dumps({'synced': index, 'total': len(changes), 'id': change['id']}), flush=True)
    if args.write:
        by_id = {change['id']: change for change in changes}
        for song in catalog['songs']:
            if song['id'] in by_id:
                song['songPlan'] = by_id[song['id']]['songPlan']
        save(args.catalog, catalog)
    print(json.dumps({'reviewed': len(changes), 'missing': sum(x['missing'] for x in changes),
                      'written': args.write, 'synced': len(changes) if args.sync else 0}))


if __name__ == '__main__':
    main()
