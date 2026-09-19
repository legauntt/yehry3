import copy, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

from common import fingerprint, load, save
from planner import make_plan, normalize, validate, invocation_feedback
from plan_schema import KEYS, SCHEMA
from winprocess import Stopped


def fixture():
    return {'recipe': 'new', 'title': 'Room for Chris-R', 'style': 'rock',
            'duration': 270, 'bpm': 84, 'keyscale': 'C# minor',
            'lyrics': '[Verse]\n' + 'A rose upon the stairway, a knock upon the door.\n' * 8 + '[End]',
            'arrangement': 'Electric piano and melodic bass with muted funk guitar and dramatic ensemble stops. Resolve with a final chord and natural decay.',
            'preserve_generated_backing': True, 'explanation': 'An original R&B melodrama.', 'fear_hunger': False}


class PlannerTests(unittest.TestCase):
    def run_feedback_case(self, root, outputs):
        (root / 'PREFERENCES.md').write_text('Use Tony V6.')
        config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
        brief = {'prompt': 'A Room melodrama', 'details': {}}
        calls = []
        def model(command, *args, **kwargs):
            calls.append(kwargs['input_text'])
            value = outputs[min(len(calls) - 1, len(outputs) - 1)]
            if isinstance(value, Exception): raise value
            path = Path(command[command.index('--output-last-message') + 1])
            if isinstance(value, str): path.write_text(value)
            else: save(path, value)
        return config, brief, calls, patch('planner.run_owned', side_effect=model)

    def test_three_turn_feedback_corrects_json_then_semantic_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, calls, mocked = self.run_feedback_case(root, ['{broken', {**fixture(), 'keyscale': 'H minor'}, fixture()])
            with mocked:
                self.assertEqual(make_plan(config, brief, root, []), fixture())
                (root / 'plan.json').unlink()  # Lost final cache write after the third output.
                self.assertEqual(make_plan(config, brief, root, []), fixture())
            self.assertEqual(len(calls), 3)
            self.assertIn('Expecting property name', calls[1])
            self.assertIn('Invalid keyscale', calls[2])
            self.assertIn('H minor', calls[2])
            self.assertEqual((root / 'planner-result.json').read_text(), '{broken')
            self.assertEqual(load(root / 'planner-result-attempt-2.json')['keyscale'], 'H minor')
            self.assertEqual([a['status'] for a in load(root / 'planner-result-attempts.json')['attempts']], ['invalid', 'invalid', 'accepted'])

    def test_failed_budget_survives_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, calls, mocked = self.run_feedback_case(root, [{**fixture(), 'bpm': 999}])
            with mocked:
                for _ in range(2):
                    with self.assertRaisesRegex(ValueError, 'after 3 attempts.*Invalid bpm'):
                        make_plan(config, brief, root, [])
            self.assertEqual(len(calls), 3)
            self.assertFalse((root / 'plan.json').exists())

    def test_invocation_failure_is_feedback_and_cancel_is_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, calls, mocked = self.run_feedback_case(root, [RuntimeError('Invalid schema response'), fixture()])
            with mocked: self.assertEqual(make_plan(config, brief, root, []), fixture())
            self.assertEqual(len(calls), 2)
            self.assertIn('Invalid schema response', calls[1])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, calls, mocked = self.run_feedback_case(root, [Stopped('Canceled')])
            with mocked, self.assertRaises(Stopped): make_plan(config, brief, root, [])
            self.assertEqual(len(calls), 1)

    def test_retained_bad_output_uses_only_two_more_attempts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, calls, mocked = self.run_feedback_case(root, [{**fixture(), 'duration': 1141}, fixture()])
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief)})
            save(root / 'planner-result.json', {**fixture(), 'keyscale': 'H minor'})
            with mocked: self.assertEqual(make_plan(config, brief, root, []), fixture())
            self.assertEqual(len(calls), 2)
            self.assertIn('Invalid keyscale', calls[0])
            self.assertIn('Invalid duration', calls[1])

    def test_feedback_uses_cli_errors_without_forwarding_other_log_events(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'planner.log'
            log.write_text('{"type":"thread.started","thread_id":"private-thread"}\n'
                           '{"type":"turn.failed","error":{"message":"Invalid schema: keyscale needs enum"}}\n')
            feedback = invocation_feedback(RuntimeError('Operation failed'), log)
            self.assertIn('keyscale needs enum', feedback)
            self.assertNotIn('private-thread', feedback)

    def test_started_audio_without_plan_cannot_trigger_new_planning(self):
        with tempfile.TemporaryDirectory() as directory, patch('planner.run_owned') as model:
            root = Path(directory); save(root / 'render-request.json', {'frozen': True})
            with self.assertRaisesRegex(ValueError, 'Restore the saved plan'):
                make_plan({}, {'prompt': 'Saved song', 'details': {}}, root, [])
            model.assert_not_called()

    def test_equivalent_keys_preserve_musical_meaning(self):
        cases = {'C-sharp minor': 'C# minor', 'c sharp MINOR': 'C# minor',
                 'C♯ minor': 'C# minor', 'C–sharp minor': 'C# minor', ' c#m ': 'C# minor',
                 'B-flat major': 'Bb major', 'B♭ maj': 'Bb major', 'bb major': 'Bb major',
                 'F#M': 'F# major', 'F#min': 'F# minor', 'a minor': 'A minor'}
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                source = {**fixture(), 'keyscale': raw}
                result = validate(normalize(source), [])
                self.assertEqual(result['keyscale'], expected)
                self.assertEqual(source['keyscale'], raw)
                self.assertEqual(result['lyrics'], source['lyrics'])
                self.assertEqual(result['arrangement'], source['arrangement'])
        for key in KEYS:
            self.assertEqual(validate(normalize({**fixture(), 'keyscale': key}), [])['keyscale'], key)

    def test_unambiguous_scalar_formatting_only(self):
        result = validate(normalize({**fixture(), 'style': ' ROCK ', 'recipe': ' New ',
                                     'bpm': '84.0', 'duration': 270.0}), [])
        self.assertEqual(result, fixture())
        for field, values in {'keyscale': ['C', 'C dorian', 'H minor', 'C## minor', 'C major or A minor', None, []],
                              'style': ['R&B', '', None], 'bpm': [True, 'fast', '84.5', 44, 221],
                              'duration': [True, '4:30', 119, 1141]}.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    with self.assertRaisesRegex(ValueError, field):
                        validate(normalize({**fixture(), field: value}), [])

    def test_schema_constrains_music_settings(self):
        properties = SCHEMA['properties']
        self.assertIn('C# minor', properties['keyscale']['enum'])
        self.assertNotIn('C-sharp minor', properties['keyscale']['enum'])
        self.assertEqual(properties['bpm']['minimum'], 45)
        self.assertEqual(properties['bpm']['maximum'], 220)
        self.assertEqual(properties['duration']['minimum'], 120)
        self.assertEqual(properties['duration']['maximum'], 1140)
        self.assertFalse(SCHEMA['additionalProperties'])

    def test_saved_failed_output_recovers_without_model_or_rewriting_original(self):
        with tempfile.TemporaryDirectory() as directory, patch('planner.run_owned') as model:
            root = Path(directory); brief = {'prompt': 'A Room melodrama', 'details': {}}
            raw = {**fixture(), 'keyscale': 'C-sharp minor'}
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief)})
            save(root / 'planner-result.json', raw)
            before = (root / 'planner-result.json').read_bytes()
            result = make_plan({'planner_model': 'test'}, brief, root, [])
            self.assertEqual(result, fixture())
            self.assertEqual((root / 'planner-result.json').read_bytes(), before)
            self.assertEqual(load(root / 'plan.json')['plan'], fixture())
            self.assertEqual(make_plan({'planner_model': 'test'}, brief, root, []), fixture())
            model.assert_not_called()

    def test_cached_started_plan_is_never_normalized_or_rewritten(self):
        with tempfile.TemporaryDirectory() as directory, patch('planner.run_owned') as model:
            root = Path(directory); brief = {'prompt': 'Saved song', 'details': {}}
            saved = copy.deepcopy(fixture()); saved.pop('fear_hunger')
            save(root / 'plan.json', {'briefHash': fingerprint(brief), 'plan': saved})
            save(root / 'render-request.json', {'frozen': True})
            before = (root / 'plan.json').read_bytes()
            self.assertEqual(make_plan({}, brief, root, []), saved)
            self.assertEqual((root / 'plan.json').read_bytes(), before)
            with self.assertRaisesRegex(ValueError, 'different brief'):
                make_plan({}, {**brief, 'prompt': 'Changed'}, root, [])
            model.assert_not_called()


if __name__ == '__main__': unittest.main()
