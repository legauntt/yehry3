import tempfile, unittest
from pathlib import Path
from common import sha
from voice_models import PROFILE_FILES, reference_profile, resolve, selected, capabilities, validate_generation_fork


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

    def test_v8_requires_its_own_pinned_profile_and_generation_fork(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for relative in PROFILE_FILES.values():
                path = root / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(relative.encode())
            pins = {key: sha(root / relative) for key, relative in PROFILE_FILES.items()}
            config = {'generation_v8': True, 'voice_models': {'v8': {'root': str(root), 'sha256': pins}}}
            self.assertEqual(resolve(config, 'v8')['name'], 'v8')
            self.assertEqual(capabilities(config), ['voice-v8-v1'])
            self.assertEqual(capabilities({**config, 'generation_v8': False}), [])
            self.assertEqual(capabilities({'generation_v8': True, 'voice_models': {'v7': config['voice_models']['v8']}}), [])
            validate_generation_fork('v8', 'v8', {'generation': {'version': 1}})
            for profile, plan in [(None, {}), ('v7', {'generation': {'version': 1}}), ('v8', {})]:
                with self.assertRaisesRegex(ValueError, 'legacy fallback'):
                    validate_generation_fork('v8', profile, plan)
            for voice in ['v6', 'v7']:
                validate_generation_fork(voice, None, {})
            (root / PROFILE_FILES['adapter']).write_bytes(b'changed checkpoint')
            with self.assertRaisesRegex(ValueError, 'changed'):
                capabilities(config)


    def test_completion_metadata_carries_verified_v8_identity(self):
        from worker import metadata
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); files = []
            for ext in ['mp3', 'wav']:
                path = root / (ext + 's') / ('test.' + ext)
                path.parent.mkdir(); path.write_bytes(b'local metadata fixture')
                files.append({'path': str(path), 'bytes': path.stat().st_size, 'sha256': sha(path)})
            config = {'settings': {'output_dir': str(root)}}
            result = {'status': 'verified', 'new_training': False, 'voice_model': 'v8',
                      'generation_profile': 'v8', 'duration': 120, 'files': files}
            with patch('worker.make_sheet', return_value={'text': 'Fixture lyrics'}), patch('worker.export_sheet'):
                _, record = metadata(config, {'title': 'V8 fixture'}, result, 'v8')
                self.assertEqual(record['voiceModel'], 'v8')
                self.assertEqual(record['generationProfile'], 'v8')
                with self.assertRaisesRegex(ValueError, 'generation profile'):
                    metadata(config, {'title': 'V8 fixture'}, {**result, 'generation_profile': None}, 'v8')
                with self.assertRaisesRegex(ValueError, 'voice model'):
                    metadata(config, {'title': 'V8 fixture'}, {**result, 'voice_model': 'v7'}, 'v8')
                for voice in ['v6', 'v7']:
                    legacy = {k: v for k, v in result.items() if k != 'generation_profile'}
                    legacy['voice_model'] = voice
                    _, record = metadata(config, {'title': 'Legacy fixture'}, legacy, voice)
                    self.assertEqual(record['voiceModel'], voice)
                    self.assertNotIn('generationProfile', record)


if __name__ == '__main__': unittest.main()
