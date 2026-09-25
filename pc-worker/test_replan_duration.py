import copy, tempfile, unittest, urllib.error
from pathlib import Path
from unittest.mock import patch
from common import load, save
from auto_shepherd import validate_decision
from queue_monitor import scan
from test_replan import FakeAPI, DECISION, refused_job, steered

DECISION = {**DECISION, 'duration_seconds': 280, 'cover_artist': '', 'cover_title': ''}


class DurationAPI(FakeAPI):
    def __init__(self, rows):
        super().__init__(rows); self.corrections = []; self.corrected = False; self.correction_error = None
    def planning_duration(self, prompt, request_id, duration):
        self.corrections.append((prompt['version'], request_id, duration))
        if self.correction_error:
            raise urllib.error.HTTPError('https://example.test', self.correction_error, 'blocked', {}, None)
        if not self.corrected:
            self.rows[0]['version'] += 1; self.corrected = True
        return copy.deepcopy(self.rows[0])
    def retry(self, prompt):
        assert prompt['version'] == self.rows[0]['version'], 'retry must use the amended version'
        return super().retry(prompt)


class ReplanDurationTests(unittest.TestCase):
    def config(self, root): return {'state_dir': root, 'settings': {'studio_dir': str(Path(root) / 'studio')}}

    def test_decision_requires_authenticated_replan_and_accepts_legacy(self):
        self.assertEqual(validate_decision(DECISION, 'Bump duration to 280 seconds'), DECISION)
        for altered, guidance in [(DECISION, None), ({**DECISION, 'action': 'retry_saved_work'}, '280 seconds'),
                                  *[({**DECISION, 'duration_seconds': value}, 'change length') for value in (True, '280', 280.5, 68, 667)]]:
            with self.assertRaises(ValueError): validate_decision(altered, guidance)
        old = {key: value for key, value in DECISION.items() if key != 'duration_seconds'}
        self.assertEqual(validate_decision(old), old)

    def test_correction_precedes_archive_and_retry_uses_new_version(self):
        with tempfile.TemporaryDirectory() as root:
            job = refused_job(root); api = DurationAPI([steered()])
            with patch('queue_monitor.shepherd_decide', return_value=DECISION):
                scan(self.config(root), api, now=1000, request_id='one')
                self.assertEqual(api.corrections[0][2], 280); self.assertEqual(api.calls, ['one'])
                self.assertEqual(api.rows[0]['version'], 6)
                self.assertTrue((job / 'replans/1/plan.json').exists())
                self.assertFalse((Path(root) / 'monitor/report.json').exists())
                self.assertEqual(load(Path(root) / 'monitor/ledger.json')['history'], [])

    def test_rejected_correction_does_not_archive_or_spend_retry(self):
        for status in (400, 402, 409):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as root:
                job = refused_job(root); api = DurationAPI([steered()]); api.correction_error = status
                with patch('queue_monitor.shepherd_decide', return_value=DECISION): scan(self.config(root), api, now=1000)
                self.assertTrue((job / 'plan.json').exists()); self.assertEqual(api.calls, [])
                self.assertEqual(load(Path(root) / 'monitor/ledger.json')['requests']['one']['attempts'], [])

    def test_full_queue_replays_correction_without_another_replan(self):
        with tempfile.TemporaryDirectory() as root:
            job = refused_job(root); api = DurationAPI([steered()]); api.refuse = 429
            with patch('queue_monitor.shepherd_decide', return_value=DECISION) as model:
                scan(self.config(root), api, now=1000); scan(self.config(root), api, now=1001)
                self.assertEqual(api.calls, ['one']); model.assert_called_once()
                self.assertEqual(len(load(job / 'replans/journal.json')['replans']), 1)

    def test_target_filter_leaves_other_failed_requests_untouched(self):
        with tempfile.TemporaryDirectory() as root:
            refused_job(root); other = {**steered(), 'id': 'two'}
            api = DurationAPI([steered(), other])
            with patch('queue_monitor.shepherd_decide', return_value=DECISION):
                scan(self.config(root), api, now=1000, request_id='one')
            self.assertEqual(api.rows[1], other)
            self.assertNotIn('two', load(Path(root) / 'monitor/ledger.json')['requests'])

    def test_corrected_paid_duration_plans_preserved_words_and_survives_restart(self):
        from planner import make_plan
        from test_planner import fixture
        from replan import prepare
        with tempfile.TemporaryDirectory() as root:
            job = refused_job(root); (Path(root) / 'PREFERENCES.md').write_text('Use the selected saved Tony voice.')
            cfg = {**self.config(root), 'codex': 'test', 'planner_model': 'test', 'settings': {'studio_dir': root}}
            sheet = ' '.join(['window'] * 398)
            prompt = {'prompt': 'Meaning in a strange sound', 'details': {'musicBackend': 'eleven_music',
                'lyricSheet': {'mode': 'preserve', 'text': sheet}, 'generation': {'version': 1, 'duration': 280}}}
            prepare(job, 'duration-correction', True, 'Preserve every word at 280 seconds.')
            candidate = {**fixture(), 'duration': 280, 'lyrics': '[Verse]\n' + sheet + '\n[End]'}
            def model(command, *args, **kwargs):
                save(command[command.index('--output-last-message') + 1], candidate)
            with patch('planner.run_owned', side_effect=model) as call:
                plan = make_plan(cfg, prompt, job, [])
                self.assertEqual(plan['duration'], 280); self.assertEqual(plan['generation']['duration'], 280)
                self.assertEqual(make_plan(cfg, prompt, job, []), plan); call.assert_called_once()
            self.assertEqual(load(job / 'material-planning-attempts.json')['attempts'][0]['status'], 'accepted')
            self.assertTrue((job / 'replans/1/plan.json').exists())


if __name__ == '__main__': unittest.main()
