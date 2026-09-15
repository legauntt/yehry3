"""Bind published recordings to verified local audio and retained Tony vocal stems."""
import os, re, shutil, urllib.request, uuid
from pathlib import Path
from common import inside, load, save, sha

CAPABILITY = 'catalog-remix-v1'


def descriptor(value):
    if (not isinstance(value, dict) or value.get('version') != 1
            or not re.fullmatch(r'[a-z0-9-]{1,120}', value.get('songId', ''))
            or not re.fullmatch(r'[a-f0-9]{64}', value.get('sha256', ''))
            or type(value.get('bytes')) is not int or not 0 < value['bytes'] <= 64000000
            or not isinstance(value.get('title'), str) or not value['title']
            or type(value.get('duration')) not in (int, float) or not 5 <= value['duration'] <= 1440
            or not re.fullmatch(r'https://github\.com/legauntt/(?:yehry3|gatsby-opus)/releases/download/[a-zA-Z0-9._-]+/[a-zA-Z0-9._%-]+\.mp3', value.get('url', ''))):
        raise ValueError('Invalid published remix source')
    return value


def folder(config, source):
    descriptor(source)
    return inside(Path(config['basis_root']) / 'published' / source['songId'] / source['sha256'], config['basis_root'])


def checked_file(path, expected):
    path = Path(path)
    if not path.is_file() or path.stat().st_size != expected['bytes'] or sha(path) != expected['sha256']:
        raise ValueError('A retained remix source file changed or is missing: ' + str(path))
    return path


def pinned_copy(source, target, expected):
    checked_file(source, expected)
    if target.exists(): return checked_file(target, expected)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        shutil.copyfile(source, temporary)
        checked_file(temporary, expected)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def prepare(config, prompt):
    """Only an authoritative published request may register; production stays intact."""
    if prompt.get('status') != 'published': raise ValueError('Only a published song can become a remix source')
    result = prompt['result']
    source = descriptor({'version': 1, 'songId': prompt['songId'], 'title': result['title'],
        'url': prompt['releaseUrl'], 'sha256': result['sha256'], 'bytes': result['bytes'], 'duration': result['duration']})
    destination = folder(config, source)
    manifest = destination / 'source.json'
    if manifest.exists():
        archive_vocals(config, source)
        resolve(config, source)
        return source
    directory = inside(Path(config['state_dir']) / 'jobs' / prompt['id'], Path(config['state_dir']) / 'jobs')
    export_file = directory / 'render-result.json'
    if not export_file.is_file(): return None
    export = load(export_file)
    if export.get('status') != 'verified' or export.get('new_training') is not False: return None
    work = inside(export['work_path'], Path(config['settings']['studio_dir']).parent)
    vocals = work / 'matched-vocals.wav'
    lyrics = result.get('lyrics', {}).get('text', '')
    # Specialist recipes without retained converted stems are explicitly unavailable.
    if not vocals.is_file() or not lyrics.strip(): return None
    files = export.get('files', [])
    if {Path(item['path']).suffix.lower() for item in files} != {'.mp3', '.wav'}:
        raise ValueError('A remix source requires both verified original exports')
    for item in files:
        path = inside(item['path'], config['settings']['output_dir'])
        checked_file(path, item)
    mp3 = next(item for item in files if Path(item['path']).suffix.lower() == '.mp3')
    if mp3['sha256'] != source['sha256'] or mp3['bytes'] != source['bytes']:
        raise ValueError('The retained recording differs from the published song')
    pinned_copy(mp3['path'], destination / 'recording.mp3', source)
    lyric_file = destination / 'lyrics.txt'
    if lyric_file.exists() and lyric_file.read_text('utf-8') != lyrics:
        raise ValueError('The retained remix lyric sheet changed')
    lyric_file.write_text(lyrics, encoding='utf-8')
    value = {'basis_id': source['songId'], 'title': source['title'], 'recording': source['songId'],
        'source_sha256': source['sha256'], 'lyrics_draft': lyrics[:16000], 'lyrics_verified': False,
        'transcript_sha256': sha(lyric_file), 'vocal_reference_path': str(vocals),
        'vocal_reference_sha256': sha(vocals), 'phonetics_sha256': None, 'reference_intervals': None}
    save(manifest, {'version': 1, 'source': source, 'material': value,
        'origin_result': str(export_file), 'origin_result_sha256': sha(export_file),
        'vocal_bytes': vocals.stat().st_size, 'lyric_file': str(lyric_file)})
    archive_vocals(config, source)
    resolve(config, source)
    return source


def archive_vocals(config, source):
    """Add durable bytes without rewriting manifests or any frozen job input."""
    destination = folder(config, source)
    saved = load(destination / 'source.json')
    if saved.get('version') != 1 or saved.get('source') != source:
        raise ValueError('The registered remix source changed')
    value = saved['material']
    expected = {'bytes': saved['vocal_bytes'], 'sha256': value['vocal_reference_sha256']}
    target = inside(destination / 'vocals.wav', config['basis_root'])
    if target.exists(): return checked_file(target, expected)
    original = inside(value['vocal_reference_path'], Path(config['settings']['studio_dir']).parent)
    pinned_copy(original, target, expected)
    return target


def resolve(config, source):
    """Return one exact basis; changed or unavailable stems fail before planning."""
    directory = folder(config, source)
    manifest = directory / 'source.json'
    if not manifest.is_file(): raise ValueError('The selected published recording has no verified local remix material')
    saved = load(manifest)
    if saved.get('version') != 1 or saved.get('source') != source:
        raise ValueError('The frozen remix source differs from the registered recording')
    target = directory / 'recording.mp3'
    if not target.exists():
        temporary = target.with_name('recording.' + uuid.uuid4().hex + '.tmp')
        try:
            with urllib.request.urlopen(source['url'], timeout=120) as response, temporary.open('xb') as output:
                size = 0
                while block := response.read(1024 * 1024):
                    size += len(block)
                    if size > source['bytes']: raise ValueError('The downloaded remix recording exceeds its pinned size')
                    output.write(block)
                output.flush(); os.fsync(output.fileno())
            checked_file(temporary, source)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    checked_file(target, source)
    basis = {'id': source['songId'], 'title': source['title'], 'duration': source['duration'],
        'collection': 'Published songs', 'relativePath': target.relative_to(Path(config['basis_root']).resolve()).as_posix(),
        'path': str(target), 'sha256': source['sha256'], 'remixSource': True,
        'remix_manifest_sha256': sha(manifest)}
    material(config, basis)
    return basis


def material(config, basis):
    path = inside(basis['path'], config['basis_root'])
    manifest = path.parent / 'source.json'
    if sha(manifest) != basis['remix_manifest_sha256']: raise ValueError('Saved remix material changed')
    saved = load(manifest)
    if saved['source']['sha256'] != basis['sha256'] or saved['source']['songId'] != basis['id']:
        raise ValueError('Saved remix recording provenance changed')
    checked_file(path, saved['source'])
    value = saved['material']
    archived = inside(path.parent / 'vocals.wav', config['basis_root'])
    vocals = archived if archived.exists() else inside(value['vocal_reference_path'], Path(config['settings']['studio_dir']).parent)
    checked_file(vocals, {'bytes': saved['vocal_bytes'], 'sha256': value['vocal_reference_sha256']})
    lyric_file = inside(saved['lyric_file'], config['basis_root'])
    if sha(lyric_file) != value['transcript_sha256']: raise ValueError('Saved remix lyrics changed')
    return {**value, 'vocal_reference_path': str(vocals)}


def register(config, api, prompt):
    if not config.get('catalog_remix'): return
    source = prepare(config, prompt)
    if source:
        api.call('/songs/' + source['songId'] + '/remix-source',
            {key: source[key] for key in ('version', 'url', 'sha256', 'bytes')})
