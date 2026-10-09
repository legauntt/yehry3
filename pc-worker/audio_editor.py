"""CPU-only admin audio editing. Originals and existing release assets are never replaced."""
import argparse
import array
import json
import math
import os
from pathlib import Path
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from common import API, APIError, inside, load, save, sha, singleton, utc
from publish import upload_asset
from winprocess import child_env

LIMIT = 64000000


def run(command, timeout=300):
    return subprocess.run([str(v) for v in command], capture_output=True, check=True, env=child_env(),
                          timeout=timeout, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout


def probe(config, path):
    ffprobe = Path(config['settings']['ffmpeg']).with_name('ffprobe.exe' if os.name == 'nt' else 'ffprobe')
    return float(json.loads(run([ffprobe, '-v', 'error', '-show_entries', 'format=duration',
                                 '-of', 'json', path]))['format']['duration'])


def validate_job(job):
    if not re.fullmatch(r'[a-z0-9-]{1,120}', job['songId']) or not re.fullmatch(r'[a-f0-9-]{36}', job['editId']):
        raise ValueError('Invalid job identity')
    source = job['source']
    if not re.fullmatch(r'https://(?:github\.com/legauntt/(?:yehry3|gatsby-opus)/releases/download/[a-zA-Z0-9._-]+/[a-zA-Z0-9._%-]+|yehry3\.app/[a-zA-Z0-9_./%-]+)\.mp3', source['url']):
        raise ValueError('Unsupported source')
    if not math.isfinite(source['duration']) or not 1 <= source['duration'] <= 1440:
        raise ValueError('Invalid source duration')
    if job['kind'] == 'render' and not (1 <= job['end'] <= source['duration'] and 0 <= job['fade'] <= min(60, job['end'])):
        raise ValueError('Invalid crop or fade')


def source_file(job, directory):
    target = directory / 'original.mp3'
    receipt = directory / 'source.json'
    source = job['source']
    if target.exists() and receipt.exists():
        previous = load(receipt)
        if previous['url'] == source['url'] and previous['sha256'] == sha(target):
            return target
        raise ValueError('Saved source changed')
    temporary = directory / 'download.tmp'
    deadline = time.monotonic() + 180
    try:
        with urllib.request.urlopen(source['url'], timeout=20) as response, temporary.open('wb') as output:
            count = 0
            while block := response.read(1024 * 1024):
                count += len(block)
                if count > LIMIT or time.monotonic() > deadline:
                    raise ValueError('Source exceeds download limits')
                output.write(block)
        digest = sha(temporary)
        pinned = re.search(r'-([a-f0-9]{12,64})\.mp3$', source['url'])
        if (source.get('sha256') and digest != source['sha256'] or
                source.get('bytes') and count != source['bytes'] or pinned and not digest.startswith(pinned[1])):
            raise ValueError('Source recording hash or size changed')
        temporary.replace(target)
        save(receipt, {'url': source['url'], 'sha256': digest, 'bytes': count})
        return target
    finally:
        temporary.unlink(missing_ok=True)


def render(config, job, directory):
    original = source_file(job, directory)
    if abs(probe(config, original) - job['source']['duration']) > 2:
        raise ValueError('Source duration changed')
    output, receipt = directory / 'edited.mp3', directory / 'render.json'
    settings = {key: job[key] for key in ('end', 'fade')}
    settings['sourceSha256'] = sha(original)
    if receipt.exists():
        previous = load(receipt)
        if previous['settings'] != settings or not output.exists() or sha(output) != previous['result']['sha256']:
            raise ValueError('Saved edit changed')
        return output, previous['result']
    end, fade = job['end'], job['fade']
    filters = f'atrim=end={end},asetpts=PTS-STARTPTS'
    if fade:
        filters += f',afade=t=out:st={end - fade}:d={fade}:curve=tri'
    temporary = directory / 'rendering.mp3'
    run([config['settings']['ffmpeg'], '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
         '-i', original, '-map', '0:a:0', '-vn', '-af', filters, '-map_metadata', '-1',
         '-c:a', 'libmp3lame', '-b:a', '192k', temporary])
    duration = probe(config, temporary)
    if abs(duration - end) > .15 or not 1000 <= temporary.stat().st_size <= LIMIT:
        raise ValueError('Encoded edit failed verification')
    temporary.replace(output)
    result = {'duration': duration, 'bytes': output.stat().st_size, 'sha256': sha(output)}
    save(receipt, {'settings': settings, 'result': result})
    return output, result


def vocal_regions(samples, rate=8000):
    """Estimate active regions on a verified *isolated vocal* stem, never on a full mix."""
    hop = rate // 50
    rms = [math.sqrt(sum(v * v for v in samples[i:i + hop]) / len(samples[i:i + hop]))
           for i in range(0, len(samples), hop)]
    threshold = max(.008, max(rms, default=0) * .08)
    spans = []
    for i, level in enumerate(rms):
        if level < threshold:
            continue
        start, end = i / 50, min(len(samples) / rate, (i + 1) / 50)
        if spans and start - spans[-1][1] <= .26:
            spans[-1][1] = end
        else:
            spans.append([start, end])
    return [[round(max(0, start - .08), 2), round(min(len(samples) / rate, end + .08), 2)]
            for start, end in spans if end - start >= .16]


def analyze(config, job):
    source = job['source']
    root = inside(Path(config['basis_root']) / 'published' / job['songId'], config['basis_root'])
    for manifest in root.glob('*/source.json'):
        saved = load(manifest)
        if saved.get('source', {}).get('url') != source['url']:
            continue
        digest = saved['source']['sha256']
        pinned = re.search(r'-([a-f0-9]{12,64})\.mp3$', source['url'])
        if (pinned and not digest.startswith(pinned[1])) or (source.get('sha256') and digest != source['sha256']):
            continue
        vocals = inside(manifest.parent / 'vocals.wav', config['basis_root'])
        if not vocals.is_file():
            vocals = inside(saved['material']['vocal_reference_path'], Path(config['settings']['studio_dir']).parent)
        if not vocals.is_file() or vocals.stat().st_size != saved['vocal_bytes'] or sha(vocals) != saved['material']['vocal_reference_sha256']:
            continue
        # Different-length stems cannot safely be marked on this recording.
        if abs(probe(config, vocals) - source['duration']) > 2:
            continue
        raw = run([config['settings']['ffmpeg'], '-nostdin', '-v', 'error', '-i', vocals,
                   '-t', str(source['duration']), '-f', 'f32le', '-ac', '1', '-ar', '8000', '-'])
        samples = array.array('f'); samples.frombytes(raw)
        regions = [[a, min(b, source['duration'])] for a, b in vocal_regions(samples) if a < source['duration']]
        return {'method': 'isolated-vocals', 'regions': regions}
    # Existing public, hash-bound audio transcription is the fallback. Do not infer vocals from written lyrics.
    try:
        with urllib.request.urlopen(f"https://yehry3.app/lyric-transcripts/{job['songId']}.whisper.json", timeout=20) as response:
            value = json.loads(response.read(2000000))
        pinned = re.search(r'-([a-f0-9]{12,64})\.mp3$', source['url'])
        if (value.get('songId') == job['songId'] and value.get('audioUrl') == source['url'] and
                abs(value.get('duration', 0) - source['duration']) <= 2 and
                re.fullmatch(r'[a-f0-9]{64}', value.get('audioSha256', '')) and
                (not pinned or value['audioSha256'].startswith(pinned[1])) and
                (not source.get('sha256') or value['audioSha256'] == source['sha256'])):
            regions = [[s['start'], min(s['end'], source['duration'])] for s in value['segments']
                       if 0 <= s['start'] < s['end'] <= source['duration'] + .1]
            return {'method': 'transcript', 'regions': regions}
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    except (ValueError, KeyError, TypeError):
        pass
    return {'method': 'unavailable', 'regions': []}


def perform(config, api, job, claim, root):
    validate_job(job)
    directory = inside(root / job['editId'], root)
    directory.mkdir(parents=True, exist_ok=True)
    if job['kind'] == 'analyze':
        result = analyze(config, job)
    else:
        output, result = render(config, job, directory)
        upload_asset(config, job['songId'] + '-edit-' + job['editId'], result, output, directory)
    api.call('/audio-edits/' + job['id'] + '/finish', {**result, 'leaseToken': claim['leaseToken']}, timeout=180)


def serve(config):
    root = Path(config['state_dir']) / 'audio-editor'
    api = API(config['api'], config['worker_id'] + '-audio', os.environ['DISTONYC_WORKER_TOKEN'])
    with singleton(root / 'worker.lock') as acquired:
        if not acquired:
            return
        pending = root / 'claim.json'
        while True:
            try:
                claim = load(pending) if pending.exists() else {'claimId': str(uuid.uuid4()), 'leaseToken': secrets.token_hex(32)}
                save(pending, claim)  # Persist before claiming: a lost HTTP response must not strand a job.
                job = api.call('/audio-edits/claim', claim)['job']
                save(root / 'health.json', {'at': utc(), 'state': 'working' if job else 'idle'})
                if job:
                    try:
                        perform(config, api, job, claim, root)
                    except (ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
                        api.call('/audio-edits/' + job['id'] + '/finish', {'leaseToken': claim['leaseToken'], 'failed': True})
                pending.unlink(missing_ok=True)
            except Exception as error:
                # Keep credentials, local source paths, and response bodies out of service logs.
                print(utc(), 'audio editor:', type(error).__name__, flush=True)
                save(root / 'health.json', {'at': utc(), 'state': 'retrying', 'error': type(error).__name__})
                if isinstance(error, APIError) and error.status == 409:
                    pending.unlink(missing_ok=True)
            time.sleep(15)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    serve(load(parser.parse_args().config))
