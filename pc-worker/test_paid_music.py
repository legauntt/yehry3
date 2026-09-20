import copy
import io
import json
import urllib.error
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
        for duration in (69, 119, 120, 240, 600):
            song = plan(duration); body = music_backend.composition(song, 123)
            self.assertEqual(paid_music.request_duration(body), duration*1000)
            actual = '\n'.join(c['text'] for c in body['composition_plan']['chunks'])
            self.assertEqual(words(actual), words(song['lyrics']))
            self.assertTrue(all(3000 <= c['duration_ms'] <= 120000 for c in body['composition_plan']['chunks']))
            self.assertTrue(all(len(c['text'].splitlines()) <= 30 for c in body['composition_plan']['chunks']))

    def test_repeated_lines_are_split_without_changing_lyrics_or_duration(self):
        from request_materials import words
        song = plan(250)
        song['lyrics'] = '[Section]\n' + '\n'.join(['I wanna fuck.'] * 84) + '\n[End]'
        body = music_backend.composition(song, 123)
        chunks = body['composition_plan']['chunks']
        self.assertEqual(paid_music.request_duration(body), 250000)
        self.assertTrue(all(len(chunk['text'].splitlines()) <= 30 for chunk in chunks))
        self.assertEqual(words('\n'.join(chunk['text'] for chunk in chunks)), words(song['lyrics']))

    def test_guide_vocal_is_requested_clean_unless_the_arrangement_asks_otherwise(self):
        song = plan(120)
        song['generation'] = {**song['generation'], 'avoidInstruments': ['banjo']}
        for chunk in music_backend.composition(song, 123)['composition_plan']['chunks']:
            self.assertIn(music_backend.GUIDE_VOCAL, chunk['positive_styles'])
            self.assertEqual(chunk['negative_styles'], ['banjo', *music_backend.GUIDE_VOCAL_AVOID])
        song['arrangement'] += ' A gospel choir answers him, and the bridge is screamed through a megaphone.'
        negative = music_backend.composition(song, 123)['composition_plan']['chunks'][0]['negative_styles']
        self.assertFalse({'choir', 'screamed vocals', 'megaphone vocals'} & set(negative))
        self.assertIn('vocoder', negative)
        brief = {'details': {'musicBackend': 'eleven_music'}}
        self.assertIn('only a guide', music_backend.planning_guidance(brief))

    def test_legacy_frozen_chunk_is_shaped_only_for_provider_transport(self):
        from request_materials import words
        frozen = copy.deepcopy(self.body)
        target = frozen['composition_plan']['chunks'][1]
        target['text'] = '[Verse]\n' + '\n'.join(['I wanna fuck.'] * 42)
        with self.assertRaisesRegex(ValueError, '30 lines'):
            paid_music.request_duration(frozen)
        provider = paid_music.provider_request(frozen)
        self.assertEqual(frozen['composition_plan']['chunks'][1]['text'], target['text'])
        self.assertEqual(paid_music.request_duration(provider), 240000)
        self.assertTrue(all(len(chunk['text'].splitlines()) <= 30
                            for chunk in provider['composition_plan']['chunks']))
        self.assertEqual(words('\n'.join(c['text'] for c in provider['composition_plan']['chunks'])),
                         words('\n'.join(c['text'] for c in frozen['composition_plan']['chunks'])))

    def test_paid_constraints_reject_local_candidates_unattached_remixes_and_band_adapter(self):
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

    def test_catalog_remix_uses_retained_lyrics_without_uploading_source_audio(self):
        song = plan() | {'recipe': 'reinterpretation'}
        brief = {'details': {'musicBackend': 'eleven_music', 'generation': song['generation'],
                            'remixSource': {'songId': 'source'}}}
        self.assertEqual(music_backend.plan_constraints(song, brief), song)
        self.assertIn('recipe=reinterpretation', music_backend.planning_guidance(brief))
        self.assertIn('do not condition Eleven Music', music_backend.planning_guidance(brief))
        body = music_backend.composition(song, 123)
        self.assertEqual(set(body), {'model_id', 'composition_plan', 'seed'})
        self.assertNotIn('source', body)
        self.assertEqual(paid_music.request_duration(body), 240000)
        import renderer
        request = {'music_backend': 'eleven_music', 'plan': song, 'basis': [{'remixSource': True, 'path': 'private.wav'}], 'config': {}}
        with patch('renderer.render_attempt', side_effect=RuntimeError('retained paid failure')) as attempt, \
             patch('renderer.vocal_recovery', return_value=False), patch('renderer.allow_vocal_warning', return_value=False), \
             patch('renderer.render_with_retry') as local:
            with self.assertRaisesRegex(RuntimeError, 'retained paid failure'): renderer.render(request)
            attempt.assert_called_once_with(request); local.assert_not_called()
            for basis in ([{'path': 'private.wav'}], [{'remixSource': True}] * 2):
                with self.assertRaisesRegex(ValueError, 'registered catalog remixes'): renderer.render(request | {'basis': basis})
            attempt.assert_called_once()

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

    def http_failure(self, detail, status=400):
        return urllib.error.HTTPError(paid_music.ENDPOINT, status, 'Bad Request',
            {'request-id': 'trace-fixture'}, io.BytesIO(json.dumps({'detail': detail}).encode()))

    def test_http_error_retains_private_diagnostic_and_reaches_worker_message(self):
        self.send.side_effect = self.http_failure({'code': 'invalid_plan', 'message':
            'Section too long; test-key-never-log', 'request_id': 'body-trace',
            'input': {'xi-api-key': 'test-key-never-log', 'lyrics': 'PRIVATE INPUT'}})
        with self.assertRaisesRegex(RuntimeError, r'HTTP 400.*invalid_plan.*Section too long.*body-trace'):
            self.compose()
        detail = load(self.work/'paid-error.json')
        self.assertEqual(detail['http_status'], 400)
        self.assertEqual(detail['provider']['request-id'], 'trace-fixture')
        self.assertEqual(detail['detail']['request_id'], 'body-trace')
        self.assertEqual(len(list((self.work/'paid-errors').glob('*.json'))), 1)
        for path in [self.ledger, self.work/'paid-error.json']:
            self.assertNotIn('test-key-never-log', path.read_text())
            self.assertNotIn('PRIVATE INPUT', path.read_text())
        with self.assertRaisesRegex(RuntimeError, 'No automatic repeat'): self.compose()
        self.send.assert_called_once()

    def test_validation_errors_exclude_echoed_input_and_oversized_bodies(self):
        detail = paid_music.failure_detail(self.http_failure([{'loc': ['body', 'seed'],
            'msg': 'Invalid seed', 'type': 'value_error', 'input': 'private lyric'}]))
        self.assertEqual(detail['validation'][0]['loc'], ['body', 'seed'])
        self.assertNotIn('private lyric', json.dumps(detail))
        error = urllib.error.HTTPError(paid_music.ENDPOINT, 502, 'Bad Gateway', {},
            io.BytesIO(b'private secret'*10000))
        detail = paid_music.failure_detail(error)
        self.assertTrue(detail['body_truncated'])
        self.assertNotIn('private secret', json.dumps(detail))
        detail = paid_music.failure_detail(urllib.error.HTTPError(paid_music.ENDPOINT, 503, 'Unavailable', {},
            io.BytesIO(b'<html>private secret</html>')))
        self.assertEqual(detail['body_read_error'], 'JSONDecodeError')

    def test_explicit_retry_is_consumed_before_send_and_keeps_original_attempt(self):
        self.send.side_effect = self.http_failure({'code': 'rejected', 'message': 'Original rejection'})
        with self.assertRaises(RuntimeError): self.compose()
        original = load(self.ledger)['requests'][-1]
        paid_music.authorize_retry(self.work, 'User explicitly approved one retry after inspecting provider logs.')
        self.assertEqual(paid_music.reserved_total(load(self.ledger)), 1700)
        def retry_send(body, key):
            row = load(self.ledger)['requests'][-1]
            self.assertEqual(row['operator_retry']['status'], 'consumed')
            self.assertEqual(row['operator_retry']['original_attempt'], original)
            self.assertEqual(body, self.body)
            return b'ID3'+b'a'*100000, {'song-id': 'retry-song'}
        self.send.side_effect = retry_send
        receipt = self.compose()
        self.assertEqual(receipt['attempt'], 2)
        self.assertEqual(receipt, self.compose())
        self.assertEqual(self.send.call_count, 2)
        self.assertEqual(paid_music.reserved_total(load(self.ledger)), 1700)

    def test_failed_operator_retry_cannot_be_repeated_or_reauthorized(self):
        self.send.side_effect = TimeoutError('First failure')
        with self.assertRaises(RuntimeError): self.compose()
        paid_music.authorize_retry(self.work, 'User explicitly approved this one additional attempt.')
        with self.assertRaisesRegex(ValueError, 'already has'): paid_music.authorize_retry(self.work, 'Duplicate authorization must fail.')
        self.send.side_effect = self.http_failure({'code': 'rejected_again', 'message': 'Second failure'})
        with self.assertRaisesRegex(RuntimeError, 'rejected_again'): self.compose()
        with self.assertRaisesRegex(RuntimeError, 'No automatic repeat'): self.compose()
        with self.assertRaisesRegex(ValueError, 'already has'): paid_music.authorize_retry(self.work, 'A second grant is not allowed.')
        self.assertEqual(self.send.call_count, 2)
        self.assertEqual(len(list((self.work/'paid-errors').glob('*.json'))), 2)

    def test_legacy_reconciliation_row_can_receive_one_bounded_grant(self):
        ledger = load(self.ledger)
        original = {'id': 'request-one', 'request_hash': fingerprint(self.body), 'reserved_cents': 400,
                    'status': 'requires_reconciliation', 'http_status': 400, 'error_type': 'HTTPError'}
        ledger['requests'].append(original); save(self.ledger, ledger)
        retry = paid_music.authorize_retry(self.work, 'User approved retry; old HTTP 400 and empty usage retained.')
        self.assertEqual(retry['original_attempt'], original)
        self.assertEqual(self.compose()['attempt'], 2)
        self.send.assert_called_once()

    def test_retry_authorization_respects_cap_disabled_policy_audio_and_changed_inputs(self):
        self.send.side_effect = TimeoutError('failed')
        with self.assertRaises(RuntimeError): self.compose()
        original = load(self.policy)
        for change in ({'cap_cents': 1500}, {'enabled': False}):
            save(self.policy, original | change)
            with self.assertRaisesRegex(ValueError, 'budget|disabled'):
                paid_music.authorize_retry(self.work, 'User has approved exactly one more attempt.')
        save(self.policy, original)
        partial = self.work/'paid-original.partial'; partial.write_bytes(b'retained')
        with self.assertRaisesRegex(ValueError, 'retained audio'):
            paid_music.authorize_retry(self.work, 'User has approved exactly one more attempt.')
        partial.unlink()
        save(self.work/'paid-request.json', self.body | {'seed': 124})
        with self.assertRaisesRegex(ValueError, 'frozen'):
            paid_music.authorize_retry(self.work, 'User has approved exactly one more attempt.')
        self.send.assert_called_once()

    def test_crash_after_durable_consumption_cannot_spend_again(self):
        self.send.side_effect = TimeoutError('first')
        with self.assertRaises(RuntimeError): self.compose()
        paid_music.authorize_retry(self.work, 'User explicitly approved one additional provider call.')
        self.send.side_effect = KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt): self.compose()
        with self.assertRaisesRegex(RuntimeError, 'No automatic repeat'): self.compose()
        self.assertEqual(self.send.call_count, 2)

    def test_current_transport_adapter_preserves_and_checks_frozen_worker(self):
        frozen = self.work/'paid_music.py'; frozen.write_text('# original frozen transport')
        manifest = {'workers': {'paid_music.py': sha(frozen)}, 'paid_inputs_sha256': {
            name: sha(self.work/name) for name in ('paid-inputs.json','paid-request.json')},
            'tasks': [{'name': 'generate', 'command': ['python', str(frozen), '--work', str(self.work)]},
                      {'name': 'prepare', 'command': ['python','private-voice.py']}]}
        before = copy.deepcopy(manifest)
        actual = music_backend.execution(self.work, manifest)
        self.assertEqual(manifest, before)
        self.assertEqual(actual['tasks'][1], manifest['tasks'][1])
        self.assertEqual(actual['tasks'][0]['command'][1], str(Path(paid_music.__file__)))
        self.assertEqual(sha(frozen), before['workers']['paid_music.py'])
        frozen.write_text('# tampered')
        with self.assertRaisesRegex(ValueError, 'frozen paid worker'):
            music_backend.execution(self.work, manifest)


if __name__ == '__main__': unittest.main()
