import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import paid_music
import reconcile_paid_music as reconcile


def row(identifier, duration_ms, reserved, status='completed', **extra):
    return {'id': identifier, 'request_hash': 'h-' + identifier, 'reserved_cents': reserved,
            'duration_ms': duration_ms, 'status': status, 'at': '2026-09-19T00:00:00Z', **extra}


def retry(reserved, status='consumed', original=None):
    return {'version': 1, 'id': 'r-1', 'authorized_at': '2026-09-19T00:00:00Z',
            'reason': 'operator authorized this retry for the test',
            'request_hash': None, 'reserved_cents': reserved, 'status': status,
            'original_attempt': original or {}}


class Ledger:
    """A policy plus ledger on disk, wired to a stubbed provider usage reading."""

    def __init__(self, directory, rows, credits):
        self.path = Path(directory) / 'ledger.json'
        self.policy_path = Path(directory) / 'policy.json'
        for item in rows:
            item.setdefault('request_hash', 'h')
            if item.get('operator_retry'):
                item['operator_retry']['request_hash'] = item['request_hash']
                item['operator_retry']['reserved_cents'] = item['reserved_cents']
        paid_music.save(self.path, {'version': 1, 'requests': rows})
        paid_music.save(self.policy_path, {'version': 1, 'enabled': True, 'cap_cents': 20000,
                                           'ledger': str(self.path), 'credential': str(Path(directory) / 'key')})
        self.credits = credits

    def run(self, apply=False):
        with patch.object(reconcile, 'provider_credits', return_value={'music_v2_5': self.credits}):
            return reconcile.reconcile(self.policy_path, apply=apply)

    def read(self):
        return json.loads(self.path.read_text('utf-8'))


class ReconcileTest(unittest.TestCase):
    def ledger(self, rows, credits):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        return Ledger(directory.name, rows, credits)

    def test_settles_completed_rows_to_the_published_rate(self):
        # Four minutes generated: held at $4.00, actually $0.60.
        book = self.ledger([row('a', 240000, 400)], credits=4 * reconcile.CREDITS_PER_MINUTE)
        report = book.run(apply=True)
        self.assertEqual(report['before_cents'], 400)
        self.assertEqual(report['after_cents'], 60)
        self.assertEqual(report['unresolved'], [])
        stored = book.read()['requests'][0]
        self.assertEqual(stored['reconciled_cents'], 60)
        # The original authorization is preserved so receipt-backed resume still validates.
        self.assertEqual(stored['reserved_cents'], 400)
        self.assertEqual(paid_music.reserved_total(book.read()), 60)

    def test_rejected_attempt_settles_to_zero(self):
        book = self.ledger([row('a', 205000, 342, status='requires_reconciliation',
                                error_type='HTTPError', http_status=400)], credits=0)
        report = book.run(apply=True)
        self.assertEqual(report['after_cents'], 0)
        self.assertEqual(book.read()['requests'][0]['reconciled_cents'], 0)

    def test_consumed_retry_bills_once_and_clears_the_rejected_first_attempt(self):
        book = self.ledger([row('a', 250000, 417, operator_retry=retry(
            417, original={'status': 'requires_reconciliation', 'error_type': 'HTTPError', 'http_status': 422}))],
            credits=250000 / 60000 * reconcile.CREDITS_PER_MINUTE)
        report = book.run(apply=True)
        self.assertEqual(report['before_cents'], 834)
        self.assertEqual(report['after_cents'], 63)  # ceil(250s * 15c/min)
        stored = book.read()['requests'][0]
        self.assertEqual(stored['reconciled_cents'], 0)
        self.assertEqual(stored['operator_retry']['reconciled_cents'], 63)

    def test_authorized_but_unsent_retry_settles_to_zero(self):
        book = self.ledger([row('a', 240000, 400, operator_retry=retry(400, status='authorized'))],
                           credits=4 * reconcile.CREDITS_PER_MINUTE)
        book.run(apply=True)
        self.assertEqual(book.read()['requests'][0]['operator_retry']['reconciled_cents'], 0)

    def test_unexplained_failure_keeps_its_full_hold(self):
        # A timeout may have generated and billed audio; only a provider rejection is evidence.
        book = self.ledger([row('a', 240000, 400, status='requires_reconciliation',
                                error_type='URLError')], credits=0)
        report = book.run(apply=True)
        self.assertEqual(report['after_cents'], 400)
        self.assertEqual(len(report['unresolved']), 1)
        self.assertNotIn('reconciled_cents', book.read()['requests'][0])

    def test_provider_disagreement_aborts_the_write(self):
        book = self.ledger([row('a', 240000, 400)], credits=999999)
        with self.assertRaises(ValueError):
            book.run(apply=True)
        self.assertNotIn('reconciled_cents', book.read()['requests'][0])

    def test_dry_run_reports_without_writing(self):
        book = self.ledger([row('a', 240000, 400)], credits=4 * reconcile.CREDITS_PER_MINUTE)
        report = book.run()
        self.assertFalse(report['applied'])
        self.assertEqual(report['after_cents'], 60)
        self.assertNotIn('reconciled_cents', book.read()['requests'][0])

    def test_reconciled_rows_free_the_cap_for_new_requests(self):
        book = self.ledger([row(str(n), 240000, 400) for n in range(49)],
                           credits=49 * 4 * reconcile.CREDITS_PER_MINUTE)
        self.assertGreater(paid_music.reserved_total(book.read()), 19000)
        book.run(apply=True)
        self.assertEqual(paid_music.reserved_total(book.read()), 49 * 60)

    def test_ledger_validation_rejects_an_inflated_settlement(self):
        book = self.ledger([row('a', 240000, 400)], credits=4 * reconcile.CREDITS_PER_MINUTE)
        book.run(apply=True)
        ledger = book.read()
        ledger['requests'][0]['reconciled_cents'] = 401
        with self.assertRaises(ValueError):
            paid_music.validate_ledger(ledger)

    def test_ledger_validation_requires_settlement_provenance(self):
        ledger = {'version': 1, 'requests': [row('a', 240000, 400, reconciled_cents=60)]}
        with self.assertRaises(ValueError):
            paid_music.validate_ledger(ledger)

    def test_backup_retains_the_pre_reconciliation_ledger(self):
        book = self.ledger([row('a', 240000, 400)], credits=4 * reconcile.CREDITS_PER_MINUTE)
        report = book.run(apply=True)
        saved = json.loads(Path(report['backup']).read_text('utf-8'))
        self.assertEqual(saved['requests'][0]['reserved_cents'], 400)
        self.assertNotIn('reconciled_cents', saved['requests'][0])


if __name__ == '__main__':
    unittest.main()
