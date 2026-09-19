import concurrent.futures
import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from common import fingerprint, load, save, sha
from planner import make_plan, validate
from renderer import allow_vocal_warning, ending_repair, failure_detail, render, write_progress
from source_material import source_material
from test_worker import plan


def gravity_inspiration_rejection():
    brief = {'prompt': 'Similar to Gravity, but about the horrors of Polarity in SC2 co op',
             'details': {'source': '', 'basisSongIds': ['basis-d2ee7d3dfa169d061659'], 'basisSongTitles': ['Gravity'],
                         'direction': "Capture the pain of needing your ally's help to kill a unit that you cannot", 'keep': 'Surprise me'}}
    rejected = {**plan(), 'recipe': 'needs_attention', 'title': 'My Target Your Problem', 'duration': 240,
                'bpm': 112, 'lyrics': '', 'preserve_generated_backing': False, 'fear_hunger': False,
                'explanation': 'A Gravity-based thematic rewrite needs a recipe that supports new lyrics from one basis song. Existing faithful recipes retain the source lyrics; the supplied material does not support reinterpretation.'}
    basis = [{'id': 'basis-d2ee7d3dfa169d061659', 'title': 'Gravity', 'sha256': 'a' * 64}]
    return brief, {'briefHash': fingerprint(brief), 'plan': rejected, 'model': 'test'}, basis


def medusa_lyrics_rejection():
    brief = {'prompt': 'Tony C trying to perform Medusa, but he gets all of the lyrics wrong',
             'details': {'basisSongIds': ['basis-7495956f046a9874e11c'], 'basisSongTitles': ['Medusa'],
                         'direction': 'Acoustic Medusa', 'keep': 'Incorrect lyrics. Pre-intro begins with Tony C asking, confused, "Dis is Tony C? From da shoes?"'}}
    rejected = {**plan(), 'recipe': 'needs_attention', 'title': 'Medusa Misremembered', 'style': 'acoustic',
                'duration': 258, 'bpm': 80, 'lyrics': '', 'fear_hunger': False,
                'explanation': "The existing acoustic recipe preserves Medusa's original lyrics and phrasing. Deliberately wrong lyrics and the added spoken introduction require an altered-lyrics rendition recipe that is not available."}
    basis = [{'id': 'basis-7495956f046a9874e11c', 'title': 'Medusa', 'sha256': 'a' * 64}]
    return brief, {'briefHash': fingerprint(brief), 'plan': rejected, 'model': 'test'}, basis


class RecoveryTests(unittest.TestCase):
    def test_saved_unicode_lyrics_read_in_recipe_and_descendant_without_changes(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'PYTHONUTF8': '0'}):
            root = Path(directory)
            track = root / 'track.json'
            save(track, {'lyrics': '\u201cOh hi, Tommy\u201d \u2014 caf\u00e9'})
            original = track.read_bytes()
            reader = "import json; from pathlib import Path; print(ascii(json.loads(Path('track.json').read_text())['lyrics']))"
            def attempt(*args):
                child = subprocess.check_output([sys.executable, '-c', reader], cwd=root)
                grandchild = subprocess.check_output([sys.executable, '-c',
                    'import subprocess, sys; subprocess.run([sys.executable, "-c", ' + repr(reader) + '], check=True)'], cwd=root)
                self.assertEqual(child, grandchild)
                self.assertEqual(child.decode().strip(), ascii(load(track)['lyrics']))
                return {'status': 'verified'}
            with patch('renderer.render_attempt', side_effect=attempt):
                self.assertEqual(render({'directory': directory, 'config': {}}), {'status': 'verified'})
            self.assertEqual(track.read_bytes(), original)

    def test_failure_detail_reports_innermost_encoding_error(self):
        with tempfile.TemporaryDirectory() as directory:
            save(Path(directory) / 'progress.json', {'stage': 'Checking the ending'})
            cause = "UnicodeDecodeError: 'charmap' codec can't decode byte 0x9d"
            error = RuntimeError('Checking the ending needs attention. Completed work is saved.\nTraceback (most recent call last):\n' + cause + '\nLog: private.log')
            detail = failure_detail({'directory': directory}, error)
            self.assertIn(cause, detail['message'])
            self.assertEqual(detail['stage'], 'Checking the ending')

    def test_failed_vocal_repair_falls_back_to_retained_audio_once_when_enabled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            work = root / ('troofs-desktop-' + str(uuid.uuid5(uuid.NAMESPACE_URL, 'prompt')))
            work.mkdir()
            files = ('selected-vocals.wav', 'selected-backing.wav', 'matched-vocals.wav')
            for name in files: (work / name).write_bytes(name.encode())
            save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'finish', 'error': "('Missing vocal phrase', [1, 1.2, 1.4])"})
            request = {'directory': str(root), 'prompt_id': 'prompt', 'plan': plan(), 'basis': [],
                       'config': {'vocal_dropout_warnings': True, 'settings': {'studio_dir': str(root / 'studio')}}}
            with patch('renderer.render_attempt', side_effect=[RuntimeError('dropout'), {'status': 'verified'}]) as attempt, \
                    patch('renderer.vocal_recovery', side_effect=[False, RuntimeError('repair failed')]):
                self.assertEqual(render(request), {'status': 'verified'})
                self.assertEqual(attempt.call_count, 2)
            policy = load(work / 'vocal-quality-policy.json')
            self.assertEqual(policy['recovery_disposition'], 'bounded_repair_exhausted')
            self.assertEqual(policy['inputs_sha256'], {name: sha(work / name) for name in files})
            self.assertFalse(allow_vocal_warning(request))
            for name in files: self.assertEqual((work / name).read_bytes(), name.encode())

    def test_versioned_voice_can_fall_back_to_a_visible_dropout_warning(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            work = root / ('troofs-desktop-' + str(uuid.uuid5(uuid.NAMESPACE_URL, 'prompt')))
            work.mkdir()
            for name in ('selected-vocals.wav', 'selected-backing.wav', 'matched-vocals.wav'):
                (work / name).write_bytes(name.encode())
            save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'finish', 'error': 'Missing vocal phrase'})
            request = {'directory': str(root), 'prompt_id': 'prompt', 'voice_model': 'v7',
                'config': {'vocal_dropout_warnings': True, 'settings': {'studio_dir': str(root / 'studio')}}}
            self.assertTrue(allow_vocal_warning(request))
            policy = load(work / 'vocal-quality-policy.json')
            self.assertEqual(policy['recovery_disposition'], 'not_supported_for_voice_model')
            self.assertEqual(policy['voice_model'], 'v7')

    def test_nonvocal_failure_or_disabled_rollout_cannot_enable_vocal_warning(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            work = root / ('troofs-desktop-' + str(uuid.uuid5(uuid.NAMESPACE_URL, 'prompt')))
            work.mkdir()
            request = {'directory': str(root), 'prompt_id': 'prompt',
                       'config': {'settings': {'studio_dir': str(root / 'studio')}}}
            save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'finish', 'error': 'Missing vocal phrase'})
            self.assertFalse(allow_vocal_warning(request))
            request['config']['vocal_dropout_warnings'] = True
            for stage, error in [('finish', 'Encoded peak too loud'), ('validate', 'Pitch error')]:
                save(work / 'desktop-status.json', {'status': 'failed', 'stage': stage, 'error': error})
                self.assertFalse(allow_vocal_warning(request))

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

    def test_source_material_recovers_completed_separation_with_matching_source_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); catalog = root / 'catalog-expansion-v6'
            vocals = catalog / 'source-stems/medusa-vocals.wav'; vocals.parent.mkdir(parents=True); vocals.write_bytes(b'saved voice')
            save(catalog / 'sources.json', [{'recording': 'medusa', 'source_sha256': 'a' * 64, 'cached_stems': None}])
            save(catalog / 'transcripts/medusa.json', {'segments': [{'text': 'Saved original reference words.'}]})
            journal = catalog / 'separation-status/medusa.json'
            saved = {'status': 'completed', 'recording': 'medusa', 'source_sha256': 'a' * 64, 'paths': {'vocals': str(vocals)}}
            save(journal, saved)
            config = {'settings': {'studio_dir': str(root / 'studio')}}
            basis = [{'id': 'one', 'title': 'Medusa', 'sha256': 'a' * 64}]
            result = source_material(config, basis)
            self.assertEqual(result['vocal_reference_sha256'], sha(vocals))
            self.assertEqual(result['lyrics_draft'], 'Saved original reference words.')
            for invalid in ({'status': 'processing'}, {'source_sha256': 'b' * 64}, {'recording': 'other'}):
                save(journal, {**saved, **invalid})
                self.assertIsNone(source_material(config, basis))
            save(journal, {**saved, 'paths': {'vocals': str(root / 'unrelated.wav')}})
            with self.assertRaisesRegex(ValueError, 'outside the configured directory'): source_material(config, basis)

    def test_medusa_altered_lyrics_and_spoken_intro_migrate_to_acoustic_reinterpretation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'PREFERENCES.md').write_text('Use Tony V6.')
            brief, old, basis = medusa_lyrics_rejection(); save(root / 'plan.json', old)
            material = {'title': 'Medusa', 'recording': 'medusa', 'lyrics_draft': 'Source motifs and original words.', 'lyrics_verified': False}
            config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
            adapted = {**plan(), 'recipe': 'reinterpretation', 'style': 'acoustic',
                       'lyrics': '[Spoken Intro]\nDis is Tony C? From da shoes?\n' + plan()['lyrics']}
            def model(command, *args, **kwargs):
                self.assertIn('recipe=reinterpretation, style=acoustic and preserve_generated_backing=true', kwargs['input_text'])
                self.assertIn('preserving any quoted requested line verbatim', kwargs['input_text'])
                self.assertIn('Source motifs and original words.', kwargs['input_text'])
                save(Path(command[command.index('--output-last-message') + 1]), adapted)
            with patch('planner.source_material', return_value=material), patch('planner.run_owned', side_effect=model) as called:
                self.assertEqual(make_plan(config, brief, root, basis), adapted)
                self.assertEqual(make_plan(config, brief, root, basis), adapted)
                called.assert_called_once()
            self.assertEqual(load(root / 'plan-before-altered-lyrics-support.json'), old)
            self.assertEqual(load(root / 'altered-lyrics-upgrade.json')['attempts'], 1)

    def test_altered_lyrics_upgrade_requires_source_and_preserves_started_or_exact_melody_requests(self):
        for boundary in ('missing_source', 'render-request.json', 'render-result.json', 'exact_melody'):
            with self.subTest(boundary=boundary), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); brief, old, basis = medusa_lyrics_rejection()
                if boundary.endswith('.json'): save(root / boundary, {'started': True})
                elif boundary == 'exact_melody':
                    brief['details']['keep'] += '; preserve exact original melody'
                    old['briefHash'] = fingerprint(brief)
                save(root / 'plan.json', old)
                with patch('planner.source_material', return_value=None), patch('planner.run_owned') as model:
                    self.assertEqual(make_plan({}, brief, root, basis), old['plan'])
                    model.assert_not_called()
                self.assertFalse((root / 'altered-lyrics-upgrade.json').exists())

    def test_altered_lyrics_upgrade_does_not_repeat_rejection_or_accept_wrong_backing_style(self):
        for output in ('rejected', 'wrong_style'):
            with self.subTest(output=output), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); (root / 'PREFERENCES.md').write_text('Use Tony V6.')
                brief, old, basis = medusa_lyrics_rejection(); save(root / 'plan.json', old)
                material = {'title': 'Medusa', 'recording': 'medusa', 'lyrics_draft': 'Saved source words.', 'lyrics_verified': False}
                config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
                def model(command, *args, **kwargs):
                    save(Path(command[command.index('--output-last-message') + 1]), old['plan'] if output == 'rejected' else {**plan(), 'recipe': 'reinterpretation'})
                with patch('planner.source_material', return_value=material), patch('planner.run_owned', side_effect=model) as called:
                    for attempt in range(2):
                        if output == 'rejected': self.assertEqual(make_plan(config, brief, root, basis), old['plan'])
                        else:
                            with self.assertRaisesRegex(ValueError, 'needs acoustic style'): make_plan(config, brief, root, basis)
                    self.assertEqual(called.call_count, 1 if output == 'rejected' else 3)

    def test_gravity_inspired_original_migrates_the_rejected_plan_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'PREFERENCES.md').write_text('Use Tony V6.')
            brief, old, basis = gravity_inspiration_rejection()
            save(root / 'plan.json', old)
            save(root / 'planner-result.json', old['plan'])
            save(root / 'planning-input.json', {'briefHash': old['briefHash']})
            config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
            def model(command, *args, **kwargs):
                instruction = kwargs['input_text']
                self.assertIn('Use new for an original with 0–5 basis songs, including exactly one reference.', instruction)
                self.assertIn('The faithful remix, acoustic and barbershop recipes retain the original lyrics', instruction)
                self.assertIn(brief['prompt'], instruction)
                output = Path(command[command.index('--output-last-message') + 1])
                self.assertNotEqual(output, root / 'planner-result.json')
                save(output, plan())
            with patch('planner.source_material', return_value=None), patch('planner.run_owned', side_effect=model) as called:
                self.assertEqual(make_plan(config, brief, root, basis)['recipe'], 'new')
                self.assertEqual(make_plan(config, brief, root, basis)['recipe'], 'new')
                called.assert_called_once()
            self.assertEqual(load(root / 'plan-before-single-basis-inspiration.json'), old)
            self.assertEqual(load(root / 'planner-result.json'), old['plan'])
            self.assertEqual(load(root / 'single-basis-inspiration-upgrade.json')['attempts'], 1)

    def test_single_basis_upgrade_bounds_invocations_and_recovers_saved_output(self):
        for outcome in ('rejected', 'interrupted', 'output_saved_before_interruption'):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); (root / 'PREFERENCES.md').write_text('Use Tony V6.')
                brief, old, basis = gravity_inspiration_rejection(); save(root / 'plan.json', old)
                config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
                def model(command, *args, **kwargs):
                    output = Path(command[command.index('--output-last-message') + 1])
                    if outcome != 'interrupted': save(output, old['plan'] if outcome == 'rejected' else plan())
                    if outcome != 'rejected': raise RuntimeError('Planner response interrupted')
                with patch('planner.source_material', return_value=None), patch('planner.run_owned', side_effect=model) as called:
                    if outcome == 'interrupted':
                        for _ in range(2):
                            with self.assertRaisesRegex(ValueError, 'after 3 attempts.*Planner response interrupted'):
                                make_plan(config, brief, root, basis)
                        self.assertEqual(called.call_count, 3)
                    else:
                        expected = 'new' if outcome == 'output_saved_before_interruption' else 'needs_attention'
                        self.assertEqual(make_plan(config, brief, root, basis)['recipe'], expected)
                        self.assertEqual(make_plan(config, brief, root, basis)['recipe'], expected)
                        called.assert_called_once()
                self.assertEqual(load(root / 'plan-before-single-basis-inspiration.json'), old)

    def test_inspiration_upgrade_preserves_started_work_and_faithful_requests(self):
        for boundary in ('render-request.json', 'render-result.json', 'faithful', 'unrelated_rejection', 'multiple_basis'):
            with self.subTest(boundary=boundary), tempfile.TemporaryDirectory() as directory:
                root = Path(directory); brief, old, basis = gravity_inspiration_rejection()
                if boundary.endswith('.json'): save(root / boundary, {'production_started': True})
                elif boundary == 'faithful':
                    brief['details']['keep'] = 'Preserve the melody and source lyrics'
                    old['briefHash'] = fingerprint(brief)
                elif boundary == 'unrelated_rejection': old['plan']['explanation'] = 'A new faithful quartet recipe is missing.'
                else: basis += [{**basis[0], 'id': 'other'}]
                save(root / 'plan.json', old)
                with patch('planner.run_owned') as model, patch('planner.source_material') as material:
                    self.assertEqual(make_plan({}, brief, root, basis), old['plan'])
                    model.assert_not_called(); material.assert_not_called()
                self.assertEqual(load(root / 'plan.json'), old)
                self.assertFalse((root / 'single-basis-inspiration-upgrade.json').exists())

    def test_inspiration_upgrade_rejects_a_faithful_recipe_as_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'PREFERENCES.md').write_text('Use Tony V6.')
            brief, old, basis = gravity_inspiration_rejection(); save(root / 'plan.json', old)
            config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
            def model(command, *args, **kwargs):
                save(Path(command[command.index('--output-last-message') + 1]), {**plan(), 'recipe': 'remix'})
            with patch('planner.source_material', return_value=None), patch('planner.run_owned', side_effect=model) as called:
                for attempt in range(2):
                    with self.assertRaisesRegex(ValueError, 'faithful rendition cannot replace'):
                        make_plan(config, brief, root, basis)
                self.assertEqual(called.call_count, 3)
            self.assertEqual(load(root / 'plan.json'), old)

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
