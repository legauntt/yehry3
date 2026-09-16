"""Finish recovery only after local artifacts, public bytes and the live catalog agree."""
import hashlib
import json
import urllib.request
from pathlib import Path

from common import inside, load, save, sha, utc
from publish import update_catalog, verify_download


def verify_delivery(config, prompt):
    directory = inside(Path(config['state_dir']) / 'jobs' / prompt['id'], Path(config['state_dir']) / 'jobs')
    journal = directory / 'delivery-check.json'
    if journal.exists() and load(journal).get('status') == 'verified': return load(journal)
    if prompt['status'] != 'published': return {'status': 'waiting_for_publication'}
    result = load(directory / 'render-result.json')
    if result.get('status') != 'verified': raise ValueError('Missing verified local delivery')
    files = result.get('files', [])
    if {Path(item['path']).suffix.lower() for item in files} != {'.mp3', '.wav'}:
        raise ValueError('Recovery requires both MP3 and WAV')
    for item in files:
        suffix = Path(item['path']).suffix.lower()
        path = inside(item['path'], Path(config['settings']['output_dir']) / (suffix[1:] + 's'))
        if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
            raise ValueError('Local delivery hash mismatch')
    mp3 = next(item for item in files if Path(item['path']).suffix.lower() == '.mp3')
    if any(prompt['result'][key] != mp3[key] for key in ('bytes', 'sha256')):
        raise ValueError('Published result differs from retained MP3')
    song_id = 'distonyc-' + hashlib.sha256(prompt['id'].encode()).hexdigest()[:24]
    url = f"https://github.com/legauntt/yehry3/releases/download/distonyc-v1/{song_id}-{mp3['sha256'][:12]}.mp3"
    if prompt.get('publishedUrl') != url: raise ValueError('Unexpected published recovery destination')
    verified = {'status': 'waiting_for_catalog', 'at': utc(), 'request_id': prompt['id'],
                'mp3_sha256': mp3['sha256'], 'wav_sha256': next(i['sha256'] for i in files if i['path'].lower().endswith('.wav')),
                'url': url}
    cached = load(journal) if journal.exists() else {}
    if cached.get('public_sha256') != mp3['sha256']:
        verify_download(url, mp3)
    verified['public_sha256'] = mp3['sha256']
    save(journal, verified)
    update_catalog(config, {**prompt, 'songId': song_id, 'releaseUrl': url})
    with urllib.request.urlopen('https://yehry3.app/catalog.json', timeout=20) as response:
        catalog = json.load(response)
    live = next((song for song in catalog['songs'] if song['id'] == song_id), None)
    if not live or live.get('url') != url:
        return verified
    # A ranged GET checks the same public playback URL without downloading it a second time.
    request = urllib.request.Request(url, headers={'Range': 'bytes=0-1023'})
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status not in (200, 206) or len(response.read(1024)) != 1024:
            raise ValueError('Live playback asset is unavailable')
    verified.update(status='verified', at=utc(), live_catalog=True, playback_bytes=True)
    save(journal, verified)
    return verified
