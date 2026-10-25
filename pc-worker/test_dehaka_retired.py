import tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from common import save, load
from queue_monitor import scan, DEHAKA_RETIRED
from test_queue_monitor import FakeAPI, prompt
from test_dehaka_feed import steered


class RetirementTests(unittest.TestCase):
    def config(self, root):
        return {'state_dir': root, 'automatic_shepherd': True, 'settings': {'studio_dir': str(Path(root) / 'studio')}}

    def test_pending_and_cached_guidance_cannot_consult_or_replan(self):
        self.assertTrue(DEHAKA_RETIRED)
        for guided in (False, True):
            with self.subTest(guided=guided), tempfile.TemporaryDirectory() as root:
                row = steered() if guided else prompt(error='Unexpected assertion')
                decision = {'action': 'replan', 'reason': 'Old cached advice'}
                entry = {'attempts': [], 'shepherd': decision, 'dehaka': {'status': 'decided',
                    'requestId': row.get('recovery', {}).get('shepherd', {}).get('requestId'), 'decision': decision}}
                save(Path(root) / 'monitor/ledger.json', {'requests': {'one': entry}, 'history': []})
                api = FakeAPI([row])
                with patch('queue_monitor.local_context', return_value={'has_request': True}), \
                     patch('queue_monitor.shepherd_decide') as consult, patch('queue_monitor.replan_prepare') as replan:
                    report = scan(self.config(root), api, now=1000)
                consult.assert_not_called(); replan.assert_not_called()
                self.assertEqual(api.calls, [])
                self.assertEqual(report['shepherd_consultations'], 0)
                self.assertFalse(any(body['kind'] == 'reply' for _, _, body in api.posts))

    def test_unsteered_failure_keeps_logs_and_known_recovery_still_runs_once(self):
        with tempfile.TemporaryDirectory() as root:
            job = Path(root) / 'jobs/one'; job.mkdir(parents=True)
            (job / 'renderer.log').write_text('TimeoutError: retry\ntoken=private-test-value', encoding='utf-8')
            row = prompt(); row['history'] = [{'status': 'failed', 'at': '2026-09-24T00:00:00Z'}]
            api = FakeAPI([row])
            with patch('queue_monitor.local_context', return_value={'directory': str(job)}), patch('queue_monitor.shepherd_decide') as consult:
                scan(self.config(root), api, now=1000)
                api.rows[0]['status'] = 'failed'
                scan(self.config(root), api, now=1001)
            consult.assert_not_called()
            self.assertEqual(api.calls, ['one'])
            failures = [b for _, _, b in api.posts if b.get('action') == 'failed']
            self.assertEqual(len(failures), 1)
            self.assertIn('TimeoutError', failures[0]['logs'][0]['text'])
            self.assertNotIn('private-test-value', str(failures))
            self.assertTrue(load(Path(root) / 'monitor/ledger.json')['requests']['one']['attempts'])
