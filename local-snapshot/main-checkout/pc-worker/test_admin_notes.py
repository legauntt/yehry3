import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

from common import fingerprint, load, save
from planner import make_plan
from test_worker import plan


class AdminNoteTests(unittest.TestCase):
    def setup_job(self, root):
        (root / 'PREFERENCES.md').write_text('Use Tony V6.', encoding='utf-8')
        config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
        prompt = {'prompt': 'Tony works at Wal-Mart', 'details': {},
                  'adminNote': 'Include Fairbanks, Alaska and being kicked out onto the street.',
                  'owner': 'private-owner-not-for-the-model'}
        return config, prompt

    def test_note_reaches_model_separately_from_public_brief(self):
        with tempfile.TemporaryDirectory() as directory, patch('planner.plan_with_feedback', return_value=plan()) as model:
            root = Path(directory); config, prompt = self.setup_job(root)
            self.assertEqual(make_plan(config, prompt, root, []), plan())
            instruction = model.call_args.args[3]
            self.assertIn(json.dumps(prompt['adminNote']), instruction)
            self.assertIn('UNTRUSTED PRIVATE ADMIN NOTE', instruction)
            self.assertNotIn(prompt['owner'], instruction)
            snapshot = load(root / 'planning-input.json')
            self.assertEqual(snapshot['adminNote'], prompt['adminNote'])
            self.assertEqual(snapshot['brief'], {'prompt': prompt['prompt'], 'details': {}})
            self.assertEqual(snapshot['briefHash'], fingerprint(snapshot['brief']))

    def test_interrupted_planning_keeps_first_note_on_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); config, prompt = self.setup_job(root)
            with patch('planner.plan_with_feedback', side_effect=RuntimeError('Interrupted')):
                with self.assertRaisesRegex(RuntimeError, 'Interrupted'):
                    make_plan(config, prompt, root, [])
            original_note = prompt['adminNote']
            prompt['adminNote'] = 'Changed note should not replace saved inputs'
            with patch('planner.plan_with_feedback', return_value=plan()) as model:
                make_plan(config, prompt, root, [])
            self.assertIn(json.dumps(original_note), model.call_args.args[3])
            self.assertNotIn(prompt['adminNote'], model.call_args.args[3])
            self.assertEqual(load(root / 'planning-input.json')['adminNote'], original_note)

    def test_old_planning_snapshot_without_note_keeps_original_inputs(self):
        with tempfile.TemporaryDirectory() as directory, patch('planner.plan_with_feedback', return_value=plan()) as model:
            root = Path(directory); config, prompt = self.setup_job(root)
            brief = {'prompt': prompt['prompt'], 'details': prompt['details']}
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief), 'brief': brief, 'basis': []})
            make_plan(config, prompt, root, [])
            self.assertNotIn(prompt['adminNote'], model.call_args.args[3])
            self.assertEqual(load(root / 'planning-input.json')['adminNote'], '')

    def test_note_edits_preserve_started_plan_and_legacy_cache(self):
        for started in (False, True):
            with self.subTest(started=started), tempfile.TemporaryDirectory() as directory, patch('planner.plan_with_feedback') as model:
                root = Path(directory); config, prompt = self.setup_job(root)
                brief = {'prompt': prompt['prompt'], 'details': prompt['details']}
                save(root / 'plan.json', {'briefHash': fingerprint(brief), 'plan': plan()})
                if started: save(root / 'render-request.json', {'frozen': True})
                before = (root / 'plan.json').read_bytes()
                for note in (prompt['adminNote'], '', 'A later note'):
                    prompt['adminNote'] = note
                    self.assertEqual(make_plan(config, prompt, root, []), plan())
                self.assertEqual((root / 'plan.json').read_bytes(), before)
                model.assert_not_called()

    def test_missing_empty_and_null_notes_remain_optional(self):
        for value in ('missing', '', None):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory, patch('planner.plan_with_feedback', return_value=plan()) as model:
                root = Path(directory); config, prompt = self.setup_job(root)
                if value == 'missing': prompt.pop('adminNote')
                else: prompt['adminNote'] = value
                make_plan(config, prompt, root, [])
                self.assertNotIn('UNTRUSTED PRIVATE ADMIN NOTE', model.call_args.args[3])
                self.assertEqual(load(root / 'planning-input.json')['adminNote'], '')


if __name__ == '__main__': unittest.main()
