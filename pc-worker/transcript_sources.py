"""Resolve actual released audio, preferring a verified converted Tony stem."""
import hashlib
import re
import time
import urllib.request
from pathlib import Path
from transcribe_performance import digest, performance_source, read, write


def released_address(song):
    address = song['url']
    if address.startswith('/fearhunger/audio/') and '..' not in address:
        return 'https://yehry3.app' + address
    if re.fullmatch(r'https://github\.com/legauntt/(?:yehry3|gatsby-opus)/releases/download/[a-zA-Z0-9._-]+/[a-zA-Z0-9._%-]+\.mp3', address):
        return address
    raise ValueError('Unsupported public recording address')


def released_audio(song, cache):
    address = released_address(song)
    target = Path(cache) / 'released-audio' / hashlib.sha256(address.encode()).hexdigest()
    recording, evidence = target / 'recording.mp3', target / 'source.json'
    if evidence.exists() and recording.exists():
        info = read(evidence)
        if info.get('url') != song['url'] or info.get('sha256') != digest(recording):
            raise ValueError('Cached released audio changed')
    else:
        target.mkdir(parents=True, exist_ok=True)
        temporary = target / 'recording.download'
        total, started = 0, time.monotonic()
        try:
            with urllib.request.urlopen(address, timeout=40) as response, temporary.open('wb') as output:
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > 128 * 1024 * 1024 or time.monotonic() - started > 180:
                        raise ValueError('Released recording exceeds download bounds')
                    output.write(chunk)
            if not total:
                raise ValueError('Empty released recording')
            audio_hash = digest(temporary)
            match = re.search(r'-([a-f0-9]{12,64})\.mp3$', song['url'])
            if match and not audio_hash.startswith(match[1]):
                raise ValueError('Downloaded recording differs from its public hash')
            temporary.replace(recording)
            info = {'url': song['url'], 'sha256': audio_hash, 'bytes': total,
                    'verified_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            write(evidence, info)
        finally:
            temporary.unlink(missing_ok=True)
    return recording, evidence, info['sha256']


def resolve_source(song, basis_root, cache):
    if not re.fullmatch(r'[a-z0-9-]{1,120}', song['id']):
        raise ValueError('Invalid song ID')
    released_address(song)
    def usable_stem(source):
        # Some final exports trim a retained, pre-finish vocal stem. Recognize
        # the released mix instead of guessing how those timelines align.
        import av
        with av.open(str(source['vocals'])) as audio:
            duration = audio.duration / av.time_base if audio.duration is not None else None
        if duration is None or abs(duration - song['duration']) > 2:
            raise ValueError('Retained vocals do not match the released timeline')
        return source
    try:
        return usable_stem(performance_source(song, basis_root))
    except ValueError:
        # A missing/invalid stem is never replaced with the guide singer. The
        # recording heard on the site is independently downloaded and hashed.
        recording, manifest, audio_hash = released_audio(song, cache)
        try:
            return usable_stem(performance_source(song, basis_root, verified_audio_hash=audio_hash))
        except ValueError:
            return {'recording': recording, 'vocals': recording, 'manifest': manifest,
                    'audio_sha256': audio_hash, 'vocal_sha256': audio_hash,
                    'manifest_sha256': digest(manifest), 'input': 'released-recording'}
