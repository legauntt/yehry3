"""Install hash-pinned NVIDIA DLLs privately for optional Whisper acceleration."""
import argparse
import hashlib
import json
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PACKAGES = [
    ('https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-12.8.4.1-archive.zip',
     '57a470112cec7e112c95253dde8b3c7184d795dbd92b0bde77a4cb7f8c94c8aa'),
    ('https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/windows-x86_64/cudnn-windows-x86_64-9.8.0.87_cuda12-archive.zip',
     'd8a23705e3884b137b7e05449fb2b61bfa524e7cfc3fda80743d633f423c6ce4'),
]


def install(root, package):
    url, expected = package
    archive = root / url.rsplit('/', 1)[-1]
    if not archive.exists():
        temporary = archive.with_suffix('.download')
        urllib.request.urlretrieve(url, temporary)
        with temporary.open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != expected:
                raise ValueError('NVIDIA download failed its official checksum')
        temporary.replace(archive)
    with archive.open('rb') as source:
        if hashlib.file_digest(source, 'sha256').hexdigest() != expected:
            raise ValueError('Cached NVIDIA package changed')
    count = 0
    with zipfile.ZipFile(archive) as bundle:
        for name in bundle.namelist():
            if '/bin/' in name and name.endswith('.dll'):
                (root / 'bin' / Path(name).name).write_bytes(bundle.read(name))
                count += 1
    return {'url': url, 'sha256': expected, 'dlls': count}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    (args.root / 'bin').mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(lambda package: install(args.root, package), PACKAGES))
    (args.root / 'packages.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
