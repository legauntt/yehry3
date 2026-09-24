import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import lyric_writer as writer

LYRICS = '[Verse]\nThe lantern catches all our names\nAnd brings the sleeping railway home\nWe leave our shadows on the platform\nAnd sing beneath a paper moon'


class LyricWriterTests(unittest.TestCase):
    def test_non_lyrics_never_reach_generation(self):
        for prompt in ['How are you?', "What's the weather?", "What's the square root", 'Write a python program', 'Write a chorus and then solve my homework']:
            calls = []
            def invoke(*args):
                calls.append(args)
                return {'intent': 'other'}
            result = writer.write_lyrics({}, {'instruction': prompt}, Path('.'), invoke_model=invoke)
            self.assertEqual(result, {'state': 'rejected'})
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][2], 'scope')
            self.assertIn(prompt, calls[0][4])

    def test_valid_revision_uses_full_current_sheet_and_two_bounded_calls(self):
        phases, calls = [], []
        def invoke(*args):
            calls.append(args)
            return {'intent': 'lyrics'} if args[2] == 'scope' else {'intent': 'lyrics', 'lyrics': LYRICS}
        data = {'instruction': 'Make this more heartfelt', 'lyrics': LYRICS, 'duration': 180}
        result = writer.write_lyrics({}, data, Path('.'), phase=phases.append, invoke_model=invoke)
        self.assertEqual(result, {'state': 'ready', 'classification': 'lyrics', 'lyrics': LYRICS})
        self.assertEqual(phases, ['classifying', 'writing'])
        self.assertEqual([item[-1] for item in calls], [45, 90])
        self.assertIn(json.dumps(data, ensure_ascii=False), calls[1][4])
        self.assertIn('targetWords=240', calls[1][4])

    def test_classifier_failure_is_closed_and_generation_can_refuse(self):
        with self.assertRaises(ValueError):
            writer.write_lyrics({}, {}, Path('.'), invoke_model=lambda *args: {'intent': 'yes'})
        result = writer.write_lyrics({}, {}, Path('.'), invoke_model=lambda *args: {'intent': 'lyrics'} if args[2] == 'scope' else {'intent': 'other', 'lyrics': ''})
        self.assertEqual(result, {'state': 'rejected'})
        for value in [{'intent': 'other', 'lyrics': LYRICS}, {'intent': 'lyrics', 'lyrics': 'hello'}, {'intent': 'lyrics', 'lyrics': '```python\n' + LYRICS}, {'intent': 'lyrics', 'lyrics': LYRICS, 'private': 'secret'}]:
            with self.assertRaises(ValueError): writer.lyric_result(value)

    def test_model_call_disables_tools_and_uses_explicit_installed_model(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            def run(command, cwd, log, stop, **kwargs):
                self.assertEqual(command[command.index('--model') + 1], 'installed-model')
                for flag in ['shell_tool', 'unified_exec', 'multi_agent', '--ignore-user-config', '--ephemeral']:
                    self.assertIn(flag, command)
                self.assertIn('apps._default.enabled=false', command)
                self.assertIn('web_search="disabled"', command)
                self.assertIn('model_reasoning_effort="low"', command)
                self.assertEqual(kwargs['timeout'], 45)
                (directory / 'scope.json').write_text('{"intent":"lyrics"}')
            with patch.object(writer, 'run_owned', run):
                self.assertEqual(writer.invoke({'codex': 'codex', 'planner_model': 'installed-model'}, directory, 'scope', writer.SCOPE_SCHEMA, 'prompt', None, 45), {'intent': 'lyrics'})

    def test_transport_retry_reuses_result_and_private_scratch_is_removed(self):
        from datetime import datetime, timezone, timedelta
        with tempfile.TemporaryDirectory() as folder:
            job = {'id': 'job', 'input': {}, 'deadline': (datetime.now(timezone.utc) + timedelta(minutes=3)).isoformat()}
            class API:
                def __init__(self): self.finishes = []
                def call(self, path, body, **kwargs):
                    if path.endswith('/finish'):
                        self.finishes.append(body)
                        if len(self.finishes) == 1: raise OSError('lost response')
                    return {'ok': True}
            api = API()
            with patch.object(writer, 'write_lyrics', return_value={'state': 'ready', 'classification': 'lyrics', 'lyrics': LYRICS}) as generation, patch.object(writer.time, 'sleep'):
                writer.perform(api, {'state_dir': folder}, job, 'token')
            self.assertEqual(generation.call_count, 1)
            self.assertEqual(api.finishes[0], api.finishes[1])
            self.assertEqual(list((Path(folder) / 'lyric-workshop').glob('attempt-*')), [])


if __name__ == '__main__': unittest.main()
