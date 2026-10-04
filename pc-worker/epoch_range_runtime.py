"""Frozen V9 checkpoint progression, using the existing pitch/assembly/checks.

Epoch changes happen between prepared phrases, in ascending order. Short guides
split their longest phrase first; no checkpoint may disappear silently.
"""
import argparse
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path
try:
    from epoch_range_common import load, save, sha, fingerprint
except ModuleNotFoundError:
    from common import load, save, sha, fingerprint


def assignment(count, epochs):
    if count < len(epochs):
        raise ValueError('Not enough vocal passages for the selected epoch range')
    return [epochs[min(len(epochs) - 1, index * len(epochs) // count)] for index in range(count)]


def passage_assignment(active, epochs):
    assigned = iter(assignment(sum(active), epochs))
    current = epochs[0]
    result = []
    for sung in active:
        if sung: current = next(assigned)
        result.append(current)
    return result


def configure(work, track, manifest, frozen, settings):
    profile = frozen['profiles'][str(frozen['range']['end'])]
    source = Path(profile['files']['singer']).read_text('utf-8')
    old = 'pth_path=str(args.model)'
    if source.count(old) != 1:
        raise ValueError('The pinned V9 singer no longer supports per-phrase model selection')
    source = source.replace(old, "pth_path=str(row['epoch_model'])")
    compile(source, 'epoch_range_sing.py', 'exec')
    (work / 'epoch_range_sing.py').write_text(source, 'utf-8')
    shutil.copy2(Path(__file__), work / 'epoch_range_runtime.py')
    shutil.copy2(Path(__file__).with_name('common.py'), work / 'epoch_range_common.py')
    save(work / 'epoch-range-profile.json', frozen)
    track['voice_epoch_range'] = frozen['range']
    for task in manifest['tasks']:
        if task['name'] in ('prepare', 'features', 'pitch', 'diffuse', 'vocode', 'assemble', 'validate'):
            task['command'] = [settings['voice_python'], str(work / 'epoch_range_runtime.py'), str(work), task['name']]


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def prepare_range(work, frozen):
    """Keep the native boundaries where possible, with its existing 0.8s overlap."""
    plan = load(work / 'conversion-plan.json')
    epochs = [int(value) for value in frozen['profiles']]
    cores = [row['core_interval'] for row in plan['chunks']]
    engine = module(work / 'engine_voice.py', 'range_engine')
    voice = engine.read(work / 'selected-vocals.wav')
    c, np, sr = engine.c, engine.c.np, engine.SR
    envelope = engine.env(voice.mean(1))[::882]
    def active(core):
        segment = envelope[round(core[0] / .02):round(core[1] / .02)]
        return bool(len(segment) and segment.max() > .001)
    while sum(active(core) for core in cores) < len(epochs):
        candidates_to_split = [i for i, core in enumerate(cores) if active(core)]
        if not candidates_to_split:
            raise ValueError('The selected epoch range needs singing; choose a shorter range')
        index = max(candidates_to_split, key=lambda i: cores[i][1] - cores[i][0])
        left, right = cores[index]
        if right - left < 4:
            raise ValueError('The selected epoch range needs more singing time; choose a shorter range')
        candidates = np.arange(round((left + 1.5) / .02), round((right - 1.5) / .02) + 1)
        costs = envelope[candidates] / max(float(envelope.max()), 1e-9) + .05 * np.abs(candidates * .02 - (left + right) / 2)
        split = float(candidates[np.argmin(costs)] * .02)
        if not active([left, split]) or not active([split, right]):
            raise ValueError('The selected epoch range needs more sung passages; choose a shorter range')
        cores[index:index + 1] = [[left, split], [split, right]]
    rows = []
    start, stop = plan['voice_interval']
    sung = [active(core) for core in cores]
    for index, ((left, right), epoch) in enumerate(zip(cores, passage_assignment(sung, epochs))):
        profile = frozen['profiles'][str(epoch)]
        a, b = max(start, left - .4), min(stop, right + .4)
        label = f'phrase-{index + 1:03d}'
        wave = c.normalized(voice[round(a * sr):round(b * sr)].mean(1))
        edge = round(.015 * sr)
        wave[:edge] *= np.linspace(0, 1, edge)
        wave[-edge:] *= np.linspace(1, 0, edge)
        c.sf.write(work / 'conversion' / (label + '.wav'), wave, sr, subtype='PCM_24')
        rows.append({'label': label, 'interval': [a, b], 'core_interval': [left, right],
                     'epoch': epoch, 'epoch_active': sung[index], 'epoch_model': profile['files']['adapter'],
                     'epoch_model_sha256': profile['sha256']['adapter']})
    plan.update(chunks=rows, voice_epoch_range=frozen['range'],
                treatment='Successive prepared vocal phrases use every saved checkpoint in the selected V9 range')
    save(work / 'conversion-plan.json', plan)


def main(work, stage):
    frozen = load(work / 'epoch-range-profile.json')
    if fingerprint({key: value for key, value in frozen.items() if key != 'fingerprint'}) != frozen['fingerprint']:
        raise ValueError('The frozen V9 epoch range changed')
    if load(work / 'distonyc-configured.json')['voice_profile_fingerprint'] != frozen['fingerprint'] or load(work / 'track.json').get('voice_epoch_range') != frozen['range']:
        raise ValueError('The frozen V9 range differs from the configured song')
    seen = {}
    for profile in frozen['profiles'].values():
        for key, value in profile['files'].items():
            path = Path(value)
            stat = path.stat()
            identity = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)
            if identity not in seen: seen[identity] = sha(path)
            if seen[identity] != profile['sha256'][key]:
                raise ValueError('A pinned V9 epoch asset changed')
    profile = frozen['profiles'][str(frozen['range']['end'])]
    sys.path.insert(0, str(Path(profile['files']['common']).parent))
    runtime = module(Path(profile['files']['runtime']), 'range_base_runtime')
    def sing(work, again=None):
        applio = load(Path(profile['files']['applio']))
        root = Path(applio['root'])
        if (root / '.git/HEAD').read_text('utf-8').strip() != applio['commit'] or sha(root / 'rvc/models/embedders/contentvec/pytorch_model.bin') != applio['embedder_sha256']:
            raise ValueError('The pinned Applio runtime changed')
        rows = load(work / 'conversion-plan.json')['chunks']
        epochs = [int(value) for value in frozen['profiles']]
        if [row['epoch'] for row in rows] != passage_assignment([row['epoch_active'] for row in rows], epochs):
            raise ValueError('The saved V9 passage progression changed')
        for row in rows:
            selected = frozen['profiles'][str(row['epoch'])]
            if row['epoch_model'] != selected['files']['adapter'] or row['epoch_model_sha256'] != selected['sha256']['adapter']:
                raise ValueError('A saved V9 passage model changed')
        subprocess.run([applio['python'], '-X', 'utf8', str(work / 'epoch_range_sing.py'), '--work', str(work),
                        '--applio', str(root), '--model', profile['files']['adapter'], '--index', profile['files']['index'],
                        *(['--take', '2', '--labels', *again] if again else [])], check=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    runtime.sing = sing
    runtime.main(work, stage)
    if stage == 'prepare': prepare_range(work, frozen)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('work', type=Path)
    parser.add_argument('stage', choices=['prepare', 'features', 'pitch', 'diffuse', 'vocode', 'assemble', 'validate'])
    args = parser.parse_args()
    main(args.work.resolve(), args.stage)
