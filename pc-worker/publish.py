"""Idempotent release upload and a conflict-aware merge into the static catalog."""
import base64, hashlib, json, re, shutil, subprocess, time, urllib.request
from pathlib import Path
from common import load, sha, save
from winprocess import Stopped, child_env, run_owned

REPO = 'legauntt/yehry3'
TAG = 'distonyc-v1'
BRANCH = 'talandar'

def gh_json(config, args, body=None):
    command = [config['gh'], *args]
    if body is not None: command += ['--input', '-']
    result = subprocess.run(command, input=None if body is None else json.dumps(body), capture_output=True,
        text=True, encoding='utf-8', env=child_env(), timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode: raise RuntimeError('GitHub request failed: ' + result.stderr[-700:])
    return json.loads(result.stdout) if result.stdout.strip() else None

def release(config):
    # A failed lookup never creates a second release: the tag is unique on GitHub.
    try: return gh_json(config, ['api', f'repos/{REPO}/releases/tags/{TAG}'])
    except RuntimeError as error:
        if '404' not in str(error): raise
        return gh_json(config, ['api', f'repos/{REPO}/releases', '--method', 'POST'], {
            'tag_name': TAG, 'target_commitish': BRANCH, 'name': 'Distonyc · Tony C requests',
            'body': 'Songs requested at yehry3.app, rendered locally with the saved Tony V6 voice.',
            'draft': False, 'prerelease': False})

def verify_download(url, metadata, stop=None):
    count = 0; digest = hashlib.sha256()
    deadline = time.monotonic() + 120
    with urllib.request.urlopen(url, timeout=15) as response:
        while chunk := response.read(1024 * 1024):
            if stop and stop(): raise Stopped('Lease lost during verification')
            if time.monotonic() > deadline: raise TimeoutError('Public MP3 verification timed out; publication will retry')
            count += len(chunk)
            if count > metadata['bytes']: raise ValueError('The public MP3 has an unexpected size')
            digest.update(chunk)
    if count != metadata['bytes'] or digest.hexdigest() != metadata['sha256']:
        raise ValueError('The public MP3 differs from the verified local mix')

def asset_url(song_id, digest):
    return f'https://github.com/{REPO}/releases/download/{TAG}/{song_id}-{digest[:12]}.mp3'


def upload(config, prompt, mp3, directory, stop=None):
    if prompt['releaseUrl'] != asset_url(prompt['songId'], prompt['result']['sha256']): raise ValueError('Unexpected release destination')
    upload_asset(config, prompt['songId'], prompt['result'], mp3, directory, stop)


def upload_alternates(config, prompt, directory, stop=None):
    """B sides the server accepted with this song. Their addresses come from their hashes, like the song's own."""
    rows = prompt['result'].get('alternates') or []
    if not rows: return
    from pitch_alternate import saved
    item = saved(directory, config)
    for row in rows:
        if not item or any(item[key] != row[key] for key in ('pitchRepair', 'sha256', 'bytes')):
            raise ValueError('The saved B side differs from the server result')
        upload_asset(config, prompt['songId'], row, item['mp3'], directory, stop)


def upload_asset(config, song_id, metadata, mp3, directory, stop=None):
    mp3 = Path(mp3)
    if mp3.stat().st_size != metadata['bytes'] or sha(mp3) != metadata['sha256']:
        raise ValueError('The verified MP3 changed before upload')
    name = f"{song_id}-{metadata['sha256'][:12]}.mp3"
    expected = asset_url(song_id, metadata['sha256'])
    info = release(config)
    existing = next((asset for asset in info['assets'] if asset['name'] == name), None)
    if existing and existing['size'] != metadata['bytes']: raise ValueError('A conflicting release asset already exists')
    if not existing:
        destination = Path(directory) / name
        if not destination.exists() or sha(destination) != metadata['sha256']: shutil.copy2(mp3, destination)
        run_owned([config['gh'], 'release', 'upload', TAG, str(destination), '--repo', REPO],
            directory, Path(directory) / 'upload.log', stop, timeout=600)
    # No --clobber: a lost response is recovered by verifying the existing asset.
    verify_download(expected, metadata, stop)

def original_prompt(prompt):
    details = prompt.get('details') or {}
    return {'idea': prompt['prompt'], 'direction': details.get('direction', ''),
            'keep': details.get('keep', ''),
            'basisSongs': details.get('basisSongTitles', [details['source']] if details.get('source') else []),
            'voiceModel': details.get('voiceModel', 'v6'),
            **({'musicBackend': details['musicBackend']} if details.get('musicBackend') else {}),
            **({'generation': __import__('generation_controls').normalize(details['generation']), 'generationProfile': 'v8'} if details.get('generation') else {})}


def song_record(prompt):
    result = prompt['result']
    source = (prompt.get('details') or {}).get('remixSource')
    return {'id': prompt['songId'], 'title': result['title'], 'url': prompt['releaseUrl'],
            'duration': result['duration'], 'collection': 'distonyc',
            'voiceModel': (prompt.get('details') or {}).get('voiceModel', 'v6'),
            **({'remixOf': {key: source[key] for key in ('songId', 'title', 'url')}} if source else {}),
            **({'publishedAt': prompt['publishedAt']} if prompt.get('publishedAt') else {}),
            **({'authoredBy': prompt['authoredBy']} if prompt.get('authoredBy') else {}),
            **({'songPlan': prompt['songPlan']} if prompt.get('songPlan') else {}),
            **{key: result[key] for key in ['lyrics', 'collections', 'qualityIssues', 'validationFailures', 'reviewState', 'generationProfile', 'musicBackend', 'pitchRepair'] if key in result},
            **({'alternates': [{**row, 'url': asset_url(prompt['songId'], row['sha256'])} for row in result['alternates']]} if result.get('alternates') else {}),
            **({'originalPrompt': original_prompt(prompt)} if prompt.get('prompt') else {})}

def merge_catalog(catalog, record):
    existing = next((song for song in catalog['songs'] if song['id'] == record['id']), None)
    if existing:
        for key, value in record.items():
            if key in existing and existing[key] != value: raise ValueError('The catalog already contains different metadata with this ID')
        changed = any(key not in existing for key in record)
        existing.update(record)
        return changed
    catalog['songs'].insert(0, record)
    return True

def catalog_content(config, current):
    # Contents responses omit data above 1 MiB. Read the immutable blob named by
    # that response, so a concurrent branch update cannot mix content/revisions.
    if current.get('encoding') == 'none':
        revision = current['sha']
        if not re.fullmatch(r'[0-9a-f]{40}', revision):
            raise ValueError('Invalid catalog revision')
        blob = gh_json(config, ['api', f'repos/{REPO}/git/blobs/{revision}'])
        if blob.get('sha') != revision or blob.get('encoding') != 'base64':
            raise ValueError('GitHub returned a different catalog blob')
        content = base64.b64decode(blob['content'])
        digest = hashlib.sha1(b'blob ' + str(len(content)).encode() + b'\0' + content).hexdigest()
        if digest != revision or len(content) != current['size'] or len(content) != blob['size']:
            raise ValueError('Catalog blob failed revision or size verification')
    else:
        content = base64.b64decode(current['content'])
    return json.loads(content)


def update_catalog(config, prompt):
    record = song_record(prompt)
    for attempt in range(4):
        current = gh_json(config, ['api', f'repos/{REPO}/contents/catalog.json?ref={BRANCH}'])
        catalog = catalog_content(config, current)
        if not merge_catalog(catalog, record): return
        content = (json.dumps(catalog, ensure_ascii=False, indent=2) + '\n').encode()
        try:
            gh_json(config, ['api', f'repos/{REPO}/contents/catalog.json', '--method', 'PUT'], {
                'message': f"Publish Distonyc song {record['id']}", 'branch': BRANCH,
                'sha': current['sha'], 'content': base64.b64encode(content).decode()})
            return
        except RuntimeError as error:
            if attempt == 3 or not any(code in str(error) for code in ['409', '422']): raise
    raise RuntimeError('Catalog changed repeatedly; publication will retry from the saved mix')
