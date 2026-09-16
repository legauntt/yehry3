import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import fingerprint, load, save
from composition_ending import work_path
from failure_evidence import selected_work
from lyric_length_repair import ORIGINAL_FILES, prepare, render_repair


class LyricLengthRepairTests(unittest.TestCase):
    def fixture(self, root):
        from test_request_materials import RequestMaterialsTests
        job = root / 'jobs' / 'request'; job.mkdir(parents=True)
        config, brief, plan = RequestMaterialsTests().setup_case(job)
        plan['duration'] = 120
        config['settings']['studio_dir'] = str(root / 'studio')
        config['state_dir'] = str(root)
        config['automatic_outro_retry'] = True
        request = {'prompt_id': 'request', 'directory': str(job), 'config': config,
                   'plan': plan, 'basis': [], 'voice_model': 'v7'}
        save(job / 'planning-input.json', {'briefHash': fingerprint(brief), 'brief': brief})
        save(job / 'plan.json', {'briefHash': fingerprint(brief), 'plan': plan})
        save(job / 'render-request.json', request)
        work = work_path(request); work.mkdir()
        for name in ORIGINAL_FILES: (work / name).write_bytes(b'retained original')
        save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'configure',
             'completed': ['generate', 'separate', 'words'], 'error': 'Insufficient vocal signal activity'})
        return request, work

    def test_shorter_attempt_is_bounded_resumable_and_preserves_frozen_work(self):
        with tempfile.TemporaryDirectory() as directory:
            request, original = self.fixture(Path(directory).resolve()); before = copy.deepcopy(request)
            retained = {p: p.read_bytes() for p in original.iterdir()}
            record = prepare(request, 85)
            self.assertEqual(prepare(request, 85), record)
            with self.assertRaisesRegex(ValueError, 'already reserved'): prepare(request, 90)
            child = record['child_request']; child_dir = Path(child['directory'])
            self.assertEqual(child['plan'], {**request['plan'], 'duration': 85})
            self.assertEqual(child['voice_model'], 'v7')
            self.assertFalse(child['config']['automatic_outro_retry'])
            self.assertNotEqual(work_path(child), original)
            with patch('planner.run_owned') as model:
                with self.assertRaisesRegex(RuntimeError, 'Interrupted'):
                    render_repair(request, lambda _: (_ for _ in ()).throw(RuntimeError('Interrupted')))
                def finish(resumed):
                    self.assertEqual(resumed, child)
                    self.assertEqual(load(child_dir / 'render-request.json'), child)
                    return {'status': 'verified', 'work_path': str(work_path(child)), 'duration': 85}
                result = render_repair(request, finish)
            model.assert_not_called()
            self.assertEqual(result['status'], 'verified')
            self.assertEqual(load(Path(request['directory']) / 'lyric-length-repair.json')['attempts'], 1)
            self.assertEqual(request, before)
            for path, contents in retained.items(): self.assertEqual(path.read_bytes(), contents)
            self.assertEqual(selected_work(request['config'], request['directory']), work_path(child))

    def test_tampered_original_child_and_parent_inputs_fail_closed(self):
        for changed in ('original', 'child', 'parent'):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory:
                request, work = self.fixture(Path(directory).resolve()); record = prepare(request, 85)
                if changed == 'original': (work / 'selected-vocals.wav').write_bytes(b'changed')
                elif changed == 'child': save(Path(record['child_request']['directory']) / 'plan.json', {})
                else: request['voice_model'] = 'v6'
                with self.assertRaisesRegex(ValueError, 'changed'), patch('planner.run_owned') as model:
                    render_repair(request, lambda _: self.fail('Must not render changed inputs'))
                model.assert_not_called()

    def test_no_automatic_shortening_or_replacement_of_started_voice(self):
        with tempfile.TemporaryDirectory() as directory:
            request, work = self.fixture(Path(directory).resolve())
            self.assertIsNone(render_repair(request, lambda _: self.fail('No operator journal')))
            state = load(work / 'desktop-status.json'); state['completed'].append('prepare')
            save(work / 'desktop-status.json', state)
            with self.assertRaisesRegex(ValueError, 'before conversion'): prepare(request, 85)
        for seconds in (59, 120):
            with tempfile.TemporaryDirectory() as directory:
                request, _ = self.fixture(Path(directory).resolve())
                with self.assertRaisesRegex(ValueError, '60–119'): prepare(request, seconds)


if __name__ == '__main__': unittest.main()
