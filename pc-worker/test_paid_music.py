import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from common import fingerprint, load, save, sha, singleton
from generation_controls import normalize
import music_backend
import paid_music


def plan(duration=240):
    return {'recipe': 'new', 'title': 'The last bus', 'style': 'rock', 'duration': duration,
        'bpm': 108, 'keyscale': 'A minor', 'preserve_generated_backing': True, 'movements': [],
        'arrangement': 'Bass-led soul with a syncopated live drum pocket, clean guitar and clear contrasts between quiet verses and the final chorus.',
        'lyrics': '[Verse]\nThe driver knows my stop by heart\nHe sees me running from the store\n[Chorus]\nThe last bus has room for one more\nLeave your heavy day on the floor\n[End]',
        'generation': normalize({'version': 1, 'duration': duration})}


class PaidMusicTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.work = self.root / 'song'; self.work.mkdir()
        self.body = music_backend.composition(plan(), 123)
        self.policy = self.root / 'policy.json'; self.ledger = self.root / 'ledger.json'
        save(self.policy, {'version': 1, 'enabled': True, 'cap_cents': 20000,
                          'ledger': str(self.ledger), 'credential': str(self.root / 'key.dpapi')})
        save(self.ledger, {'version': 1, 'requests': [{'id': 'comparison', 'reserved_cents': 900}]})
        save(self.work / 'paid-request.json', self.body)
        save(self.work / 'paid-inputs.json', {'prompt_id': 'request-one', 'request_hash': fingerprint(self.body),
            'policy_path': str(self.policy), 'authorization': {'version': 1, 'backend': 'eleven_music',
            'budgetId': 'eleven-music-total-v1', 'currency': 'USD', 'duration': 240,
            'reservedCents': 400, 'rateCentsPerMinute': 100}})
        self.send = Mock(return_value=(b'ID3' + b'a'*100000, {'song-id': 'fixture'}))
        self.key = Mock(return_value='test-key-never-log')

    def compose(self): return paid_music.compose(self.work, self.send, self.key)

    def test_success_reuses_original_without_another_charge(self):
        first = self.compose(); original = sha(self.work / 'paid-original.mp3')
        self.assertEqual(first, self.compose()); self.send.assert_called_once()
        self.assertEqual(sha(self.work / 'paid-original.mp3'), original)
        self.assertEqual(sum(row['reserved_cents'] for row in load(self.ledger)['requests']), 1300)
        self.assertNotIn('test-key-never-log', self.ledger.read_text())

    def test_timeout_remains_reserved_and_blocks_repeat(self):
        self.send.side_effect = TimeoutError('private provider error with test-key-never-log')
        with self.assertRaisesRegex(RuntimeError, 'reconciliation'): self.compose()
        with self.assertRaisesRegex(RuntimeError, 'No automatic repeat'): self.compose()
        self.send.assert_called_once()
        self.assertNotIn('test-key-never-log', self.ledger.read_text())
        self.assertEqual(load(self.ledger)['requests'][-1]['status'], 'requires_reconciliation')

    def test_receipt_recovers_crash_before_final_ledger_write(self):
        self.compose(); saved = load(self.ledger); saved['requests'][-1]['status'] = 'reserved'; save(self.ledger, saved)
        self.compose(); self.send.assert_called_once()
        self.assertEqual(load(self.ledger)['requests'][-1]['status'], 'completed')

    def test_missing_or_changed_output_never_recomposes(self):
        self.compose(); (self.work / 'paid-original.mp3').write_bytes(b'changed')
        with self.assertRaises(ValueError): self.compose()
        self.send.assert_called_once()

    def test_disabled_or_exhausted_budget_never_calls_provider(self):
        for changed in ({'enabled': False}, {'cap_cents': 1000}):
            with self.subTest(changed=changed):
                original = load(self.policy); save(self.policy, original | changed)
                with self.assertRaises(ValueError): self.compose()
                save(self.policy, original)
        self.send.assert_not_called(); self.key.assert_not_called()

    def test_missing_ledger_is_not_reset(self):
        self.ledger.unlink()
        with self.assertRaises(FileNotFoundError): self.compose()
        self.send.assert_not_called()

    def test_pending_reservation_and_lock_prevent_double_spend(self):
        with singleton(self.ledger.with_suffix('.lock')) as acquired:
            self.assertTrue(acquired)
            with self.assertRaisesRegex(RuntimeError, 'holds the spending ledger'): self.compose()
        self.send.assert_not_called()
        saved = load(self.ledger)
        saved['requests'].append({'id': 'request-one', 'request_hash': fingerprint(self.body), 'reserved_cents': 400, 'status': 'reserved'})
        save(self.ledger, saved)
        with self.assertRaisesRegex(RuntimeError, 'No automatic repeat'): self.compose()
        self.send.assert_not_called()

    def test_frozen_request_and_authorized_duration_are_enforced(self):
        inputs = load(self.work / 'paid-inputs.json'); inputs['authorization']['duration'] = 180
        save(self.work / 'paid-inputs.json', inputs)
        with self.assertRaisesRegex(ValueError, 'authorization'): self.compose()
        self.send.assert_not_called()
        body = copy.deepcopy(self.body); body['seed'] += 1; save(self.work / 'paid-request.json', body)
        with self.assertRaisesRegex(ValueError, 'frozen'): self.compose()

    def test_sections_preserve_ordered_words_and_bounded_duration(self):
        from request_materials import words
        for duration in (120, 240, 600):
            song = plan(duration); body = music_backend.composition(song, 123)
            self.assertEqual(paid_music.request_duration(body), duration*1000)
            actual = '\n'.join(c['text'] for c in body['composition_plan']['chunks'])
            self.assertEqual(words(actual), words(song['lyrics']))
            self.assertTrue(all(3000 <= c['duration_ms'] <= 120000 for c in body['composition_plan']['chunks']))

    def test_paid_constraints_reject_local_candidates_remixes_and_band_adapter(self):
        song = plan(); brief = {'details': {'musicBackend': 'eleven_music', 'generation': song['generation']}}
        self.assertEqual(song, music_backend.plan_constraints(song, brief))
        for change in ({'recipe': 'reinterpretation'}, {'duration': 300}, {'preserve_generated_backing': False}):
            with self.assertRaises(ValueError): music_backend.plan_constraints(song | change, brief)
        for change in ({'basisSongIds': ['one']}, {'generation': song['generation'] | {'candidates': 2}}):
            with self.assertRaises(ValueError): music_backend.plan_constraints(song, {'details': brief['details'] | change})

    def test_renderer_never_enters_local_composition_retries(self):
        import renderer
        request = {'music_backend': 'eleven_music', 'plan': plan(), 'basis': [], 'config': {}}
        with patch('renderer.render_attempt', side_effect=RuntimeError('paid failure')) as attempt, \
             patch('renderer.vocal_recovery', return_value=False), patch('renderer.allow_vocal_warning', return_value=False), \
             patch('renderer.render_with_retry') as local, patch('renderer.ending_repair') as ending:
            with self.assertRaisesRegex(RuntimeError, 'paid failure'): renderer.render(request)
            attempt.assert_called_once(); local.assert_not_called(); ending.assert_not_called()

    def test_payment_reconciliation_never_triggers_monitor_or_shepherd_retry(self):
        from queue_monitor import classify
        from auto_shepherd import eligible
        for message in ['Paid music needs reconciliation: timeout', 'The local paid music budget is exhausted']:
            category, action, _ = classify(message, {'has_request': True})
            self.assertEqual((category, action), ('paid_music', 'review'))
            self.assertFalse(eligible(category, {'has_request': True}))

    def test_redirect_cannot_forward_key(self):
        req = paid_music.urllib.request.Request(paid_music.ENDPOINT, headers={'xi-api-key': 'fixture'})
        self.assertIsNone(paid_music.NoRedirect().redirect_request(req, None, 307, 'redirect', {}, 'https://example.invalid/'))


if __name__ == '__main__': unittest.main()
