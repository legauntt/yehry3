import tempfile, unittest
from pathlib import Path
from common import sha
from voice_models import PROFILE_FILES, reference_profile, resolve, selected


class VoiceModelTests(unittest.TestCase):
    def test_request_defaults_to_v6_and_rejects_unknown_models(self):
        self.assertEqual(selected({'details': {}}), 'v6')
        self.assertEqual(selected({'details': {'voiceModel': 'v7'}}), 'v7')
        self.assertEqual(selected({'details': {'voiceModel': 'v8'}}), 'v8')
        with self.assertRaisesRegex(ValueError, 'unsupported'):
            selected({'details': {'voiceModel': 'latest'}})

    def test_v7_profile_requires_every_pinned_unchanged_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in PROFILE_FILES.values():
                path = root / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(relative.encode())
            pins = {key: sha(root / relative) for key, relative in PROFILE_FILES.items()}
            profile = resolve({'voice_models': {'v7': {'root': str(root), 'sha256': pins}}}, 'v7')
            self.assertEqual(profile['name'], 'v7')
            (root / PROFILE_FILES['style']).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'changed'):
                resolve({'voice_models': {'v7': {'root': str(root), 'sha256': pins}}}, 'v7')

    def test_reference_profiles_are_copied_and_bounded(self):
        profile = {'name': 'v8', 'reference_profiles': {
            'rock': {'median_hz': 175, 'voiced_fraction': .65, 'energy_stratum': 'middle'}}}
        first = reference_profile(profile, 'rock'); first['median_hz'] = 0
        self.assertEqual(reference_profile(profile, 'rock')['median_hz'], 175)
        with self.assertRaisesRegex(ValueError, 'does not support'):
            reference_profile(profile, 'quartet')


if __name__ == '__main__': unittest.main()
