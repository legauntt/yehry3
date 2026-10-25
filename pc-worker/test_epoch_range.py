import tempfile
import unittest
from pathlib import Path
from common import sha, save, load
from unittest.mock import patch
from types import SimpleNamespace
import subprocess, sys
from voice_models import selected_range, resolve_range, RVC_FILES
from epoch_range_runtime import assignment, passage_assignment, configure, prepare_range


class EpochRangeTests(unittest.TestCase):
    def test_preparation_splits_sung_passages_and_preserves_overlap(self):
        try: import numpy as np
        except ImportError: self.skipTest('Use the saved voice Python for signal preparation tests')
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory); (work / 'conversion').mkdir()
            save(work / 'conversion-plan.json', {'voice_interval': [0, 22], 'chunks': [
                {'core_interval': [0, 6]}, {'core_interval': [6, 14]}, {'core_interval': [14, 22]}]})
            voice = np.zeros((22 * 44100, 2)); voice[6 * 44100:] = .1
            writes = []
            engine = SimpleNamespace(SR=44100, read=lambda path: voice, env=lambda wave: abs(wave),
                c=SimpleNamespace(np=np, normalized=lambda wave: wave.copy(),
                    sf=SimpleNamespace(write=lambda *args, **kwargs: writes.append(args))))
            frozen = {'range': {'start': 30, 'end': 10}, 'profiles': {
                str(epoch): {'files': {'adapter': f'{epoch}.pth'}, 'sha256': {'adapter': str(epoch)}}
                for epoch in (30, 20, 10)}}
            with patch('epoch_range_runtime.module', return_value=engine): prepare_range(work, frozen)
            rows = load(work / 'conversion-plan.json')['chunks']
            self.assertEqual([row['epoch'] for row in rows if row['epoch_active']], [30, 20, 10])
            self.assertFalse(rows[0]['epoch_active'])
            self.assertEqual(len(writes), 4)
            self.assertEqual(rows[0]['core_interval'][0], 0)
            self.assertEqual(rows[-1]['core_interval'][1], 22)
            for a, b in zip(rows, rows[1:]):
                self.assertEqual(a['core_interval'][1], b['core_interval'][0])
                self.assertAlmostEqual(a['interval'][1] - b['interval'][0], .8)
            for row in rows:
                self.assertEqual(row['epoch_model'], f"{row['epoch']}.pth")

    def test_range_validation_and_complete_ascending_assignment(self):
        self.assertIsNone(selected_range({'details': {}}))
        value = {'start': 10, 'end': 300}
        self.assertEqual(selected_range({'details': {'voiceModel': 'v9', 'voiceEpochRange': value}}), value)
        descending = {'start': 300, 'end': 10}
        self.assertEqual(selected_range({'details': {'voiceModel': 'v9', 'voiceEpochRange': descending}}), descending)
        for bad in [{'start': 10, 'end': 10}, {'start': True, 'end': 300},
                    {'start': 0, 'end': 300}, {'start': 10, 'end': 300, 'path': 'private'}]:
            with self.assertRaises(ValueError):
                selected_range({'details': {'voiceModel': 'v9', 'voiceEpochRange': bad}})
        for extra in [{'voiceModel': 'v8'}, {'voiceEpoch': 300}]:
            with self.assertRaises(ValueError):
                selected_range({'details': {'voiceModel': 'v9', 'voiceEpochRange': value, **extra}})
        epochs = list(range(10, 301, 10))
        for count in (30, 35, 100):
            result = assignment(count, epochs)
            self.assertEqual(sorted(set(result)), epochs)
            self.assertEqual(result, sorted(result))
        with self.assertRaises(ValueError): assignment(29, epochs)
        for count in (30, 35, 100):
            result = assignment(count, list(reversed(epochs)))
            self.assertEqual(sorted(set(result)), epochs)
            self.assertEqual(result, sorted(result, reverse=True))
        self.assertEqual(passage_assignment([False, True, False, True, False], [20, 10]), [20, 20, 20, 10, 10])
        self.assertEqual(passage_assignment([False, True, False, True, False], [10, 20]), [10, 10, 10, 20, 20])
        with self.assertRaises(ValueError): passage_assignment([True, False], [10, 20])

    def test_freezes_every_profile_and_materializes_the_pinned_singer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); profiles = {}
            for epoch in (10, 20):
                base = root / str(epoch)
                for key, relative in RVC_FILES.items():
                    path = base / relative; path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('pth_path=str(args.model)' if key == 'singer' else str(epoch) if key == 'adapter' else key)
                profiles[str(epoch)] = {'root': str(base), 'runtime_kind': 'rvc-v1',
                                        'sha256': {key: sha(base / relative) for key, relative in RVC_FILES.items()}}
            config = {'voice_model_epochs': {'v9': profiles}}
            frozen = resolve_range(config, {'start': 10, 'end': 20})
            self.assertEqual(list(frozen['profiles']), ['10', '20'])
            descending = resolve_range(config, {'start': 20, 'end': 10})
            self.assertEqual(list(descending['profiles']), ['20', '10'])
            work = root / 'job'; work.mkdir()
            track, manifest = {}, {'tasks': [{'name': 'diffuse', 'command': ['old']}]}
            configure(work, track, manifest, frozen, {'voice_python': 'python'})
            child = subprocess.run([sys.executable, str(work / 'epoch_range_runtime.py'), '--help'],
                cwd=work, capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self.assertEqual(child.returncode, 0, child.stderr.decode())
            self.assertIn("row['epoch_model']", (work / 'epoch_range_sing.py').read_text())
            self.assertEqual(track['voice_epoch_range'], {'start': 10, 'end': 20})
            self.assertEqual(manifest['tasks'][0]['command'][1], str(work / 'epoch_range_runtime.py'))
            (root / '10' / RVC_FILES['adapter']).write_text('changed')
            with self.assertRaises(ValueError): resolve_range(config, {'start': 10, 'end': 20})
