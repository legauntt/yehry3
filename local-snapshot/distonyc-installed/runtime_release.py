"""Check installed recovery capabilities and detect accidental partial/older deployments."""
import argparse
from pathlib import Path
from common import load, sha


def verify(root):
    from planner import MAX_PLANNING_ATTEMPTS, normalize_key
    if MAX_PLANNING_ATTEMPTS != 3 or normalize_key('D-flat major') != 'Db major':
        raise ValueError('Installed planner is missing the required bounded recovery contract')
    manifest = Path(root) / 'runtime-release.json'
    if manifest.exists():
        for name, digest in load(manifest)['files'].items():
            if Path(name).name != name or sha(Path(root) / name) != digest:
                raise ValueError('Installed runtime differs from its verified release: ' + name)
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--root', type=Path, default=Path(__file__).parent)
    verify(parser.parse_args().root)
