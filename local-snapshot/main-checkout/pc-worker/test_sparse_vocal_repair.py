import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import fingerprint, load, save, sha
from composition_ending import work_path
from failure_evidence import selected_work
from sparse_vocal_repair import (CHILD_FAILURE_FILES, ORIGINAL_FILES,
    RETAINED_ORIGINAL_FILES, REPORT, child_request, prepare,
    prepare_retained_original, provider_policy_rejection, render_repair)


class SparseVocalRepairTests(unittest.TestCase):
    def fixture(self, root, backing=True):
        from test_request_materials import RequestMaterialsTests
        job = root / 'jobs' / 'request'; job.mkdir(parents=True)
        config, brief, plan = RequestMaterialsTests().setup_case(job)
        plan['duration'] = 310
        config['settings']['studio_dir'] = str(root / 'studio')
        config['state_dir'] = str(root); config['automatic_outro_retry'] = True
        request = {'prompt_id': 'request', 'directory': str(job), 'config': config,
                   'plan': plan, 'basis': [], 'voice_model': 'v7'}
        save(job / 'planning-input.json', {'briefHash': fingerprint(brief), 'brief': brief})
        save(job / 'plan.json', {'briefHash': fingerprint(brief), 'plan': plan})
        save(job / 'render-request.json', request)
        work = work_path(request); work.mkdir()
        for name in ORIGINAL_FILES: (work / name).write_bytes(b'retained original')
        save(work / 'track.json', {'duration': 310})
        (work / 'configure_song.py').write_text('original coverage and ending checks', encoding='utf-8')
        save(work / 'desktop-job.json', {'track_sha256': sha(work / 'track.json'),
             'workers': {'configure_song.py': sha(work / 'configure_song.py')}})
        save(work / 'distonyc-configured.json', {'plan_hash': fingerprint(plan)})
        save(work / 'arrangement-checks.json', {'voiced_energy_fraction': .2085})
        save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'configure',
             'completed': ['generate', 'separate', *(['backing'] if backing else []), 'words'],
             'error': 'Insufficient vocal signal activity'})
        return request, work

    def test_one_attempt_resumes_after_interruption_and_preserves_all_originals(self):
        for backing in (True, False):
            with self.subTest(backing=backing), tempfile.TemporaryDirectory() as directory:
                request, work = self.fixture(Path(directory), backing)
                before = copy.deepcopy(request)
                retained = {p: p.read_bytes() for p in work.iterdir()}
                record = prepare(request); child = record['child_request']
                self.assertEqual(prepare(request), record)
                self.assertEqual(child['plan'], request['plan'])
                self.assertEqual(child['voice_model'], 'v7')
                self.assertNotEqual(work_path(child), work)
                with patch('planner.run_owned') as model:
                    with self.assertRaisesRegex(RuntimeError, 'Interrupted'):
                        render_repair(request, lambda _: (_ for _ in ()).throw(RuntimeError('Interrupted')))
                    def finish(resumed):
                        self.assertEqual(resumed, child)
                        self.assertEqual(load(Path(child['directory']) / 'render-request.json'), child)
                        return {'status': 'verified', 'work_path': str(work_path(child)), 'duration': 310}
                    self.assertEqual(render_repair(request, finish)['status'], 'verified')
                model.assert_not_called()
                self.assertEqual(load(Path(request['directory']) / REPORT)['attempts'], 1)
                self.assertEqual(selected_work(request['config'], request['directory']), work_path(child))
                self.assertEqual(request, before)
                for p, contents in retained.items(): self.assertEqual(p.read_bytes(), contents)

    def test_suite_movement_with_no_detected_regions_gets_one_separate_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            request, work = self.fixture(Path(directory), backing=False)
            request['suite_progress'] = {'path': str(Path(directory) / 'parent-progress.json'),
                                         'index': 0, 'count': 3}
            state = load(work / 'desktop-status.json')
            state['error'] = 'configure_song.py: regions=[...];assert regions\\nAssertionError'
            save(work / 'desktop-status.json', state)
            save(work / 'arrangement-checks.json', {'voiced_energy_fraction': 0.0,
                'no_qualifying_vocal_regions': True, 'operator_analysis': True})
            record = prepare(request)
            self.assertEqual(record['original_coverage'], 0.0)
            self.assertEqual(record['attempts'], 1)
            self.assertEqual(record['child_request']['suite_progress'], request['suite_progress'])
            self.assertTrue(record['child_request']['sparse_vocal_attempt'])

    def test_changed_inputs_and_attempt_budget_fail_closed(self):
        for change in ('audio', 'parent', 'plan_file', 'child_file', 'child_voice', 'budget'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                request, work = self.fixture(Path(directory)); record = prepare(request)
                journal = Path(request['directory']) / REPORT
                if change == 'audio': (work / 'selected-vocals.wav').write_bytes(b'changed')
                elif change == 'parent': request['basis'] = [{'id': 'another source'}]
                elif change == 'plan_file': save(Path(request['directory']) / 'plan.json', {})
                elif change == 'child_file': save(Path(record['child_request']['directory']) / 'plan.json', {})
                elif change == 'child_voice':
                    record['child_request']['voice_model'] = 'v6'; save(journal, record)
                else: record['attempts'] = 0; save(journal, record)
                with self.assertRaisesRegex(ValueError, 'changed'):
                    render_repair(request, lambda _: self.fail('Changed inputs must not run'))

    def test_invalid_original_and_prior_repairs_cannot_reserve_attempt(self):
        for change in ('voice_started', 'completed', 'other_failure', 'coverage', 'script', 'prior_shorter', 'prior_ending', 'orphan_child'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                request, work = self.fixture(Path(directory)); job = Path(request['directory'])
                state = load(work / 'desktop-status.json')
                if change == 'voice_started': state['completed'].append('prepare')
                elif change == 'completed': state['status'] = 'completed'
                elif change == 'other_failure': state['error'] = 'Ending needs completion before fade'
                elif change == 'coverage': save(work / 'arrangement-checks.json', {'voiced_energy_fraction': .6})
                elif change == 'script': (work / 'configure_song.py').write_text('changed', encoding='utf-8')
                elif change == 'prior_shorter': save(job / 'lyric-length-repair.json', {})
                elif change == 'prior_ending': save(job / 'ending-repair.json', {})
                else: work_path(child_request(request)).mkdir()
                save(work / 'desktop-status.json', state)
                with self.assertRaises(ValueError): prepare(request)
                self.assertFalse((job / REPORT).exists())

    def test_unprepared_requests_do_not_render_and_children_cannot_chain(self):
        import renderer
        with tempfile.TemporaryDirectory() as directory:
            request, work = self.fixture(Path(directory))
            self.assertIsNone(render_repair(request, lambda _: self.fail('No operator journal')))
            child = prepare(request)['child_request']
            self.assertIsNone(render_repair(child, lambda _: self.fail('Cannot nest')))
            with (patch('renderer.render_with_retry', side_effect=RuntimeError('Insufficient vocal signal activity')),
                 patch('renderer.vocal_recovery', return_value=False),
                 patch('renderer.allow_vocal_warning', return_value=False),
                  patch('renderer.ending_repair') as ending):
                with self.assertRaisesRegex(RuntimeError, 'Insufficient vocal'):
                    renderer.render(child)
            ending.assert_not_called()

    def test_unknown_result_cannot_select_another_recording(self):
        with tempfile.TemporaryDirectory() as directory:
            request, work = self.fixture(Path(directory)); prepare(request)
            with self.assertRaisesRegex(ValueError, 'selected composition'):
                render_repair(request, lambda _: {'status': 'verified', 'work_path': str(work)})

    def exhausted_paid_repair(self, root):
        request, work = self.fixture(root)
        record = prepare(request)
        child_work = work_path(record['child_request']); child_work.mkdir()
        for name in CHILD_FAILURE_FILES:
            (child_work / name).write_bytes(name.encode())
        (work / 'sparse-vocal-intent-policy.json').write_text('{}', encoding='utf-8')
        record.update(status='failed', error=(
            'Eleven Music HTTP 400 [bad_request]: composition plan violated Terms of Service. '
            'Paid music needs reconciliation; no automatic repeat charge is allowed.'))
        save(Path(request['directory']) / REPORT, record)
        return request, work, child_work

    def test_provider_policy_detection_is_exact(self):
        valid = {'status': 'failed', 'error': (
            'Eleven Music HTTP 400 [bad_request]: Terms of Service. '
            'Paid music needs reconciliation; no automatic repeat charge is allowed.')}
        self.assertTrue(provider_policy_rejection(valid))
        for change in (
                {**valid, 'status': 'rendering'},
                {**valid, 'error': 'Eleven Music HTTP 400 [bad_request]: temporary failure'},
                {**valid, 'error': 'Terms of Service; no automatic repeat charge is allowed.'},
                {**valid, 'error': 'Eleven Music HTTP 400; Terms of Service'}):
            self.assertFalse(provider_policy_rejection(change))

    def test_provider_policy_failure_resumes_hash_pinned_original_and_restarts(self):
        with tempfile.TemporaryDirectory() as directory:
            request, work, _ = self.exhausted_paid_repair(Path(directory))
            issue = {'code': 'long_instrumental_break', 'seconds': 13.12}
            selected_requests = []
            def interrupted(selected):
                selected_requests.append(selected)
                save(work / 'desktop-status.json', {'status': 'processing', 'stage': 'prepare'})
                raise RuntimeError('Interrupted after selecting the retained original')
            intent = {'kind': 'paid_spoken_jazz_reinterpretation'}
            with patch('sparse_intent_policy.verify', return_value=intent):
                with self.assertRaisesRegex(RuntimeError, 'Interrupted'):
                    render_repair(request, interrupted)
                before = load(Path(request['directory']) / REPORT)
                prepare_retained_original(request, before)
                self.assertEqual(load(Path(request['directory']) / REPORT), before)
                result = render_repair(request, lambda selected: (
                    selected_requests.append(selected) or {
                        'status': 'verified', 'work_path': str(work),
                        'qualityIssues': [issue]}))
            self.assertEqual(result['qualityIssues'], [issue])
            self.assertEqual(len(selected_requests), 2)
            self.assertTrue(all(row['retained_sparse_original'] for row in selected_requests))
            self.assertTrue(all(row['prompt_id'] == request['prompt_id'] for row in selected_requests))
            journal = load(Path(request['directory']) / REPORT)
            self.assertEqual(journal['attempt_limit'], 1)
            self.assertEqual(journal['attempts'], 1)
            self.assertEqual(journal['selected_work'], str(work))
            self.assertEqual(journal['retained_original']['status'], 'verified')
            self.assertEqual(journal['retained_original']['repair_attempts_consumed'], 1)
            self.assertEqual(set(journal['retained_original']['inputs_sha256']),
                             set(RETAINED_ORIGINAL_FILES))
            self.assertNotIn('desktop-status.json',
                             journal['retained_original']['inputs_sha256'])
            self.assertEqual(set(journal['retained_original']['child_failure_sha256']),
                             set(CHILD_FAILURE_FILES))
            self.assertFalse(journal['retained_original']['audio_changed'])
            self.assertFalse(journal['retained_original']['additional_paid_generation'])
            self.assertTrue(journal['retained_original']['other_integrity_checks_retained'])

    def test_retained_original_refuses_missing_policy_wrong_cause_and_wrong_intent(self):
        for change in ('policy', 'cause', 'intent'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                request, work, _ = self.exhausted_paid_repair(Path(directory))
                journal = Path(request['directory']) / REPORT
                record = load(journal)
                if change == 'policy':
                    (work / 'sparse-vocal-intent-policy.json').unlink()
                elif change == 'cause':
                    record.update(status='failed', error='Temporary connection failure')
                    save(journal, record)
                intent = {'kind': ('spoken_jazz_reinterpretation' if change == 'intent'
                                   else 'paid_spoken_jazz_reinterpretation')}
                with patch('sparse_intent_policy.verify', return_value=intent):
                    with self.assertRaises(ValueError):
                        prepare_retained_original(request, load(journal))
                self.assertNotIn('retained_original', load(journal))

    def test_retained_original_rechecks_every_pinned_input_and_budget(self):
        for change in ('audio', 'child_failure', 'policy', 'planning', 'budget'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                request, work, child_work = self.exhausted_paid_repair(Path(directory))
                journal = Path(request['directory']) / REPORT
                intent = {'kind': 'paid_spoken_jazz_reinterpretation'}
                with patch('sparse_intent_policy.verify', return_value=intent):
                    prepare_retained_original(request, load(journal))
                    if change == 'audio':
                        (work / 'selected-vocals.wav').write_bytes(b'changed')
                    elif change == 'child_failure':
                        (child_work / 'paid-error.json').write_bytes(b'changed')
                    elif change == 'policy':
                        (work / 'sparse-vocal-intent-policy.json').write_text('changed')
                    elif change == 'planning':
                        (Path(request['directory']) / 'plan.json').write_text('{}')
                    else:
                        record = load(journal); record['attempts'] = 2; save(journal, record)
                    with self.assertRaisesRegex(ValueError, 'changed|budget'):
                        render_repair(request, lambda _: self.fail('Changed evidence must not render'))


if __name__ == '__main__': unittest.main()
