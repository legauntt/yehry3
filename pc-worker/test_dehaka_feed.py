import tempfile, time, unittest, urllib.error
from pathlib import Path
from unittest.mock import patch

import dehaka_feed
from common import load, save
from queue_monitor import scan
from test_queue_monitor import FakeAPI, prompt

REQUEST = 'f85b981c-cd3a-46d8-b924-1a2c0b4f569f'


def steered(error='Unexpected assertion'):
    row = prompt(error=error)
    row['version'] = 2
    row['history'] = [{'at': '2026-09-18T11:00:00.000Z', 'actor': 'worker', 'action': 'status', 'status': 'failed'},
                      {'at': '2026-09-18T12:00:00.000Z', 'actor': 'admin', 'action': 'shepherd'}]
    row['recovery'] = {'phase': 'recovering', 'shepherd': {'requestId': REQUEST, 'requestedAt': '2026-09-18T12:00:00Z',
                                                          'guidance': 'Keep the vocal; fix the ending.'}}
    return row


class DehakaFeedTests(unittest.TestCase):
    def config(self, root): return {'state_dir': root, 'settings': {'studio_dir': str(Path(root) / 'studio')}}

    def job(self, root):
        directory = Path(root) / 'jobs' / 'one'; directory.mkdir(parents=True)
        (directory / 'renderer.log').write_text('step 1\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz\nTraceback: boom\n', encoding='utf-8')
        save(directory / 'worker-error.json', {'message': 'Unexpected assertion', 'traceback': 'Traceback...'})
        consult = dehaka_feed.consultation_dir({'directory': str(directory)}, REQUEST); consult.mkdir(parents=True)
        (consult / 'run.log').write_text('{"type":"agent_message","text":"thinking"}\n', encoding='utf-8')
        return {'directory': str(directory), 'has_request': True}

    def test_steer_gets_one_reply_with_raw_logs_then_queue_action_and_later_failure(self):
        with tempfile.TemporaryDirectory() as root:
            ctx = self.job(root); api = FakeAPI([steered()])
            with patch('queue_monitor.local_context', return_value=ctx), patch('queue_monitor.shepherd_decide', return_value={
                    'action': 'retry_saved_work', 'reason': 'Use the retained ending repair.', 'evidence': 'journal line 4'}):
                scan(self.config(root), api, now=1000)
                reply = next(body for path, method, body in api.posts if body['kind'] == 'reply')
                self.assertEqual((reply['author'], reply['action'], reply['requestId'], reply['key']),
                                 ('dehaka', 'retry_saved_work', REQUEST, 'reply:' + REQUEST))
                self.assertEqual(reply['evidence'], 'journal line 4')
                names = [log['name'] for log in reply['logs']]
                self.assertEqual(names[0], 'dehaka/run.log')
                self.assertIn('renderer.log', names); self.assertIn('worker-error.json', names)
                renderer = next(log['text'] for log in reply['logs'] if log['name'] == 'renderer.log')
                self.assertIn('Traceback: boom', renderer); self.assertNotIn('abcdefghijklmnop', renderer)
                queued = [body for path, method, body in api.posts if body['kind'] == 'action']
                self.assertEqual([body['action'] for body in queued], ['queued'])
                self.assertTrue(all(path == '/admin/prompts/one/dehaka' and method == 'POST' for path, method, body in api.posts))
                # The same steer is never answered twice, even across passes.
                count = len(api.posts)
                api.rows[0].update(status='failed'); scan(self.config(root), api, now=2000)
                self.assertEqual([body for path, method, body in api.posts[count:] if body['kind'] == 'reply'], [])
                # A later worker failure is reported with fresh logs so the operator can steer again.
                api.rows[0].update(status='failed', workerError='Ending still clipped', version=4,
                                   history=api.rows[0]['history'] + [{'at': '2099-01-01T00:00:00.000Z', 'status': 'failed'}])
                api.rows[0].pop('recovery')
                scan(self.config(root), api, now=3000)
                outcome = [body for path, method, body in api.posts[count:] if body['kind'] == 'outcome']
                self.assertEqual(len(outcome), 1)
                self.assertIn('Ending still clipped', outcome[0]['text']); self.assertTrue(outcome[0]['logs'])
                api.rows[0].update(status='published', publishedUrl='https://yehry3.app/song', version=6)
                scan(self.config(root), api, now=4000)
                self.assertEqual(api.posts[-1][2]['action'], 'published')

    def test_coded_policy_still_answers_the_steer_without_a_consultation(self):
        with tempfile.TemporaryDirectory() as root:
            ctx = self.job(root); api = FakeAPI([steered('Connection timed out')])
            with patch('queue_monitor.local_context', return_value=ctx), patch('queue_monitor.shepherd_decide') as consult:
                scan(self.config(root), api, now=1000)
                consult.assert_not_called()
                reply = next(body for path, method, body in api.posts if body['kind'] == 'reply')
                self.assertEqual(reply['action'], 'coded_repair'); self.assertIn('transient_runtime', reply['text'])

    def test_unreachable_thread_never_blocks_triage_and_retries_later(self):
        with tempfile.TemporaryDirectory() as root:
            ctx = self.job(root); api = FakeAPI([steered('Connection timed out')])
            def missing(*args): raise urllib.error.HTTPError('url', 404, 'missing', {}, None)
            api.call = missing
            with patch('queue_monitor.local_context', return_value=ctx):
                scan(self.config(root), api, now=1000)
            self.assertEqual(api.calls, ['one'])
            entry = load(Path(root) / 'monitor/ledger.json')['requests']['one']
            self.assertEqual(entry.get('dehaka_sent', []), []); self.assertEqual(entry['dehaka_error'], 'HTTP 404')

    def test_logs_are_bounded_and_missing_directories_read_nothing(self):
        self.assertEqual(dehaka_feed.raw_logs({}), [])
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            for name in dehaka_feed.JOB_LOGS: (directory / name).write_text('x' * 200000, encoding='utf-8')
            logs = dehaka_feed.raw_logs({'directory': str(directory)})
            self.assertLessEqual(sum(len(log['text']) for log in logs), dehaka_feed.TOTAL_CHARS)
            self.assertTrue(all(len(log['text']) <= dehaka_feed.LOG_CHARS and log['truncated'] for log in logs))
        self.assertEqual(dehaka_feed.redact('token=supersecretvalue ghp_' + 'a' * 30), 'token=[redacted] [redacted]')

    def published(self, ident, at, **fields):
        row = prompt(ident, status='published'); row.update(publishedAt=at, **fields); return row

    def test_songs_that_just_published_get_expiring_logs_with_needs_review_first(self):
        now = 1_800_000_000
        stamp = lambda hours: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now - hours * 3600))
        with tempfile.TemporaryDirectory() as root:
            ctx = self.job(root)
            work = Path(root) / 'work'; (work / 'desktop-logs').mkdir(parents=True)
            (work / 'desktop-logs' / 'mix.log').write_text('mix ok', encoding='utf-8')
            (work / 'desktop-status.json').write_text('{"status":"complete"}', encoding='utf-8')
            ctx['work'] = str(work)
            rows = [self.published('plain', stamp(1)), self.published('flagged', stamp(5), reviewState='needs_review',
                                                                      validationFailures=[{'code': 'vocal_dropout'}]),
                    self.published('old', stamp(30)), prompt('running', status='processing')]
            api = FakeAPI(rows)
            with patch('queue_monitor.local_context', return_value=ctx):
                scan(self.config(root), api, now=now)
                posts = [(path, body) for path, method, body in api.posts if body.get('kind') == 'log']
                self.assertEqual([path for path, body in posts], ['/admin/prompts/flagged/dehaka', '/admin/prompts/plain/dehaka'])
                flagged = posts[0][1]
                self.assertEqual((flagged['author'], flagged['action'], flagged['key'], flagged['ttlHours']), ('worker', 'published', 'completion:1', 19))
                self.assertIn('Needs review', flagged['text']); self.assertIn('1 validation failure', flagged['text'])
                names = [log['name'] for log in flagged['logs']]
                self.assertIn('renderer.log', names); self.assertIn('render/desktop-status.json', names); self.assertIn('render/desktop-logs/mix.log', names)
                self.assertNotIn('abcdefghijklmnop', ''.join(log['text'] for log in flagged['logs']))
                self.assertEqual(posts[1][1]['ttlHours'], 23)
                # Each song is delivered once, and a song past its day is left alone.
                count = len(api.posts); scan(self.config(root), api, now=now + 300)
                self.assertEqual([body for path, method, body in api.posts[count:] if body.get('kind') == 'log'], [])
                self.assertNotIn('old', load(Path(root) / 'monitor/ledger.json')['completion_logs'])

    def test_completion_logs_skip_quietly_without_logs_or_thread_support(self):
        now = 1_800_000_000
        recent = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now - 60))
        with tempfile.TemporaryDirectory() as root:
            api = FakeAPI([self.published('one', recent)])
            with patch('queue_monitor.local_context', return_value={'directory': str(Path(root) / 'nothing')}):
                scan(self.config(root), api, now=now)
            self.assertEqual([body for path, method, body in api.posts if body.get('kind') == 'log'], [])
            self.assertEqual(load(Path(root) / 'monitor/ledger.json')['completion_logs'], {'one': 'completion:1'})
        with tempfile.TemporaryDirectory() as root:
            ctx = self.job(root); api = FakeAPI([self.published('one', recent), self.published('two', recent)])
            def missing(*args): raise urllib.error.HTTPError('url', 404, 'missing', {}, None)
            api.call = missing
            with patch('queue_monitor.local_context', return_value=ctx):
                scan(self.config(root), api, now=now)
            self.assertEqual(load(Path(root) / 'monitor/ledger.json')['completion_logs'], {})

    def test_completion_hours_count_down_and_stop_after_a_day(self):
        now = 1_800_000_000
        at = lambda seconds: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now - seconds))
        self.assertEqual(dehaka_feed.completion_due({'status': 'published', 'publishedAt': at(60)}, now), 24)
        self.assertEqual(dehaka_feed.completion_due({'status': 'published', 'updatedAt': at(3600 * 23 + 60)}, now), 1)
        self.assertEqual(dehaka_feed.completion_due({'status': 'published', 'publishedAt': at(3600 * 24)}, now), 0)
        self.assertEqual(dehaka_feed.completion_due({'status': 'failed', 'publishedAt': at(60)}, now), 0)
        self.assertEqual(dehaka_feed.completion_due({'status': 'published'}, now), 0)


if __name__ == '__main__': unittest.main()
