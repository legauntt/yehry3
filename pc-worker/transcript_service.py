"""Watch the published catalog and add optional Whisper views after songs are released."""
import argparse
import base64
import json
import sys
import time
from pathlib import Path
from common import load, save, singleton, utc
from publish import BRANCH, REPO, catalog_content, gh_json
from transcript_data import public_transcript
from winprocess import run_owned


def snapshot(config):
    head = gh_json(config, ['api', f'repos/{REPO}/git/ref/heads/{BRANCH}'])['object']['sha']
    cache = Path(config['root']) / 'snapshot.json'
    if cache.exists():
        saved = load(cache)
        if saved.get('head') == head:
            return saved
    commit = gh_json(config, ['api', f'repos/{REPO}/git/commits/{head}'])
    tree = commit['tree']['sha']
    entries = gh_json(config, ['api', f'repos/{REPO}/git/trees/{tree}'])['tree']
    catalog = next(row for row in entries if row['path'] == 'catalog.json')
    songs = catalog_content(config, {**catalog, 'encoding': 'none'})['songs']
    folder = next((row for row in entries if row['path'] == 'lyric-transcripts'), None)
    transcripts = gh_json(config, ['api', f'repos/{REPO}/git/trees/{folder["sha"]}'])['tree'] if folder else []
    result = {'head': head, 'tree': tree, 'songs': songs,
              'transcripts': {row['path']: row['sha'] for row in transcripts if row['type'] == 'blob'}}
    save(cache, result)
    return result


def read_transcript(config, sha):
    blob = gh_json(config, ['api', f'repos/{REPO}/git/blobs/{sha}'])
    if blob.get('sha') != sha or blob.get('encoding') != 'base64':
        raise ValueError('Unexpected transcript blob')
    return json.loads(base64.b64decode(blob['content']))


def pending_songs(config, current, state):
    pending = []
    for song in current['songs']:
        sha = current['transcripts'].get(song['id'] + '.whisper.json')
        key = {'url': song['url'], 'duration': song['duration'], 'sha': sha}
        old = state.get(song['id'], {})
        if sha and old.get('ready') == key:
            continue
        if sha:
            try:
                public_transcript(read_transcript(config, sha), song)
                state[song['id']] = {'ready': key}
                continue
            except ValueError:
                pass
        if old.get('url') == song['url'] and old.get('retryAfter', 0) > time.time():
            continue
        pending.append(song)
    return pending


def publish_batch(config, documents):
    """Fast-forward only; rebuild on the latest tree if catalog/other files changed."""
    for attempt in range(4):
        current = snapshot(config)
        songs = {song['id']: song for song in current['songs']}
        entries = []
        for document in documents:
            song = songs.get(document['songId'])
            if not song or song['url'] != document['audioUrl']:
                continue
            clean = public_transcript(document, song)
            name = song['id'] + '.whisper.json'
            sha = current['transcripts'].get(name)
            if sha:
                try:
                    public_transcript(read_transcript(config, sha), song)
                    continue # Preserve an already published result or manual correction.
                except ValueError:
                    pass
            entries.append({'path': 'lyric-transcripts/' + name, 'mode': '100644', 'type': 'blob',
                            'content': json.dumps(clean, ensure_ascii=False, indent=2) + '\n'})
        if not entries:
            return None
        tree = gh_json(config, ['api', f'repos/{REPO}/git/trees', '--method', 'POST'],
                       {'base_tree': current['tree'], 'tree': entries})
        commit = gh_json(config, ['api', f'repos/{REPO}/git/commits', '--method', 'POST'],
                         {'message': f'Add Whisper audio transcripts for {len(entries)} recordings',
                          'tree': tree['sha'], 'parents': [current['head']]})
        try:
            gh_json(config, ['api', f'repos/{REPO}/git/refs/heads/{BRANCH}', '--method', 'PATCH'],
                    {'sha': commit['sha'], 'force': False})
            return commit['sha']
        except RuntimeError as error:
            if attempt == 3 or not any(code in str(error) for code in ('409', '422')):
                raise
    raise RuntimeError('Publication changed repeatedly; the next scheduled run will retry')


def run(config, limit=4):
    root = Path(config['root'])
    with singleton(root / 'service.lock') as owned:
        if not owned:
            return
        state_path = root / 'state.json'
        state = load(state_path) if state_path.exists() else {}
        current = snapshot(config)
        pending = pending_songs(config, current, state)
        catalog_path = root / 'catalog.json'
        save(catalog_path, {'songs': current['songs']})
        save(state_path, state)
        documents, results = [], []
        for song in pending[:limit]:
            save(root / 'health.json', {'at': utc(), 'status': 'transcribing', 'songId': song['id'], 'pending': len(pending)})
            target = root / 'drafts' / (song['id'] + '.whisper.json')
            command = [config['python'], '-X', 'utf8', str(Path(__file__).with_name('transcribe_catalog.py')),
                       '--catalog', str(catalog_path), '--song', song['id'], '--basis-root', config['basis_root'],
                       '--speech-root', config['speech_root'], '--cache', config['cache'], '--output', str(root / 'drafts')]
            if config.get('device') == 'cuda':
                command += ['--device', 'cuda', '--studio-dir', config['studio_dir'], '--engine-root', config['engine_root'],
                            '--cuda-root', config['cuda_root']]
            try:
                run_owned(command, root, root / 'jobs' / (song['id'] + '.log'), timeout=3600)
                document = public_transcript(load(target), song)
                documents.append(document)
                state.pop(song['id'], None)
                results.append({'songId': song['id'], 'status': 'ready'})
            except Exception as error:
                old = state.get(song['id'], {})
                attempts = old.get('attempts', 0) + 1 if old.get('url') == song['url'] else 1
                state[song['id']] = {'url': song['url'], 'attempts': attempts, 'error': str(error),
                                     'retryAfter': time.time() + (1800 if attempts < 3 else 86400)}
                results.append({'songId': song['id'], 'status': 'error', 'error': str(error)})
            save(state_path, state)
        commit = publish_batch(config, documents) if documents else None
        save(root / 'health.json', {'at': utc(), 'status': 'idle', 'pendingAtStart': len(pending),
                                   'commit': commit, 'results': results})
        return {'pending': len(pending), 'commit': commit, 'results': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--limit', type=int, default=4, choices=range(1, 17))
    args = parser.parse_args()
    config = load(args.config)
    root = Path(config['root'])
    root.mkdir(parents=True, exist_ok=True)
    log = root / 'service.log'
    if log.exists() and log.stat().st_size > 2 * 1024 * 1024:
        log.replace(log.with_suffix('.previous.log'))
    with log.open('a', encoding='utf-8', buffering=1) as output:
        previous_stdout, previous_stderr = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = output
        try:
            print(json.dumps({'at': utc(), 'result': run(config, args.limit)}), flush=True)
            return 0
        except Exception:
            import traceback
            traceback.print_exc()
            save(root / 'health.json', {'at': utc(), 'status': 'error', 'message': 'See the private service log'})
            return 1
        finally:
            sys.stdout, sys.stderr = previous_stdout, previous_stderr


if __name__ == '__main__':
    raise SystemExit(main())
