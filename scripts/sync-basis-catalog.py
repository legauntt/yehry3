"""Index public audio under gatsby-opus/static without copying any audio or local paths."""
import argparse, hashlib, json, subprocess
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--static', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--ffprobe', type=Path, required=True)
    parser.add_argument('--chairlift', type=Path, required=True)
    args = parser.parse_args()
    root = args.static.resolve()
    known = {Path(row['source']).resolve(): row for row in json.loads(args.sources.read_text('utf-8'))}
    rows = []
    for path in sorted(root.rglob('*')):
        if path.suffix.lower() not in {'.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus', '.aac'}:
            continue
        relative = path.relative_to(root).as_posix()
        info = json.loads(subprocess.check_output([str(args.ffprobe), '-v', 'error', '-show_format', '-of', 'json', str(path)], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)))['format']
        tags = {key.lower(): value for key, value in info.get('tags', {}).items()}
        source = known.get(path.resolve(), {})
        title = source.get('title') or tags.get('title') or path.stem.replace('_', ' ').replace('-', ' ')
        rows.append({'id': 'basis-' + hashlib.sha256(relative.encode()).hexdigest()[:20], 'title': title,
                     'collection': source.get('collection') or relative.split('/')[0],
                     'duration': float(info['duration']), 'relativePath': relative})
    rows.sort(key=lambda row: (row['title'].casefold(), row['relativePath']))
    data = json.dumps({'version': 1, 'songs': rows}, ensure_ascii=False, indent=2) + '\n'
    (Path(__file__).resolve().parent.parent / 'basis-songs.json').write_text(data, encoding='utf-8')
    (args.chairlift / 'yehry3/basis-songs.json').write_text(data, encoding='utf-8')
    print(f'Indexed {len(rows)} audio recordings, sorted A–Z, with relative public paths only.')

if __name__ == '__main__': main()
