import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import fingerprint, load, save
from planner import make_plan
from request_materials import (normalize_material_plan, validate_materials, words, duration_suggestion,
                               render_brief, stock_chants_authorized)
from test_planner import fixture
from winprocess import Stopped


class RequestMaterialsTests(unittest.TestCase):
    def setup_case(self, root):
        (root / 'PREFERENCES.md').write_text('Use the selected saved Tony voice.', encoding='utf-8')
        plan = fixture()
        plan['lyrics'] = ('[Verse 1]\nA lantern lights the doorway, a shadow crosses snow.\n'
                          '[Turn]\nWe carry all our stories wherever we may go.\n'
                          '[Final Chorus]\nBring the lantern home, and let the river flow.\n[End]')
        sheet = ('A lantern lights the doorway, a shadow crosses snow.\n'
                 'We carry all our stories wherever we may go.\n'
                 'Bring the lantern home, and let the river flow.')
        brief = {'prompt': 'A winter song', 'details': {'voiceModel': 'v7',
                 'lyricSheet': {'text': sheet, 'mode': 'preserve'}, 'references': []}}
        config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
        return config, brief, plan

    def test_aliases_pass_on_first_call_and_raw_output_is_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, raw = self.setup_case(root)
            original = copy.deepcopy(raw)
            def run(command, *args, **kwargs):
                self.assertIn('Use standalone labels', kwargs['input_text'])
                save(Path(command[command.index('--output-last-message') + 1]), raw)
            with patch('planner.run_owned', side_effect=run) as model:
                result = make_plan(config, brief, root, [])
            model.assert_called_once()
            self.assertIn('[Bridge]', result['lyrics'])
            self.assertIn('[Chorus]', result['lyrics'])
            self.assertNotIn('[Turn]', result['lyrics'])
            self.assertEqual(words(result['lyrics']), words(brief['details']['lyricSheet']['text']))
            self.assertEqual(load(root / 'planner-result.json'), original)
            self.assertEqual(raw, original)
            self.assertEqual(load(root / 'material-planning-attempts.json')['attempts'][0]['status'], 'accepted')

    def test_exhausted_saved_outputs_recover_without_model_or_budget_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, raw = self.setup_case(root)
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief), 'brief': brief})
            attempts = []
            for name in ('planner-result.json', 'planner-result-material-2.json', 'planner-result-material-3.json'):
                save(root / name, raw)
                attempts.append({'output': name, 'status': 'rejected', 'error': 'Keep my wording: original failure'})
            save(root / 'material-planning-attempts.json', {'briefHash': fingerprint(brief), 'attempts': attempts})
            retained = {p.name: p.read_bytes() for p in root.glob('*.json')}
            with patch('planner.run_owned') as model:
                result = make_plan(config, brief, root, [])
                self.assertEqual(make_plan(config, brief, root, []), result)
            model.assert_not_called()
            # The brief snapshot may be rewritten equivalently by make_plan;
            # original outputs and consumed attempts stay byte-for-byte intact.
            for name, before in retained.items():
                if name != 'planning-input.json': self.assertEqual((root / name).read_bytes(), before)
            self.assertEqual(len(load(root / 'material-planning-attempts.json')['attempts']), 3)

    def test_genuine_word_changes_keep_three_attempt_limit_and_precise_feedback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, raw = self.setup_case(root)
            raw['lyrics'] = raw['lyrics'].replace('lantern', 'candle', 1)
            feedback = []
            def run(command, *args, **kwargs):
                feedback.append(kwargs['input_text'])
                save(Path(command[command.index('--output-last-message') + 1]), raw)
            with patch('planner.run_owned', side_effect=run) as model:
                for _ in range(2):
                    with self.assertRaisesRegex(ValueError, "three-attempt limit.*word 2: expected 'lantern'; received 'candle'"):
                        make_plan(config, brief, root, [])
            self.assertEqual(model.call_count, 3)
            self.assertIn("expected 'lantern'; received 'candle'", feedback[1])
            self.assertFalse((root / 'plan.json').exists())

    def test_no_arbitrary_bracketed_or_inline_lyrics_are_hidden(self):
        brief = {'details': {'lyricSheet': {'text': 'Bring the lantern home.', 'mode': 'preserve'}}}
        for lyrics in ('Bring the lantern home.\n[These are extra words]',
                       'Bring the [Final Chorus] lantern home.',
                       'Bring the lantern home.\n[Chorus: repeat twice]',
                       'Bring the lantern home.\nBring the lantern home.',
                       'Bring the lantern home', 'Bring the home.'):
            with self.subTest(lyrics=lyrics), self.assertRaisesRegex(ValueError, 'first mismatch at word'):
                validate_materials({'recipe': 'new', 'duration': 120, 'lyrics': lyrics}, brief)
        with self.assertRaisesRegex(ValueError, r"Unsupported section label '\[Big finish\]'"):
            validate_materials({'recipe': 'new', 'duration': 120, 'lyrics': 'Bring the lantern home.\n[Big finish]'}, brief)
        text = '[These are sung words]\nBring the lantern home.'
        plan = {'recipe': 'new', 'duration': 120, 'lyrics': text}
        self.assertEqual(validate_materials(plan, {'details': {'lyricSheet': {'text': text}}}), plan)

    def test_supplied_aliases_whitespace_and_movement_labels(self):
        supplied = '[ FINAL   CHORUS ]\r\nBring the lantern home.\r\n[Pre Chorus]\r\nAgain.'
        brief = {'details': {'lyricSheet': {'text': supplied}}}
        plan = {'recipe': 'new', 'duration': 120, 'lyrics': '[Chorus]\nBring the lantern home.\n[Pre-Chorus]\nAgain.'}
        self.assertEqual(validate_materials(plan, brief), plan)
        raw = {'movements': [{'lyrics': '[Turn]\nOne line.\n[Final Chorus]\nAnother.'}]}
        result = normalize_material_plan(raw)
        self.assertIn('[Bridge]', result['movements'][0]['lyrics'])
        self.assertIn('[Turn]', raw['movements'][0]['lyrics'])

    def test_valid_output_after_lost_response_spends_only_one_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, raw = self.setup_case(root)
            def run(command, *args, **kwargs):
                save(Path(command[command.index('--output-last-message') + 1]), raw)
                raise RuntimeError('Lost planner response')
            with patch('planner.run_owned', side_effect=run) as model:
                self.assertIn('[Bridge]', make_plan(config, brief, root, [])['lyrics'])
            model.assert_called_once()
            attempts = load(root / 'material-planning-attempts.json')['attempts']
            self.assertEqual(len(attempts), 1)
            self.assertEqual(attempts[0]['status'], 'accepted')
            self.assertEqual(attempts[0]['invocationError'], 'Lost planner response')

    def test_cancellation_keeps_output_but_does_not_accept_or_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, raw = self.setup_case(root)
            canceled = False
            def run(command, *args, **kwargs):
                nonlocal canceled
                save(Path(command[command.index('--output-last-message') + 1]), raw)
                canceled = True
            with patch('planner.run_owned', side_effect=run) as model, self.assertRaises(Stopped):
                make_plan(config, brief, root, [], stop=lambda: canceled)
            model.assert_called_once()
            self.assertTrue((root / 'planner-result.json').exists())
            self.assertFalse((root / 'plan.json').exists())

    def test_started_plan_and_changed_brief_remain_protected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config, brief, raw = self.setup_case(root)
            save(root / 'plan.json', {'briefHash': fingerprint(brief), 'plan': raw})
            save(root / 'render-request.json', {'plan': raw, 'frozen': True})
            before = {name: (root / name).read_bytes() for name in ('plan.json', 'render-request.json')}
            with patch('planner.run_owned') as model:
                self.assertEqual(make_plan(config, brief, root, []), raw)
                with self.assertRaisesRegex(ValueError, 'different brief'):
                    make_plan(config, {**brief, 'prompt': 'Changed'}, root, [])
            model.assert_not_called()
            for name, data in before.items(): self.assertEqual((root / name).read_bytes(), data)

    def test_stock_chants_require_matching_explicit_frozen_words(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            song = fixture()
            song['lyrics'] = '[Verse]\nWoah, slow down\nLet it roll\n[End]'
            brief = {'prompt': 'A late-night remix', 'details': {'direction': 'Tony may say "woah" deliberately.'}}
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief), 'brief': brief})
            save(root / 'plan.json', {'briefHash': fingerprint(brief), 'plan': song})
            request = {'directory': str(root), 'plan': song}
            self.assertFalse(stock_chants_authorized(request))
            brief['details']['direction'] += ' Also use "let it roll" as a requested hook.'
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief), 'brief': brief})
            save(root / 'plan.json', {'briefHash': fingerprint(brief), 'plan': song})
            self.assertTrue(stock_chants_authorized(request))

    def test_submitted_sheet_and_required_phrases_can_authorize_stock_words(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            song = fixture(); song['lyrics'] = '[Verse]\nYow yow\nMore more more\n[End]'
            brief = {'prompt': 'A deliberate chant song', 'details': {
                'lyricSheet': {'text': '[Verse]\nYow yow\n[End]', 'mode': 'adapt'},
                'generation': {'requiredPhrases': ['More more more']}}}
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief), 'brief': brief})
            save(root / 'plan.json', {'briefHash': fingerprint(brief), 'plan': song})
            self.assertTrue(stock_chants_authorized({'directory': str(root), 'plan': song}))

    def test_stock_chant_authorization_rejects_changed_frozen_brief(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            song = fixture(); song['lyrics'] = '[Verse]\nWoah\n[End]'
            brief = {'prompt': 'Use woah deliberately', 'details': {}}
            save(root / 'planning-input.json', {'briefHash': '0' * 64, 'brief': brief})
            save(root / 'plan.json', {'briefHash': '0' * 64, 'plan': song})
            with self.assertRaisesRegex(ValueError, 'planning inputs changed'):
                stock_chants_authorized({'directory': str(root), 'plan': song})

    def test_stock_chant_authorization_uses_bounded_parent_snapshot_for_child_render(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / 'movements' / '1'; child.mkdir(parents=True)
            song = fixture(); song['lyrics'] = '[Verse]\nWoah\n[End]'
            brief = {'prompt': 'Use woah deliberately', 'details': {}}
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief), 'brief': brief})
            save(root / 'plan.json', {'briefHash': fingerprint(brief), 'plan': song})
            self.assertTrue(stock_chants_authorized({'directory': str(child), 'plan': song}))

    def test_short_schema_and_native_validation_require_a_submitted_sheet(self):
        for seconds in (60, 90, 119):
            with self.subTest(seconds=seconds), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                config, brief, raw = self.setup_case(root); raw['duration'] = seconds
                def run(command, *args, **kwargs):
                    self.assertEqual(load(root / 'plan-schema.json')['properties']['duration']['minimum'], 60)
                    save(Path(command[command.index('--output-last-message') + 1]), raw)
                with patch('planner.run_owned', side_effect=run):
                    result = make_plan(config, brief, root, [])
                self.assertEqual(result['duration'], seconds)
                self.assertEqual(render_brief({'directory': str(root), 'plan': result}), brief)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); config, brief, raw = self.setup_case(root)
            brief['details'].pop('lyricSheet'); brief['details']['references'] = [{'url': 'https://example.com'}]
            raw['duration'] = 90
            def run(command, *args, **kwargs):
                self.assertEqual(load(root / 'plan-schema.json')['properties']['duration']['minimum'], 120)
                save(Path(command[command.index('--output-last-message') + 1]), raw)
            with patch('planner.run_owned', side_effect=run), self.assertRaisesRegex(ValueError, 'Invalid duration'):
                make_plan(config, brief, root, [])

    def test_lyric_length_suggestion_fits_words_and_retains_explicit_override(self):
        default = {'target_seconds': 240, 'explicit_user_length_overrides': True}
        brief = {'prompt': 'A song', 'details': {'lyricSheet': {'text': 'word ' * 111}}}
        result = duration_suggestion(brief, default)
        self.assertEqual(result['target_seconds'], 85)
        self.assertTrue(result['explicit_user_length_overrides'])
        self.assertEqual(duration_suggestion({'details': {}}, default), default)
        brief['details']['lyricSheet']['text'] = 'word ' * 40
        self.assertEqual(duration_suggestion(brief, default)['target_seconds'], 60)
        brief['details']['lyricSheet']['text'] = 'word ' * 120
        with self.assertRaisesRegex(ValueError, 'duration long enough'):
            validate_materials({'recipe': 'new', 'duration': 60, 'lyrics': 'word ' * 120}, brief)


if __name__ == '__main__': unittest.main()
