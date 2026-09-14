import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from common import fingerprint, load, save
from planner import make_plan
from request_materials import planning_brief, validate_materials, plan_materials
from winprocess import Stopped

TEXT = '[Verse 1]\nThe lantern catches all our names\nAnd brings the sleeping railway home\nWe keep the light until the morning comes\n'
def plan(text=TEXT):
    return {'recipe': 'new', 'title': 'Lantern Railway', 'style': 'rock', 'duration': 240, 'bpm': 100,
            'keyscale': 'D minor', 'lyrics': text + '\n[End]',
            'arrangement': 'Expressive Tony singing over a warm bass groove and drums with a complete final verse, resolved chord and natural decay.',
            'preserve_generated_backing': True, 'explanation': 'A new song using the submitted sheet.', 'fear_hunger': False}
def brief(mode='preserve'):
    return {'prompt': 'A railway song', 'details': {'lyricSheet': {'text': TEXT, 'mode': mode}, 'direction': 'Warm rock',
            'references': [{'url': 'https://example.org/song', 'purpose': 'creative', 'note': 'Borrow the gentle groove',
                            'snapshot': {'kind': 'metadata', 'status': 'ready', 'title': 'A song', 'text': 'Title and channel only'}}]}}

class MaterialTests(unittest.TestCase):
    def test_preservation_allows_formatting_but_not_changed_or_missing_words(self):
        self.assertEqual(validate_materials(plan(), brief())['recipe'], 'new')
        fixed = plan(TEXT.replace('[Verse 1]', '[Chorus]').replace(' ', '\n'))
        self.assertEqual(validate_materials(fixed, brief()), fixed)
        for lyrics in [TEXT.replace('lantern', 'candle'), TEXT + 'Extra words', TEXT.replace('all our names', 'our names all'), TEXT.replace('morning comes', '')]:
            with self.assertRaisesRegex(ValueError, 'Keep my wording'): validate_materials(plan(lyrics), brief())
        self.assertEqual(validate_materials(plan('A different set of words'), brief('adapt'))['recipe'], 'new')
        with self.assertRaisesRegex(ValueError, 'faithful'): validate_materials({**plan(), 'recipe': 'remix'}, brief())
    def test_long_preserved_lyrics_require_supported_pacing(self):
        value = brief(); value['details']['lyricSheet']['text'] = 'words ' * 500
        with self.assertRaisesRegex(ValueError, 'duration'): validate_materials(plan('words ' * 500), value)
        self.assertEqual(validate_materials({**plan('words ' * 500), 'duration': 300}, value)['duration'], 300)
    def test_import_provenance_does_not_duplicate_lyrics_or_inject_operational_fields(self):
        value = brief(); value['details']['references'][0].update(purpose='lyrics', snapshotId='private')
        value['details']['references'][0]['snapshot']['text'] = 'Unreviewed source text'
        sanitized = planning_brief(value)
        self.assertNotIn('Unreviewed', json.dumps(sanitized)); self.assertNotIn('snapshotId', json.dumps(sanitized))
        self.assertEqual(sanitized['details']['lyricSheet']['text'], TEXT)
    def test_planning_corrects_once_and_reuses_the_same_frozen_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); studio = root / 'studio'; studio.mkdir()
            (studio / 'PREFERENCES.md').write_text('Use the saved Tony voice.')
            config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(studio)}}
            calls = []
            def run(command, cwd, log, stop, **kwargs):
                calls.append(kwargs['input_text'])
                target = command[command.index('--output-last-message') + 1]
                save(target, plan(TEXT.replace('lantern', 'candle')) if len(calls) == 1 else plan())
            with patch('planner.run_owned', side_effect=run):
                result = make_plan(config, brief(), root, [])
                self.assertEqual(result['lyrics'], plan()['lyrics'])
                self.assertEqual(len(calls), 2)
                self.assertIn('Keep my wording', calls[1])
                self.assertIn('Never claim to have listened', calls[0])
                self.assertEqual(make_plan(config, brief(), root, []), result)
                self.assertEqual(len(calls), 2)
                changed = brief(); changed['details']['lyricSheet']['text'] += ' Changed'
                with self.assertRaisesRegex(ValueError, 'different brief'): make_plan(config, changed, root, [])
    def test_budget_is_durable_and_cancellation_does_not_restart_a_model_call(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); output = root / 'out.json'; command = ['codex', '--output-last-message', str(output)]
            calls = []
            def run(command, *args, **kwargs):
                calls.append(command); save(command[-1], {'bad': True})
            def check(value): raise ValueError('Restore missing lyrics')
            for _ in range(2):
                with self.assertRaisesRegex(ValueError, 'three-attempt'):
                    plan_materials(command, root, output, 'instructions', 'hash', check, run)
            self.assertEqual(len(calls), 3)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(Stopped):
                plan_materials(command, directory, output, 'instructions', 'hash', check, run, lambda: True)
            self.assertFalse((Path(directory) / 'material-planning-attempts.json').exists())
    def test_lost_response_recovers_accepted_output_without_spending_another_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); output = root / 'out.json'
            save(output, plan())
            save(root / 'material-planning-attempts.json', {'briefHash': 'hash', 'attempts': [{'output': 'out.json', 'status': 'started'}]})
            with patch('planner.run_owned') as run:
                result = plan_materials(['codex', '--output-last-message', str(output)], root, output, '', 'hash', lambda value: validate_materials(value, brief()), run)
                self.assertEqual(result, plan()); run.assert_not_called()

if __name__ == '__main__': unittest.main()
