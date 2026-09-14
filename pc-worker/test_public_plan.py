import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from common import save
from public_plan import public_plan
from backfill_plans import candidates
from worker import run_once
from publish import song_record


PLAN = dict(title='Saved song', recipe='new', style='rock', duration=200, bpm=100,
            keyscale='D minor', arrangement='A gentle verse and a full chorus.', lyrics='A line',
            explanation='PRIVATE notes', adminNote='PRIVATE', localPath='C:/PRIVATE',
            movements=[dict(duration=200, arrangement='Movement', lyrics='A line', secret='PRIVATE')])


class PublicPlanTests(unittest.TestCase):
    def test_backfill_requires_matching_recording_and_frozen_plan(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / 'saved-request'; directory.mkdir()
            identifier = 'distonyc-' + hashlib.sha256(directory.name.encode()).hexdigest()[:24]
            url = f'https://github.com/legauntt/yehry3/releases/download/distonyc-v1/{identifier}-aaaaaaaaaaaa.mp3'
            song = dict(id=identifier, title=PLAN['title'], url=url)
            save(directory / 'prompt.json', dict(id=directory.name, songId=identifier))
            save(directory / 'plan.json', dict(plan=PLAN))
            save(directory / 'render-request.json', dict(plan=PLAN))
            save(directory / 'render-result.json', dict(status='verified', files=[dict(path='song.mp3', sha256='a' * 64)]))
            self.assertEqual(len(candidates(dict(songs=[song]), temp)[0]), 1)
            self.assertEqual(candidates(dict(songs=[{**song, 'url': 'https://example.com/other.mp3'}]), temp)[0], [])
            save(directory / 'render-request.json', dict(plan={**PLAN, 'arrangement': 'Changed'}))
            self.assertEqual(candidates(dict(songs=[song]), temp)[0], [])

    def test_projects_only_musical_fields_without_changing_saved_inputs(self):
        before = copy.deepcopy(PLAN)
        result = public_plan(PLAN)
        self.assertNotIn('PRIVATE', str(result))
        self.assertEqual(PLAN, before)
        self.assertEqual(result['movements'][0], dict(duration=200, arrangement='Movement', lyrics='A line'))
        prompt = dict(songId='song', releaseUrl='https://example.com/a.mp3', result=dict(title='Song', duration=200), songPlan=result)
        self.assertEqual(song_record(prompt)['songPlan'], result)

    def test_persists_plan_before_render_and_reuses_it_after_lost_response(self):
        with tempfile.TemporaryDirectory() as temp:
            config = dict(state_dir=temp, settings=dict(python='unused'))
            prompt = dict(id='request', status='processing', details={}, prompt='An idea')
            events = []
            class API:
                def call(self, path, body=None, timeout=25):
                    if path.endswith('/plan'):
                        events.append('plan')
                        prompt['songPlan'] = body['songPlan']
                        if len(events) == 1:
                            raise OSError('lost response')
                    return dict(prompt=dict(prompt))
            def render(*args, **kwargs):
                events.append('render')
                self.assertEqual(prompt['songPlan'], public_plan(PLAN))
                raise OSError('stop before real render')
            with patch('worker.basis_files', return_value=[]), patch('worker.make_plan', return_value=PLAN), patch('worker.run_owned', side_effect=render):
                with self.assertRaisesRegex(OSError, 'lost response'):
                    run_once(config, API())
                self.assertEqual(events, ['plan'])
                with self.assertRaisesRegex(OSError, 'stop before real render'):
                    run_once(config, API())
            self.assertEqual(events, ['plan', 'plan', 'render'])


if __name__ == '__main__':
    unittest.main()
