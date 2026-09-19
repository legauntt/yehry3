import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import load, save, sha
from composition_ending import (CompositionReady, EVIDENCE_FILES, REPORT, active_identifier,
    better_candidate, evidence, identifier, preflight_runner, render_with_retry, timing_instruction, work_path)
from planner import validate
from test_planner import fixture
from winprocess import Stopped


class CompositionEndingTests(unittest.TestCase):
    def request(self, root):
        return {'directory': str(root / 'job'), 'prompt_id': 'test-request', 'basis': [],
                'plan': {**fixture(), 'allow_long_instrumental_outro': False},
                'config': {'automatic_outro_retry': True, 'settings': {'studio_dir': str(root / 'studio')}}}

    def prepare_evidence(self, request, candidate=False, outro=35.9, coverage=.7, gap=8.78, trimmed=None):
        work = work_path(request, candidate)
        work.mkdir(exist_ok=True)
        for name in EVIDENCE_FILES:
            save(work / name, {'fixture': name, 'candidate': candidate})
        save(work / 'desktop-status.json', {'status': 'running', 'stage': 'prepare',
             'completed': ['generate', 'separate', 'words', 'configure', 'ending']})
        save(work / 'arrangement-checks.json', {'duration': 245.44, 'last_detected_voice': 245.44 - outro,
             'voiced_energy_fraction': coverage, 'long_vocal_gaps': [{'seconds': gap}]})
        save(work / 'mix-config.json', {'quiet_tail_trim': 'quiet-tail-trim.json'} if trimmed else {})
        save(work / 'quiet-tail-trim.json', {'status': 'ready', 'output_duration': trimmed} if trimmed else {'status': 'unchanged'})
        return work

    def attempt(self, request, calls, candidate_outro=9.8, candidate_error=None, original_outro=35.9):
        def render(req, repair, preflight=False, composition_retry=False):
            calls.append((preflight, composition_retry))
            if preflight:
                if composition_retry and candidate_error: raise candidate_error
                work = self.prepare_evidence(req, composition_retry, candidate_outro if composition_retry else original_outro)
                raise CompositionReady(work)
            return {'status': 'verified', 'candidate': composition_retry}
        return render

    def test_one_better_candidate_and_resume_without_regeneration(self):
        with tempfile.TemporaryDirectory() as directory:
            request = self.request(Path(directory)); original = copy.deepcopy(request); calls = []
            attempt = self.attempt(request, calls)
            self.assertTrue(render_with_retry(request, None, attempt)['candidate'])
            self.assertEqual(calls, [(True, False), (True, True), (False, True)])
            self.assertEqual(request, original)
            self.assertTrue(work_path(request).exists())
            journal = load(Path(request['directory']) / REPORT)
            self.assertEqual(journal['attempts'], 1)
            self.assertAlmostEqual(journal['original_evidence']['post_vocal_seconds'], 35.9)
            self.assertEqual(active_identifier(request), identifier(request, candidate=True))
            calls.clear()
            self.assertTrue(render_with_retry(request, None, attempt)['candidate'])
            self.assertEqual(calls, [(False, True)])

    def test_worse_or_failed_candidate_uses_original_and_preserves_warning_measurement(self):
        for tail, error in [(25, None), (9, RuntimeError('Ending needs completion before fade'))]:
            with self.subTest(tail=tail, error=error), tempfile.TemporaryDirectory() as directory:
                request = self.request(Path(directory)); calls = []
                attempt = self.attempt(request, calls, candidate_outro=tail, candidate_error=error)
                self.assertFalse(render_with_retry(request, None, attempt)['candidate'])
                journal = load(Path(request['directory']) / REPORT)
                self.assertEqual(journal['selected'], 'original')
                self.assertAlmostEqual(journal['original_evidence']['post_vocal_seconds'], 35.9)
                calls.clear()
                render_with_retry(request, None, attempt)
                self.assertEqual(calls, [(False, False)])

    def test_cancellation_and_changed_candidate_inputs_do_not_become_fallback(self):
        for error in [Stopped('Lease lost'), KeyboardInterrupt(), ValueError('Changed frozen input'), OSError('disk')]:
            with self.subTest(error=error), tempfile.TemporaryDirectory() as directory:
                request = self.request(Path(directory)); calls = []
                with self.assertRaises(type(error)):
                    render_with_retry(request, None, self.attempt(request, calls, candidate_error=error))
                journal = load(Path(request['directory']) / REPORT)
                self.assertEqual((journal['status'], journal['attempts']), ('candidate', 1))
                calls.clear()
                render_with_retry(request, None, self.attempt(request, calls))
                self.assertEqual(calls, [(True, True), (False, True)])

    def test_legacy_started_explicit_long_and_disabled_requests_are_unchanged(self):
        for mode in ('legacy', 'started', 'explicit_long', 'disabled', 'faithful'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                request = self.request(Path(directory)); calls = []
                if mode == 'legacy': request['plan'].pop('allow_long_instrumental_outro')
                elif mode == 'started': work_path(request).mkdir()
                elif mode == 'explicit_long': request['plan']['allow_long_instrumental_outro'] = True
                elif mode == 'disabled': request['config']['automatic_outro_retry'] = False
                else: request['plan']['recipe'] = 'remix'
                render_with_retry(request, None, self.attempt(request, calls))
                self.assertEqual(calls, [(False, False)])
                self.assertFalse((Path(request['directory']) / REPORT).exists())

    def test_minor_outro_never_spends_an_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            request = self.request(Path(directory)); calls = []
            render_with_retry(request, None, self.attempt(request, calls, original_outro=13.52))
            self.assertEqual(calls, [(True, False), (False, False)])
            self.assertEqual(load(Path(request['directory']) / REPORT)['attempts'], 0)

    def test_honors_existing_natural_silence_trim_and_refuses_started_voice(self):
        with tempfile.TemporaryDirectory() as directory:
            request = self.request(Path(directory))
            work = self.prepare_evidence(request, trimmed=219.54)
            self.assertAlmostEqual(evidence(work)['post_vocal_seconds'], 10)
            state = load(work / 'desktop-status.json'); state['completed'].append('prepare')
            save(work / 'desktop-status.json', state)
            with self.assertRaisesRegex(ValueError, 'after voice conversion'): evidence(work)

    def test_changed_source_and_plan_cannot_reuse_selection(self):
        for mode in ('source', 'plan'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                request = self.request(Path(directory)); calls = []
                render_with_retry(request, None, self.attempt(request, calls))
                if mode == 'source': (work_path(request) / 'selected-vocals.wav').write_bytes(b'changed')
                else: request['plan']['lyrics'] += '\nchanged'
                with self.assertRaisesRegex(ValueError, 'changed'):
                    render_with_retry(request, None, self.attempt(request, calls))

    def test_improved_outro_does_not_excuse_new_spacing_problems_or_cutoff(self):
        original = {'post_vocal_seconds': 35.9, 'voiced_energy_fraction': .70, 'longest_instrumental_break': 8.78}
        candidate = {**original, 'post_vocal_seconds': 9.8}
        self.assertTrue(better_candidate(original, candidate))
        for change in [{'post_vocal_seconds': .2}, {'post_vocal_seconds': 18},
                       {'voiced_energy_fraction': .60}, {'longest_instrumental_break': 9.5}]:
            self.assertFalse(better_candidate(original, {**candidate, **change}))

    def test_new_preference_is_optional_for_frozen_plans_but_strict_when_present(self):
        legacy = fixture()
        self.assertEqual(validate(legacy, []), legacy)
        for value in (True, False): validate({**legacy, 'allow_long_instrumental_outro': value}, [])
        with self.assertRaisesRegex(ValueError, 'ending preference'):
            validate({**legacy, 'allow_long_instrumental_outro': 'false'}, [])
        instruction = timing_instruction(246)
        self.assertIn('between 234 and 238 seconds', instruction)
        self.assertIn('around 236 seconds', instruction)

    def test_actual_engine_pauses_before_first_voice_stage_and_resumes_saved_stages(self):
        engine_file = Path(__file__).resolve().parents[2] / 'troofs-desktop/worker/engine_tasks.py'
        if not engine_file.exists(): self.skipTest('Installed Troofs engine not available')
        spec = importlib.util.spec_from_file_location('ending_test_engine', engine_file)
        engine = importlib.util.module_from_spec(spec); spec.loader.exec_module(engine)
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            tasks = engine.tasks_for(work, 'new', 'rock', {'python': 'python', 'voice_python': 'voice-python'})
            self.assertEqual(engine.VOICE_STAGES[0], 'prepare')
            initial = [task['name'] for task in tasks[:next(i for i,t in enumerate(tasks) if t['name'] == 'prepare')]]
            save(work / 'desktop-status.json', {'status': 'running', 'completed': initial})
            manifest = {'kind': 'new', 'tasks': tasks, 'settings': {'output_dir': str(work)}}
            with patch.object(engine, 'emit'), patch('composition_ending.subprocess.Popen') as popen:
                with self.assertRaises(CompositionReady): engine.execute_stages(work, manifest, runner=preflight_runner)
                popen.assert_not_called()
            self.assertEqual(load(work / 'desktop-status.json')['completed'], initial)
            class Process:
                pid = 123
                returncode = 0
                def poll(self): return 0
            launched = []
            def runner(command, **kwargs): launched.append(command); return Process()
            with patch.object(engine, 'emit'), patch.object(engine, 'verify_work', return_value={'status': 'verified'}):
                engine.execute_stages(work, manifest, runner=runner)
            self.assertEqual(launched[0][2], 'prepare')
            self.assertEqual(len(launched), len(tasks) - len(initial))
            self.assertEqual(load(work / 'desktop-status.json')['status'], 'completed')


if __name__ == '__main__': unittest.main()
