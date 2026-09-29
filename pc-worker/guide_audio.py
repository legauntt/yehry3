"""Keep the original music mix beside a completed Distonyc job."""
import json
import shutil
import subprocess
from pathlib import Path

from common import load, save, sha


def capture(config, result, directory):
    directory = Path(directory)
    destination = directory / 'guide.mp3'
    manifest = directory / 'guide.json'
    if manifest.exists():
        guide = load(manifest)
        if destination.is_file() and destination.stat().st_size == guide['bytes'] and sha(destination) == guide['sha256']:
            return guide
        raise ValueError('The saved guide mix changed after capture')
    work = Path(result.get('work_path') or '')
    source = next((work / name for name in ('paid-original.mp3', 'generated.wav')
                   if (work / name).is_file()), None)
    if source is None:
        return None  # Older jobs may no longer have their original working mix.
    final_hashes = {row['sha256'] for row in result.get('files', []) if row.get('sha256')}
    temporary = directory / 'guide.partial.mp3'
    temporary.unlink(missing_ok=True)
    if source.suffix.lower() == '.mp3':
        shutil.copyfile(source, temporary)
    else:
        subprocess.run([config['settings']['ffmpeg'], '-hide_banner', '-loglevel', 'error',
                        '-y', '-i', str(source), '-vn', '-codec:a', 'libmp3lame',
                        '-q:a', '2', str(temporary)], check=True, timeout=600,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    digest = sha(temporary)
    if digest in final_hashes:
        temporary.unlink(missing_ok=True)
        return None
    probe = Path(config['settings']['ffmpeg']).with_name('ffprobe.exe')
    output = subprocess.run([str(probe), '-v', 'error', '-show_entries', 'format=duration',
                             '-of', 'json', str(temporary)], capture_output=True, text=True,
                            check=True, timeout=30,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    duration = float(json.loads(output.stdout)['format']['duration'])
    if duration < 10:
        raise ValueError('The original guide mix is too short')
    temporary.replace(destination)
    guide = {'sha256': digest, 'bytes': destination.stat().st_size, 'duration': duration}
    save(manifest, guide)
    return guide


def saved(directory):
    manifest = Path(directory) / 'guide.json'
    return load(manifest) if manifest.exists() else None
