import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import fingerprint, load, save, sha
from composition_ending import work_path
from failure_evidence import selected_work
from sparse_vocal_repair import ORIGINAL_FILES, REPORT, child_request, prepare, render_repair


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
                request, work = self.fixture(Path(directory).resolve(), backing)
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

    def test_changed_inputs_and_attempt_budget_fail_closed(self):
        for change in ('audio', 'parent', 'plan_file', 'child_file', 'child_voice', 'budget'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                request, work = self.fixture(Path(directory).resolve()); record = prepare(request)
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
                request, work = self.fixture(Path(directory).resolve()); job = Path(request['directory'])
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
            request, work = self.fixture(Path(directory).resolve())
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
            request, work = self.fixture(Path(directory).resolve()); prepare(request)
            with self.assertRaisesRegex(ValueError, 'selected composition'):
                render_repair(request, lambda _: {'status': 'verified', 'work_path': str(work)})


if __name__ == '__main__': unittest.main()
