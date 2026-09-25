import copy
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from common import load, save, sha
from queue_monitor import scan, classify, POLICY_VERSION
from failure_evidence import evidence
from reliability_audit import metrics
from auto_shepherd import decide, eligible
from test_queue_monitor import FakeAPI, prompt


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        # Historical journal/repair coverage; live retirement is tested separately.
        retired = patch('queue_monitor.DEHAKA_RETIRED', False)
        retired.start(); self.addCleanup(retired.stop)

    def config(self, root):
        return {'state_dir': root, 'settings': {'studio_dir': str(Path(root) / 'studio')}}

    def test_rate_counts_recovered_and_canceled_failures_once_and_excludes_unattempted(self):
        at = '2026-09-14T00:00:00Z'
        rows = [{'id': str(i), 'confirmedAt': '2026-09-13T00:00:00Z', 'status': status,
                 'history': [{'action': 'claimed', 'at': at}] + [{'status': 'failed', 'at': at}] * fails}
                for i, (status, fails) in enumerate([('published', 2), ('published', 0), ('canceled', 1)])]
        rows.append({'id': 'test', 'confirmedAt': at, 'status': 'canceled', 'history': []})
        result = metrics(rows, at)
        self.assertEqual((result['attempted'], result['affected'], result['failure_events']), (3, 2, 3))
        self.assertEqual(result['published_after_failure'], 1)
        self.assertEqual(result['excluded_unattempted'], 1)

    def test_old_wrapper_error_uses_actual_selected_stage_log(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'jobs' / 'one'; work = Path(root) / 'selected-work'
            save(directory / 'render-result.json', {'status': 'incomplete', 'work_path': str(work)})
            save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'ending'})
            log = work / 'desktop-logs' / 'ending.log'; log.parent.mkdir()
            log.write_text("UnicodeDecodeError: 'charmap' codec cannot decode byte", encoding='utf-8')
            ctx = evidence(self.config(root), 'one')
            self.assertEqual(Path(ctx['work']), work.resolve())
            self.assertEqual(classify(ctx['diagnostic_error'], ctx)[:2], ('unicode_runtime', 'retry'))
            save(work / 'desktop-status.json', {'status': 'completed', 'stage': 'completed'})
            self.assertNotIn('charmap', evidence(self.config(root), 'one')['diagnostic_error'])

    def test_queue_full_does_not_spend_budget_or_abort_other_requests(self):
        with tempfile.TemporaryDirectory() as root:
            api = FakeAPI([prompt('full'), prompt('next')]); original = api.retry
            def retry(row):
                if row['id'] == 'full': raise urllib.error.HTTPError('url', 429, 'full', {}, None)
                return original(row)
            api.retry = retry
            report = scan(self.config(root), api)
            self.assertEqual(report['retried'], 1)
            ledger = load(Path(root) / 'monitor/ledger.json')
            self.assertEqual(ledger['requests']['full']['attempts'], [])

    def test_signal_measurements_are_not_http_codes_and_pitch_failure_never_retries(self):
        self.assertEqual(classify("AssertionError: {'score': 0.503504502}", {})[:2], ('unknown', 'review'))
        for error in ('HTTP Error 503: Service Unavailable', 'HTTPError: 502', 'status code=504', '503 Service Unavailable'):
            self.assertEqual(classify(error, {})[:2], ('transient_runtime', 'retry'))
        error = "Connection recovered\nassert item['median_pitch_error_cents']<60\nAssertionError: {'label': 'phrase-027', 'median_pitch_error_cents': 1189.1904}"
        with tempfile.TemporaryDirectory() as root:
            cfg = {**self.config(root), 'automatic_shepherd': True, 'recovery_status_api': True}
            api = FakeAPI([prompt(error=error)]); phases = []
            def recovery(row, phase):
                phases.append(phase)
                return {**row, 'recovery': {'phase': phase}}
            api.recovery = recovery
            with patch('queue_monitor.local_context', return_value={'has_request': True}), patch('queue_monitor.shepherd_decide') as consult:
                report = scan(cfg, api)
                self.assertEqual(api.calls, []); consult.assert_not_called()
                self.assertEqual(phases, ['attention'])
                self.assertEqual(report['open_by_category'], {'audio_integrity': 1})

    def test_final_traceback_excludes_old_transient_errors_and_successful_metrics(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'jobs' / 'one'; work = Path(root) / 'selected-work'
            save(directory / 'render-result.json', {'status': 'incomplete', 'work_path': str(work)})
            save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'validate'})
            log = work / 'desktop-logs' / 'validate.log'; log.parent.mkdir()
            log.write_text('HTTP Error 503 recovered\n{"peak": 0.503}\nTraceback (most recent call last):\nAssertionError: Unexpected condition', encoding='utf-8')
            ctx = evidence(self.config(root), 'one')
            self.assertIn('503', ctx['stage_log'])
            self.assertNotIn('503', ctx['diagnostic_error'])
            self.assertEqual(classify(ctx['diagnostic_error'], ctx)[:2], ('unknown', 'review'))

    def test_lost_response_before_commit_reuses_reserved_attempt_even_when_budget_full(self):
        with tempfile.TemporaryDirectory() as root:
            cfg = self.config(root); api = FakeAPI([prompt()])
            attempts = [{'at_epoch': 1000, 'category': 'transient_runtime', 'policy_version': POLICY_VERSION}] * 3
            save(Path(root) / 'monitor/ledger.json', {'version': 1, 'history': [], 'requests': {
                'one': {'attempts': attempts, 'pending_retry': {'version': 1}, 'first_seen': 'then'}}})
            scan(cfg, api, now=1001)
            self.assertEqual(api.calls, ['one'])
            self.assertEqual(len(load(Path(root) / 'monitor/ledger.json')['requests']['one']['attempts']), 3)

    def test_shepherd_once_then_one_retry_and_never_for_integrity_or_cancellation(self):
        with tempfile.TemporaryDirectory() as root:
            cfg = {**self.config(root), 'automatic_shepherd': True}
            api = FakeAPI([prompt(error='Unexpected assertion')])
            ctx = {'directory': str(Path(root) / 'jobs/one'), 'has_request': True}
            with patch('queue_monitor.local_context', return_value=ctx), patch('queue_monitor.shepherd_decide', return_value={
                'action': 'retry_saved_work', 'reason': 'One saved stage retry is supported.', 'evidence': 'journal'}) as consult:
                scan(cfg, api, now=1000)
                api.rows[0]['status'] = 'failed'; scan(cfg, api, now=99999)
                self.assertEqual(api.calls, ['one']); consult.assert_called_once()
                api.rows[0]['status'] = 'canceled'; scan(cfg, api, now=999999)
                self.assertEqual(api.calls, ['one'])
            self.assertFalse(eligible('saved_inputs', ctx))
            self.assertFalse(eligible('audio_integrity', ctx))

    def test_dehaka_guidance_requests_one_bounded_shepherd_consultation(self):
        with tempfile.TemporaryDirectory() as root:
            cfg = self.config(root)
            row = prompt(error='Unexpected assertion')
            row['recovery'] = {'phase': 'recovering', 'shepherd': {
                'requestId': 'f85b981c-cd3a-46d8-b924-1a2c0b4f569f',
                'requestedAt': '2026-09-18T12:00:00Z',
                'guidance': 'Preserve the saved vocal and adapt the ending.',
            }}
            api = FakeAPI([row]); ctx = {'directory': str(Path(root) / 'jobs/one'), 'has_request': True}
            with patch('queue_monitor.local_context', return_value=ctx), patch('queue_monitor.shepherd_decide', return_value={
                'action': 'retry_saved_work', 'reason': 'Use the retained ending repair.', 'evidence': 'saved journal'}) as consult:
                scan(cfg, api, now=1000)
                self.assertEqual(api.calls, ['one'])
                self.assertEqual(consult.call_args.kwargs, {
                    'guidance': 'Preserve the saved vocal and adapt the ending.',
                    'consultation_id': 'f85b981c-cd3a-46d8-b924-1a2c0b4f569f',
                })
                self.assertEqual(load(Path(root) / 'monitor/ledger.json')['requests']['one']['dehaka']['status'], 'decided')

    def test_observe_only_never_marks_status_consults_model_or_verifies_delivery(self):
        with tempfile.TemporaryDirectory() as root:
            api = FakeAPI([prompt()]); api.recovery = lambda *a: self.fail('Unexpected API write')
            cfg = {**self.config(root), 'automatic_shepherd': True, 'recovery_status_api': True, 'verify_recovered_publication': True}
            with patch('queue_monitor.shepherd_decide') as consult, patch('queue_monitor.verify_delivery') as verify:
                scan(cfg, api, enabled=False)
                consult.assert_not_called(); verify.assert_not_called(); self.assertEqual(api.calls, [])

    def test_interrupted_consultation_never_spends_another_model_call(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / 'shepherd'
            save(directory / 'journal.json', {'status': 'started', 'attempts': 1})
            with patch('auto_shepherd.run_owned') as run:
                result = decide({}, prompt(), {'directory': root})
                self.assertEqual(result['action'], 'needs_code_fix'); run.assert_not_called()

    def test_one_pending_delivery_cannot_starve_other_recovered_publications(self):
        with tempfile.TemporaryDirectory() as root:
            cfg = {**self.config(root), 'verify_recovered_publication': True}
            api = FakeAPI([prompt('one', status='published'), prompt('two', status='published')])
            save(Path(root) / 'monitor/ledger.json', {'version': 1, 'history': [], 'requests': {
                p['id']: {'id': p['id'], 'prompt': p['prompt'], 'status': 'published', 'category': 'publication', 'attempts': []}
                for p in api.rows}})
            with patch('queue_monitor.verify_delivery', side_effect=KeyError('legacy metadata')) as verify:
                scan(cfg, api, now=1000); scan(cfg, api, now=1300)
                self.assertEqual([call.args[1]['id'] for call in verify.call_args_list], ['one', 'two'])
            self.assertEqual(api.calls, [])


if __name__ == '__main__': unittest.main()
