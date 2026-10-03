"""Prepare isolated, hash-pinned V9 epoch profiles; never replace the active V9 profile.

Run while worker and monitor are stopped, with --config, --checkpoints, --output and --write.
Without --write this only checks the saved checkpoint inventory and current V9 pins.
"""
import argparse
import copy
import os
import shutil
from pathlib import Path
from common import load, save, sha, utc
from voice_models import RVC_FILES, resolve


def prepare(config, checkpoints, output):
    base = resolve(config, 'v9')
    base_root = Path(base['root'])
    sources = {}
    for epoch in range(10, 301, 10):
        matches = list(Path(checkpoints).glob(f'tony-v9_{epoch}e_*s.pth'))
        if len(matches) != 1:
            raise ValueError(f'Expected exactly one checkpoint for epoch {epoch}')
        sources[epoch] = matches[0]
    if sha(sources[300]) != base['sha256']['adapter']:
        raise ValueError('The default V9 model is not the saved epoch 300')
    return base_root, sources


def install_profiles(config, checkpoints, output):
    base_root, sources = prepare(config, checkpoints, output)
    entries = {}
    for epoch, checkpoint in sources.items():
        if epoch == 300:
            continue
        root = Path(output).resolve() / f'epoch-{epoch}'
        for key, relative in RVC_FILES.items():
            source = checkpoint if key == 'adapter' else base_root / relative
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if sha(target) != sha(source):
                    raise ValueError(f'Refusing to replace an existing epoch asset: {target}')
            elif key in ('adapter', 'index'):
                # Independent names for immutable training exports; no extra multi-GB copy.
                os.link(source, target)
            else:
                shutil.copy2(source, target)
        setting = base_root / 'pitch-repair-setting.json'
        if setting.exists() and not (root / setting.name).exists():
            shutil.copy2(setting, root / setting.name)
        entries[str(epoch)] = {
            'label': f'Tony V9 epoch {epoch}', 'runtime_kind': 'rvc-v1', 'root': str(root),
            'sha256': {key: sha(root / relative) for key, relative in RVC_FILES.items()},
        }
        if 'reference_profiles' in config['voice_models']['v9']:
            entries[str(epoch)]['reference_profiles'] = config['voice_models']['v9']['reference_profiles']
    updated = copy.deepcopy(config)
    updated.setdefault('voice_model_epochs', {})['v9'] = entries
    for epoch in range(10, 301, 10):
        resolve(updated, 'v9', epoch)
    return updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--checkpoints', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    config = load(args.config)
    prepare(config, args.checkpoints, args.output)
    if args.write:
        if (Path(config['state_dir']) / 'claim.json').exists():
            raise ValueError('The worker holds a claim; wait for it to finish')
        updated = install_profiles(config, args.checkpoints, args.output)
        backup = args.config.parent / 'state' / ('config-before-v9-epochs-' + utc().replace(':', '-') + '.json')
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(args.config, backup)
        save(args.config, updated)
        print(f'Installed 30 V9 epochs; retained config backup: {backup}')
    else:
        print('All 30 saved V9 checkpoints found; default epoch 300 matches installed pins')


if __name__ == '__main__':
    main()
