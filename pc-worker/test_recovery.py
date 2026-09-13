import concurrent.futures
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from common import fingerprint, load, save, sha
from planner import make_plan, validate
from renderer import ending_repair, render, write_progress
from source_material import source_material
from test_worker import plan


class RecoveryTests(unittest.TestCase):
    def test_atomic_save_retries_windows_sharing_violation_and_preserves_old_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'progress.json'; save(path, {'old': True})
            original = Path.replace; attempts = []
            def replace(temporary, target):
                attempts.append(temporary)
                if len(attempts) < 3:
                    self.assertEqual(load(target), {'old': True})
                    error = PermissionError('shared destination'); error.winerror = 5; raise error
                return original(temporary, target)
            with patch.object(Path, 'replace', replace), patch('common.time.sleep') as sleep:
                save(path, {'new': True})
                self.assertEqual(sleep.call_count, 2)
            self.assertEqual(load(path), {'new': True})
            self.assertEqual(list(Path(directory).glob('*.tmp')), [])

    def test_concurrent_writers_leave_one_complete_document_and_no_temporary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                list(pool.map(lambda i: save(path, {'writer': i, 'data': str(i) * 5000}), range(24)))
            value = load(path)
            self.assertEqual(value['data'], str(value['writer']) * 5000)
            self.assertEqual(list(Path(directory).glob('*.tmp')), [])

    def test_persistent_failure_retains_state_but_progress_failure_does_not_abort_render(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'; save(path, {'saved': True})
            error = PermissionError('still locked'); error.winerror = 32
            with patch.object(Path, 'replace', side_effect=error), patch('common.time.monotonic', side_effect=[0, 4]):
                with self.assertRaises(PermissionError): save(path, {'lost': True})
            self.assertEqual(load(path), {'saved': True})
            self.assertEqual(list(Path(directory).glob('*.tmp')), [])
            with patch('renderer.save', side_effect=error): write_progress(path, {'stage': 'Composing', 'progress': .3})

    def test_rap_recipe_requires_source_and_keeps_genre_backing(self):
        rap = {**plan(), 'recipe': 'reinterpretation'}
        self.assertEqual(validate(rap, [{'id': 'song'}]), rap)
        for basis in [[], [{'id': 'a'}, {'id': 'b'}]]:
            with self.assertRaises(ValueError): validate(rap, basis)
        with self.assertRaises(ValueError): validate({**rap, 'preserve_generated_backing': False}, [{'id': 'song'}])

    def test_only_unstarted_blocked_rap_plan_is_upgraded_and_old_plan_is_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'PREFERENCES.md').write_text('Use Tony V6.')
            brief = {'prompt': 'Little Bit More as a rap song', 'details': {}}
            old = {'briefHash': fingerprint(brief), 'plan': {**plan(), 'recipe': 'needs_attention', 'explanation': 'A rap recipe is missing.'}}
            save(root / 'plan.json', old)
            basis = [{'id': 'song', 'sha256': 'a' * 64, 'path': 'PRIVATE-PATH'}]
            material = {'title': 'Song', 'recording': 'song', 'lyrics_draft': 'Actual source hook', 'lyrics_verified': False}
            config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
            def model(*args, **kwargs):
                self.assertIn('Actual source hook', kwargs['input_text'])
                self.assertNotIn('PRIVATE-PATH', kwargs['input_text'])
                save(root / 'planner-result.json', {**plan(), 'recipe': 'reinterpretation'})
            with patch('planner.source_material', return_value=material), patch('planner.run_owned', side_effect=model) as called:
                result = make_plan(config, brief, root, basis)
                self.assertEqual(result['recipe'], 'reinterpretation'); called.assert_called_once()
            self.assertEqual(load(root / 'plan-before-rap-support.json'), old)
            save(root / 'plan.json', old); save(root / 'render-request.json', {})
            with patch('planner.run_owned') as model:
                self.assertEqual(make_plan(config, brief, root, basis)['recipe'], 'needs_attention')
                model.assert_not_called()

    def test_source_material_uses_exact_catalog_hash_and_saved_vocal_stem(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); cat = root / 'catalog-expansion-v6'; (cat / 'transcripts').mkdir(parents=True)
            vocals = root / 'vocals.wav'; vocals.write_bytes(b'saved source vocals')
            save(cat / 'sources.json', [{'recording': 'song', 'source_sha256': 'a' * 64, 'cached_stems': {'vocals': str(vocals)}}])
            save(cat / 'transcripts/song.json', [{'text': ' Source hook.'}])
            config = {'settings': {'studio_dir': str(root / 'studio')}}
            basis = [{'id': 'one', 'title': 'Song', 'sha256': 'a' * 64}]
            result = source_material(config, basis)
            self.assertEqual(result['lyrics_draft'], 'Source hook.')
            self.assertEqual(result['vocal_reference_sha256'], sha(vocals))
            self.assertFalse(result['lyrics_verified'])
            self.assertIsNone(source_material(config, [{**basis[0], 'sha256': 'b' * 64}]))

    def test_cutoff_repair_is_one_separate_attempt_and_resume_reuses_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); ident = str(uuid.uuid5(uuid.NAMESPACE_URL, 'prompt'))
            work = root / ('troofs-desktop-' + ident); work.mkdir()
            request = {'directory': str(root), 'prompt_id': 'prompt', 'plan': {**plan(), 'duration': 252}, 'basis': [],
                       'config': {'settings': {'studio_dir': str(root / 'studio')}}}
            save(work / 'desktop-job.json', {'frozen': True})
            save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'configure', 'error': 'Ending needs completion before fade'})
            save(work / 'arrangement-checks.json', {'duration': 251.6, 'last_detected_voice': 251.26, 'last_second_mix_dbfs': -29.33})
            with patch('renderer.render_attempt', side_effect=[RuntimeError('cutoff'), {'status': 'verified'}]) as attempt:
                self.assertEqual(render(request), {'status': 'verified'})
                self.assertIsNone(attempt.call_args_list[0].args[1])
                self.assertEqual(attempt.call_args_list[1].args[1]['duration'], 284)
            self.assertTrue((work / 'desktop-job.json').exists())
            with patch('renderer.render_attempt', side_effect=RuntimeError('still cutoff')) as attempt:
                with self.assertRaises(RuntimeError): render(request)
                attempt.assert_called_once()
            save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'configure', 'error': 'Missing vocals'})
            self.assertIsNone(ending_repair(request, work))


if __name__ == '__main__': unittest.main()
