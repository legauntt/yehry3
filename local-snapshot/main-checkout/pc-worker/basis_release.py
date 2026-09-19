"""Verify release-backed catalog provenance and cache only selected basis audio."""
import os, urllib.request, uuid
from pathlib import Path
from common import load, sha


def manifest_path(config):
    configured = config.get('basis_release_manifest')
    return Path(configured) if configured else Path(config['basis_root']).parent / 'media' / 'site-audio' / 'manifest.json'


def assets(config):
    manifest = load(manifest_path(config))
    if manifest.get('version') != 1 or not isinstance(manifest.get('assets'), list):
        raise ValueError('The basis release manifest is invalid')
    rows = {}
    for asset in manifest['assets']:
        relative = str(asset.get('legacyPath', '')).lstrip('/').replace('\\', '/')
        url = str(asset.get('url', ''))
        if (not relative or relative in rows or not url.startswith('https://github.com/legauntt/gatsby-opus/releases/download/')
                or type(asset.get('bytes')) is not int or asset['bytes'] <= 0
                or not isinstance(asset.get('sha256'), str) or len(asset['sha256']) != 64):
            raise ValueError('The basis release manifest contains an invalid asset')
        rows[relative] = asset
    return rows


def verify_remote_catalog(config, error):
    lines = [line.strip() for line in str(error).splitlines() if line.strip()]
    missing = [line.removeprefix('Missing original: ').replace('\\', '/') for line in lines if line.startswith('Missing original: ')]
    other = [line for line in lines if line != 'Project dependencies need attention:' and not line.startswith('Missing original: ')]
    if not missing or other: raise error
    released = assets(config)
    sources = load(Path(config['settings']['studio_dir']).parent / 'catalog-expansion-v6' / 'sources.json')
    by_path = {str(row['source']).replace('\\', '/'): row for row in sources}
    for path in missing:
        source = by_path.get(path)
        if not source: raise ValueError('A missing catalog original has no saved provenance') from error
        relative = str(source['relative_path']).replace('\\', '/')
        asset = released.get(relative)
        if not asset or asset['bytes'] != source['bytes'] or asset['sha256'] != source['sha256']:
            raise ValueError('A released catalog original does not match its saved provenance') from error
    return {'status': 'passed', 'release_backed_originals': len(missing), 'local_originals_required': False}


def materialize(config, song):
    relative = str(song['relativePath']).replace('\\', '/')
    asset = assets(config).get(relative)
    if not asset: raise ValueError('The selected basis song is absent from the release manifest')
    root = Path(config.get('basis_cache') or (Path(config['state_dir']) / 'basis-cache')).resolve()
    target = (root / Path(relative)).resolve()
    if not target.is_relative_to(root): raise ValueError('Invalid basis cache path')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size != asset['bytes'] or sha(target) != asset['sha256']:
            raise ValueError('The cached basis recording changed')
        return target
    temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with urllib.request.urlopen(asset['url'], timeout=120) as response, temporary.open('xb') as output:
            while block := response.read(1024 * 1024): output.write(block)
            output.flush(); os.fsync(output.fileno())
        if temporary.stat().st_size != asset['bytes'] or sha(temporary) != asset['sha256']:
            raise ValueError('The downloaded basis recording failed verification')
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return target
