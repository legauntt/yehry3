import runpy
import hashlib
from pathlib import Path
import unittest

public_costs = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/sync-song-costs.py'))['public_costs']
song_id = lambda name: 'distonyc-' + hashlib.sha256(name.encode()).hexdigest()[:24]


def row(id, **changes):
    return dict(id=id, status='completed', reserved_cents=400, reconciled_cents=60,
                reconciled_at='2026-09-23T00:00:00Z', reconciled_basis='provider history', **changes)


class ExportTests(unittest.TestCase):
    def test_only_completed_public_paid_settlements_leave_the_ledger(self):
        rows = [row(name) for name in ['paid', 'local', 'unpublished', 'pending', 'unfinished']]
        rows[0]['private_note'] = 'must stay private'
        rows[3].pop('reconciled_cents')
        rows[4]['status'] = 'sending'
        catalog = {'songs': [{'id': song_id(name), 'musicBackend': backend} for name, backend in
                            [('paid', 'eleven_music'), ('local', 'local'), ('pending', 'eleven_music'), ('unfinished', 'eleven_music')]]}
        self.assertEqual(public_costs(catalog, {'version': 1, 'requests': rows}), {song_id('paid'): 60})

    def test_retry_settlement_is_included_but_a_pending_retry_is_not_a_charge(self):
        original = row('paid', request_hash='same')
        original['reconciled_cents'] = 0
        original['operator_retry'] = {**row('retry'), 'version': 1, 'status': 'consumed', 'request_hash': 'same'}
        catalog = {'songs': [{'id': song_id('paid'), 'musicBackend': 'eleven_music'}]}
        ledger = {'version': 1, 'requests': [original]}
        self.assertEqual(public_costs(catalog, ledger), {song_id('paid'): 60})
        del original['operator_retry']['reconciled_cents']
        self.assertEqual(public_costs(catalog, ledger), {})


if __name__ == '__main__':
    unittest.main()
