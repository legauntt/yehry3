import copy, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

from common import load, save
from queue_monitor import scan
from replan import directive, prepare, refusal

STEER = 'f85b981c-cd3a-46d8-b924-1a2c0b4f569f'
REFUSED = 'Needs attention: a faithful cover requires selected or retained source material and lyrics, but none were supplied.'


def refused_job(root):
    job = Path(root) / 'jobs' / 'one'; job.mkdir(parents=True)
    for name in ('plan.json', 'planning-input.json', 'planner-result.json', 'planner-result-attempts.json'): save(job / name, {'old': name})
    (job / 'planner.log').write_text('refused', encoding='utf-8')
    save(job / 'worker-error.json', {'message': REFUSED})
    return job


class FakeAPI:
    def __init__(self, rows): self.rows = rows; self.calls = []; self.posts = []; self.refuse = None
    def prompts(self): return copy.deepcopy(self.rows)
    def call(self, path, method='GET', body=None): self.posts.append(copy.deepcopy(body)); return {'entry': {}}
    def retry(self, prompt):
        if self.refuse:
            import urllib.error
            code, self.refuse = self.refuse, None
            raise urllib.error.HTTPError('https://example.test', code, 'busy', {}, None)
        self.calls.append(prompt['id'])
        target = self.rows[0]; target.update(status='queued', version=target['version'] + 1); target.pop('recovery', None)
        return copy.deepcopy(target)


def steered(request=STEER):
    return {'id': 'one', 'prompt': 'Tony covers a named song', 'status': 'failed', 'workerError': REFUSED, 'workerActive': False, 'version': 4,
            'recovery': {'phase': 'recovering', 'shepherd': {'requestId': request, 'requestedAt': '2026-09-20T20:15:00Z',
                                                              'guidance': 'Fetch the lyrics and move past the faithful gate.'}}}


DECISION = {'action': 'replan', 'reason': 'The words are retrievable.', 'evidence': 'worker-error.json',
            'planning_note': 'Treat it as a loose cover set to new music.', 'cover_artist': 'The Tide Pools', 'cover_title': 'Harbor Lantern'}


class ReplanTests(unittest.TestCase):
    def test_archive_keeps_every_refused_file_and_leaves_one_directive(self):
        with tempfile.TemporaryDirectory() as root:
            job = refused_job(root)
            row = prepare(job, STEER, True, 'Loose cover.  New music.', {'artist': 'The Tide Pools', 'title': 'Harbor Lantern'})
            self.assertEqual(row['number'], 1)
            self.assertFalse((job / 'plan.json').exists()); self.assertFalse((job / 'planner-result.json').exists())
            self.assertEqual(load(job / 'replans/1/plan.json'), {'old': 'plan.json'})
            self.assertTrue((job / 'worker-error.json').exists(), 'failure evidence stays in place')
            self.assertEqual(directive(job)['note'], 'Loose cover. New music.')
            self.assertEqual(directive(job)['cover'], {'artist': 'The Tide Pools', 'title': 'Harbor Lantern'})
            # The same steer never archives twice, even after the worker writes a new plan.
            save(job / 'plan.json', {'new': True})
            self.assertEqual(prepare(job, STEER, True)['number'], 1)
            self.assertEqual(load(job / 'plan.json'), {'new': True})

    def test_started_audio_and_spent_budgets_refuse(self):
        with tempfile.TemporaryDirectory() as root:
            job = refused_job(root); save(job / 'render-request.json', {})
            self.assertIn('Audio production', refusal(job, True))
            with self.assertRaises(ValueError): prepare(job, STEER, True)
            self.assertTrue((job / 'plan.json').exists())
        with tempfile.TemporaryDirectory() as root:
            job = refused_job(root)
            prepare(job, 'automatic', False, 'An unauthenticated note is dropped')
            self.assertEqual(directive(job)['note'], '')
            self.assertIn('used its 1', refusal(job, False))
            self.assertIsNone(refusal(job, True), 'an operator steer still has passes left')

    def test_interrupted_archive_is_finished_by_the_next_planning_pass(self):
        with tempfile.TemporaryDirectory() as root:
            job = refused_job(root)
            with patch('replan.finish'): prepare(job, STEER, True, 'Loose cover.')
            self.assertTrue((job / 'plan.json').exists())
            self.assertEqual(directive(job)['note'], 'Loose cover.')
            self.assertFalse((job / 'plan.json').exists())

    def test_dehaka_replan_archives_requeues_once_and_reports_the_direction(self):
        with tempfile.TemporaryDirectory() as root:
            job = refused_job(root); cfg = {'state_dir': root, 'settings': {'studio_dir': str(Path(root) / 'studio')}}
            api = FakeAPI([steered()])
            with patch('queue_monitor.shepherd_decide', return_value=dict(DECISION)) as consult:
                scan(cfg, api, now=1000)
                self.assertEqual(api.calls, ['one']); consult.assert_called_once()
                self.assertEqual(directive(job)['cover']['title'], 'Harbor Lantern')
                reply = next(body for body in api.posts if body.get('action') == 'replan')
                self.assertIn('Harbor Lantern', reply['text']); self.assertIn('loose cover', reply['text'])
                attempt = load(Path(root) / 'monitor/ledger.json')['requests']['one']['attempts'][0]
                self.assertEqual((attempt['category'], attempt['steer']), ('replan', STEER))

    def test_a_full_queue_does_not_strand_the_archived_replan(self):
        with tempfile.TemporaryDirectory() as root:
            job = refused_job(root); cfg = {'state_dir': root, 'settings': {'studio_dir': str(Path(root) / 'studio')}}
            api = FakeAPI([steered()]); api.refuse = 429
            with patch('queue_monitor.shepherd_decide', return_value=dict(DECISION)) as consult:
                scan(cfg, api, now=1000)
                self.assertEqual(api.calls, []); self.assertFalse((job / 'plan.json').exists())
                # The refused plan is already archived, so ordinary eligibility is gone; the ledger finishes the steer.
                scan(cfg, api, now=1300)
                self.assertEqual(api.calls, ['one']); consult.assert_called_once()
                self.assertEqual(len(load(job / 'replans/journal.json')['replans']), 1)

    def test_each_steer_acts_once_even_after_the_automatic_budget_is_spent(self):
        with tempfile.TemporaryDirectory() as root:
            refused_job(root); cfg = {'state_dir': root, 'settings': {'studio_dir': str(Path(root) / 'studio')}}
            spent = [{'at_epoch': 1, 'at': '2026-09-20T00:00:00Z', 'category': 'transient_runtime', 'signature': 'x', 'policy_version': 4}] * 3
            save(Path(root) / 'monitor/ledger.json', {'version': 1, 'history': [], 'requests': {'one': {'first_seen': 'x', 'attempts': spent}}})
            api = FakeAPI([steered()])
            with patch('queue_monitor.shepherd_decide', return_value={'action': 'retry_saved_work', 'reason': 'Retry.', 'evidence': 'log'}):
                scan(cfg, api, now=1000)
                self.assertEqual(api.calls, ['one'], 'a human steer is not silenced by the automatic budget')
                api.rows[0] = {**steered(), 'version': 5}; scan(cfg, api, now=1001)
                self.assertEqual(api.calls, ['one'], 'the same steer never acts twice')


if __name__ == '__main__': unittest.main()
