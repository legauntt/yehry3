"""Idempotent release upload and a conflict-aware merge into the static catalog."""
import base64, hashlib, json, shutil, subprocess, time, urllib.request
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

def upload(config, prompt, mp3, directory, stop=None):
    metadata = prompt['result']; mp3 = Path(mp3)
    if mp3.stat().st_size != metadata['bytes'] or sha(mp3) != metadata['sha256']:
        raise ValueError('The verified MP3 changed before upload')
    name = f"{prompt['songId']}-{metadata['sha256'][:12]}.mp3"
    expected = f'https://github.com/{REPO}/releases/download/{TAG}/{name}'
    if prompt['releaseUrl'] != expected: raise ValueError('Unexpected release destination')
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

def song_record(prompt):
    result = prompt['result']
    return {'id': prompt['songId'], 'title': result['title'], 'url': prompt['releaseUrl'],
            'duration': result['duration'], 'collection': 'distonyc'}

def merge_catalog(catalog, record):
    existing = next((song for song in catalog['songs'] if song['id'] == record['id']), None)
    if existing:
        if existing != record: raise ValueError('The catalog already contains a different recording with this ID')
        return False
    catalog['songs'].insert(0, record)
    return True

def update_catalog(config, prompt):
    record = song_record(prompt)
    for attempt in range(4):
        current = gh_json(config, ['api', f'repos/{REPO}/contents/catalog.json?ref={BRANCH}'])
        catalog = json.loads(base64.b64decode(current['content']))
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
