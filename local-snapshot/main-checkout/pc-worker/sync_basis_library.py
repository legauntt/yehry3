"""Download the complete basis inventory to a verified library outside Git."""
import argparse
import concurrent.futures
import hashlib
import json
import os
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path


def read_json(path):
    return json.loads(path.read_text('utf-8-sig'))


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save_json(path, value):
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def original_assets(manifests):
    result = {}
    for manifest_path in manifests:
        manifest = read_json(manifest_path)
        for asset in manifest['assets']:
            url = urllib.parse.urlparse(asset['url'])
            if (url.scheme != 'https' or url.netloc != 'github.com'
                    or not url.path.startswith('/legauntt/gatsby-opus/releases/download/')):
                raise ValueError('Unexpected basis release URL')
            relative = asset.get('legacyPath', '').lstrip('/')
            if not relative and manifest.get('release_tag') == 'tonify-v6' and asset.get('format') == 'mp3':
                relative = 'tonify/mp3s/' + Path(url.path).name
            if not relative:
                continue
            if (type(asset.get('bytes')) is not int or asset['bytes'] <= 0
                    or len(asset.get('sha256', '')) != 64
                    or any(c not in '0123456789abcdef' for c in asset['sha256'])):
                raise ValueError('Invalid size or SHA-256 in basis manifest')
            normalized = {'legacyPath': '/' + relative, 'url': asset['url'],
                          'bytes': asset['bytes'], 'sha256': asset['sha256']}
            if relative in result and result[relative] != normalized:
                raise ValueError('Conflicting original manifests for ' + relative)
            result[relative] = normalized
    return result


def download(root, song, asset, verify_only=False):
    target = (root / song['relativePath']).resolve()
    if not target.is_relative_to(root) or target == root:
        raise ValueError('Basis path escapes the local library')
    if target.exists():
        if target.stat().st_size != asset['bytes'] or sha256(target) != asset['sha256']:
            raise ValueError('Existing basis differs from its pinned original: ' + str(target))
        action = 'verified_existing'
    else:
        if verify_only:
            raise FileNotFoundError(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            with urllib.request.urlopen(asset['url'], timeout=60) as response, temporary.open('xb') as output:
                count = 0
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > asset['bytes']:
                        raise ValueError('Download exceeds pinned original size')
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if temporary.stat().st_size != asset['bytes'] or sha256(temporary) != asset['sha256']:
                raise ValueError('Downloaded basis failed size/SHA-256 verification: ' + song['title'])
            # Windows rename refuses to overwrite a concurrently created destination.
            temporary.rename(target)
        finally:
            temporary.unlink(missing_ok=True)
        action = 'downloaded_verified_original'
    return {**song, **asset, 'local_path': str(target), 'action': action}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, action='append', required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    root = args.destination.resolve()
    if any((parent / '.git').exists() for parent in (root, *root.parents)):
        raise ValueError('The basis library must be outside every Git checkout')
    songs = read_json(args.catalog)['songs']
    if not songs or len({song['id'] for song in songs}) != len(songs):
        raise ValueError('Basis inventory is empty or has duplicate IDs')
    if len({song['relativePath'] for song in songs}) != len(songs):
        raise ValueError('Basis inventory has duplicate recording paths')
    assets = original_assets(args.manifest)
    missing = [song['relativePath'] for song in songs if song['relativePath'] not in assets]
    if missing:
        raise ValueError('Basis originals lack release provenance: ' + ', '.join(missing))
    root.mkdir(parents=True, exist_ok=True)
    rows, failures = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(download, root, song, assets[song['relativePath']], args.verify_only) for song in songs]
        for future in concurrent.futures.as_completed(futures):
            try:
                row = future.result()
            except Exception as error:
                failures.append(str(error))
                print('Download failed; verified files retained: ' + str(error), flush=True)
                continue
            rows.append(row)
            print(f"{len(rows)}/{len(songs)} {row['action']}: {row['title']}", flush=True)
    if failures:
        raise RuntimeError(f'{len(failures)} basis files could not be verified; rerun to resume: ' + '; '.join(failures))
    by_id = {row['id']: row for row in rows}
    rows = [by_id[song['id']] for song in songs]
    save_json(root / 'manifest.json', {'version': 1, 'assets': [assets[song['relativePath']] for song in songs]})
    report = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'verified',
              'root': str(root), 'recordings': len(rows), 'total_bytes': sum(row['bytes'] for row in rows),
              'catalog_path': str(args.catalog.resolve()), 'catalog_sha256': sha256(args.catalog),
              'sources': [{'path': str(path.resolve()), 'sha256': sha256(path)} for path in args.manifest],
              'files': rows}
    save_json(root / 'verification.json', report)
    print(json.dumps({key: report[key] for key in ('status', 'root', 'recordings', 'total_bytes')}), flush=True)


if __name__ == '__main__':
    main()
