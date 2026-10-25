import tempfile
import unittest
from pathlib import Path
from common import load, save, sha, fingerprint
from voice_models import RVC_FILES, resolve, selected_epoch, capabilities
from prepare_v9_epochs import install_profiles
from voice_repair_profile import resolve as repair_profile


class V9EpochTests(unittest.TestCase):
    def test_selection_is_v9_only_and_strict(self):
        self.assertIsNone(selected_epoch({'details': {'voiceModel': 'v9'}}))
        for epoch in range(10, 301, 10):
            self.assertEqual(selected_epoch({'details': {'voiceModel': 'v9', 'voiceEpoch': epoch}}), epoch)
        for voice, epoch in [('v8', 100), ('vdb', 300), ('v9', True), ('v9', '100'), ('v9', 15), ('v9', 310)]:
            with self.assertRaises(ValueError):
                selected_epoch({'details': {'voiceModel': voice, 'voiceEpoch': epoch}})

    def test_profiles_keep_default_fingerprint_and_freeze_repair_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); base = root / 'base'; checkpoints = root / 'checkpoints'
            checkpoints.mkdir()
            for epoch in range(10, 301, 10):
                (checkpoints / f'tony-v9_{epoch}e_1s.pth').write_bytes(str(epoch).encode())
            for key, relative in RVC_FILES.items():
                path = base / relative; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'300' if key == 'adapter' else key.encode())
            config = {'voice_models': {'v9': {'root': str(base), 'runtime_kind': 'rvc-v1',
                'sha256': {key: sha(base / relative) for key, relative in RVC_FILES.items()}}}}
            default = resolve(config, 'v9')
            updated = install_profiles(config, checkpoints, root / 'epochs')
            self.assertEqual(resolve(updated, 'v9', 300), default)
            self.assertEqual(resolve(updated, 'v9'), default)
            self.assertEqual(capabilities(updated), ['voice-v9-v1', 'voice-v9-epochs-v1', 'voice-v9-epoch-range-v1'])
            early = resolve(updated, 'v9', 100)
            later = resolve(updated, 'v9', 200)
            self.assertNotEqual(early['fingerprint'], later['fingerprint'])
            self.assertEqual(Path(early['files']['adapter']).read_bytes(), b'100')
            # Repair reads the saved song profile, independent of the next request's selection.
            work = root / 'song'; work.mkdir()
            recipe = work / 'engine_voice.py'; recipe.write_text('recipe')
            save(work / 'track.json', {'voice_model': 'v9', 'voice_checkpoint': early['files']['adapter'],
                'voice_model_sha256': early['sha256']['adapter']})
            save(work / 'conversion-plan.json', {'adapter': early['files']['adapter']})
            save(work / 'voice-profile.json', early)
            save(work / 'distonyc-configured.json', {'voice_profile_fingerprint': early['fingerprint']})
            repair = repair_profile(work, {'workers': {'engine_voice.py': sha(recipe)}})
            self.assertEqual(repair['checkpoint'], early['files']['adapter'])
            self.assertEqual(repair['runtime'], early['files']['runtime'])
            self.assertEqual(install_profiles(updated, checkpoints, root / 'epochs'), updated)
            Path(early['files']['adapter']).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'changed'):
                resolve(updated, 'v9', 100)
            self.assertEqual(resolve(updated, 'v9', 200), later)

    def test_missing_epoch_never_falls_back_to_300(self):
        with self.assertRaises(ValueError):
            resolve({'voice_models': {'v9': {}}}, 'v9', 100)
        with self.assertRaisesRegex(ValueError, 'Invalid'):
            resolve({}, 'v7', 100)


if __name__ == '__main__':
    unittest.main()
