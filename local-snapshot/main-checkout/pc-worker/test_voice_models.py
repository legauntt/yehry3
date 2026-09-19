import tempfile
import unittest
from pathlib import Path

from common import sha
from voice_models import PROFILE_FILES, reference_profile, resolve, selected


class VoiceModelTests(unittest.TestCase):
    def test_legacy_default_and_explicit_version(self):
        self.assertEqual(selected({'details': {}}), 'v6')
        self.assertEqual(selected({'details': {'voiceModel': 'v7'}}), 'v7')
        with self.assertRaises(ValueError):
            selected({'details': {'voiceModel': '../v7'}})

    def test_profile_assets_are_pinned_and_resolved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, relative in enumerate(PROFILE_FILES.values()):
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(f'asset-{index}'.encode())
            pins = {name: sha(root / relative) for name, relative in PROFILE_FILES.items()}
            config = {'voice_models': {'v7': {'label': 'Tony V7', 'root': str(root),
                'runtime_kind': 'fresh-catalog-v1', 'sha256': pins}}}
            profile = resolve(config, 'v7')
            self.assertEqual(profile['sha256'], pins)
            self.assertEqual(reference_profile(profile, 'rock')['energy_stratum'], 'middle')
            (root / PROFILE_FILES['runtime']).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'asset changed'):
                resolve(config, 'v7')


if __name__ == '__main__':
    unittest.main()
