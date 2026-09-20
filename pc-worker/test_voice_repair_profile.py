import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from common import fingerprint, load, save, sha
from voice_repair_profile import install, resolve, supported, reserve_stage


class VoiceRepairProfiles(unittest.TestCase):
    def fixture(self, root, voice):
        work = root / 'work'; (work / 'conversion').mkdir(parents=True)
        recipe = work / ('convert_song.py' if voice == 'v6' else 'engine_voice.py')
        recipe.write_text('saved engine')
        (work / 'conversion/tony-multiple-songs-style.npy').write_bytes(b'original style')
        checkpoint = root / 'catalog-expansion-v6/tony-catalog-adapter.pt' if voice == 'v6' else root / (voice + '.pt')
        checkpoint.parent.mkdir(exist_ok=True); checkpoint.write_bytes(voice.encode())
        save(work / 'track.json', {'voice_model': voice, 'voice_checkpoint': str(checkpoint),
                                 'voice_model_sha256': sha(checkpoint), 'model_sha256': sha(checkpoint)})
        save(work / 'conversion-plan.json', {'adapter': str(checkpoint)})
        return work, {'workers': {recipe.name: sha(recipe)}}, checkpoint

    def test_versioned_repairs_are_explicit_and_unknown_versions_stay_unsupported(self):
        self.assertTrue(supported({}))
        for voice in ['v7', 'v8', 'v9']:
            self.assertFalse(supported({'voice_model': voice}))
            self.assertTrue(supported({'voice_model': voice, 'config': {'automatic_versioned_vocal_repair': True}}))
        self.assertFalse(supported({'voice_model': 'v10', 'config': {'automatic_versioned_vocal_repair': True}}))

    def test_frozen_model_is_selected_for_each_voice_and_tampering_is_rejected(self):
        for voice in ['v6', 'v7', 'v8']:
            with self.subTest(voice=voice), tempfile.TemporaryDirectory() as directory:
                work, manifest, checkpoint = self.fixture(Path(directory), voice)
                result = resolve(work, manifest)
                self.assertEqual(result['voice_model'], voice)
                self.assertEqual(Path(result['checkpoint']).resolve(), checkpoint.resolve())
                checkpoint.write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError, 'checkpoint changed'): resolve(work, manifest)

    def rvc_fixture(self, root):
        work, manifest, checkpoint = self.fixture(root, 'v9')
        (work / 'conversion/tony-multiple-songs-style.npy').unlink()  # An RVC job has no reference style.
        runtime = root / 'voice_runtime.py'; runtime.write_text('pinned runtime')
        frozen = {'name': 'v9', 'runtime_kind': 'rvc-v1', 'files': {'adapter': str(checkpoint), 'runtime': str(runtime)},
                  'sha256': {'adapter': sha(checkpoint), 'runtime': sha(runtime)}}
        frozen['fingerprint'] = fingerprint(frozen)
        save(work / 'voice-profile.json', frozen)
        save(work / 'distonyc-configured.json', {'voice_profile_fingerprint': frozen['fingerprint']})
        return work, manifest, checkpoint, runtime

    def test_an_rvc_voice_is_bound_to_its_frozen_runtime_instead_of_a_reference_style(self):
        with tempfile.TemporaryDirectory() as directory:
            work, manifest, checkpoint, runtime = self.rvc_fixture(Path(directory))
            result = resolve(work, manifest)
            self.assertEqual((result['voice_model'], result['runtime_kind'], result['runtime']), ('v9', 'rvc-v1', str(runtime)))
            self.assertEqual(result['checkpoint_sha256'], sha(checkpoint))
            runtime.write_text('edited after the song was configured')
            with self.assertRaisesRegex(ValueError, 'runtime changed: runtime'): resolve(work, manifest)

    def test_an_rvc_job_whose_saved_profile_was_rewritten_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            work, manifest, checkpoint, runtime = self.rvc_fixture(Path(directory))
            other = Path(directory) / 'other_runtime.py'; other.write_text('another runtime')
            frozen = load(work / 'voice-profile.json')
            frozen['files']['runtime'] = str(other); frozen['sha256']['runtime'] = sha(other)
            save(work / 'voice-profile.json', frozen)
            with self.assertRaisesRegex(ValueError, 'saved voice profile changed'): resolve(work, manifest)

    def test_versioned_job_cannot_borrow_a_different_adapter_or_recipe(self):
        with tempfile.TemporaryDirectory() as directory:
            work, manifest, checkpoint = self.fixture(Path(directory), 'v8')
            save(work / 'conversion-plan.json', {'adapter': str(checkpoint.with_name('v6.pt'))})
            with self.assertRaisesRegex(ValueError, 'disagree'): resolve(work, manifest)
            save(work / 'conversion-plan.json', {'adapter': str(checkpoint)})
            (work / 'engine_voice.py').write_text('changed engine')
            with self.assertRaisesRegex(ValueError, 'recipe changed'): resolve(work, manifest)

    def test_allowlist_does_not_enable_an_unselected_or_mistyped_voice(self):
        for voice,expected in [('v7',True),('v8',False)]:
            self.assertEqual(supported({'voice_model':voice,'config':{'automatic_versioned_vocal_repair':['v7']}}),expected)
        self.assertFalse(supported({'voice_model':'v8','config':{'automatic_versioned_vocal_repair':'false'}}))

    def test_lost_response_cannot_repeat_a_costly_repair_invocation(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'status.json';status={'status':'rendering','completed':[]}
            reserve_stage(status,path,'phrase-1:diffuse')
            saved=load(path);self.assertEqual(saved['invocations']['phrase-1:diffuse']['attempts'],1)
            with self.assertRaisesRegex(ValueError,'already started'):reserve_stage(saved,path,'phrase-1:diffuse')
            reserve_stage(saved,path,'phrase-2:diffuse')
            self.assertEqual(len(load(path)['invocations']),2)

    def test_versioned_adapter_uses_its_own_rank_layers_and_strength(self):
        engine = Mock(); model = object()
        checkpoint = {'rank': 16, 'attention_layers': [5, 6, 7], 'adapter': {'saved': True}, 'recommended_strength': .65}
        install(engine, model, checkpoint, {'voice_model': 'v8'})
        engine.install.assert_called_once_with(model, rank=16, layers=[5, 6, 7])
        engine.restore.assert_called_once_with(engine.install.return_value, checkpoint['adapter'], .65)


if __name__ == '__main__': unittest.main()
