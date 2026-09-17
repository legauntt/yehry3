"""Regression coverage for optional song form and shared heading semantics."""
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import fingerprint, load, save
from generation_controls import constraints, normalize as generation_options, arrangement_guidance
from lyric_sections import composition_caption, normalize_section_labels, section_label
from planner import make_plan, normalize, validate
from request_materials import validate_materials, words
import lyric_constraints as lc
import music_backend
from paid_music import request_duration
from test_planner import fixture
import test_request_materials as materials_tests
from composition_ending import timing_instruction
from sparse_vocal_repair import GUIDANCE as SPARSE_GUIDANCE


class LyricSectionsTests(unittest.TestCase):
    def test_known_headings_agree_across_wording_counting_and_backend(self):
        labels = {
            '[Turn]': '[Bridge]', '[Final Chorus 2]': '[Chorus 2]',
            '[ LAST CHORUS 3 ]': '[Chorus 3]', '[ Chorus Reprise 2 ]': '[Chorus 2]',
            '[ Verse 1 ]': '[Verse 1]', '[ Pre – Chorus 2 ]': '[Pre-Chorus 2]',
            '[PostChorus 3]': '[Post-Chorus 3]', '[Final Verse 2]': '[Verse 2]',
            '[Spoken  Verse 2]': '[Spoken Verse 2]', '[Final Tag]': '[Tag]',
            '[Last Verse]': '[Verse]', '[Final Refrain]': '[Refrain]',
            '[Final Hook]': '[Hook]', '[Breakdown]': '[Breakdown]',
            '[Solo 2]': '[Solo 2]', '[Interlude]': '[Interlude]',
            '[Movement 2]': '[Movement 2]', '[Section 2]': '[Section 2]',
            '[Coda]': '[Coda]',
        }
        supplied = 'Carry the lantern home.\nKeep the river flowing.'
        for raw, canonical in labels.items():
            with self.subTest(raw=raw):
                lyrics = raw + '\n' + supplied + '\n[End]'
                self.assertEqual(section_label(raw), canonical)
                self.assertEqual(words(lyrics), supplied.split())
                self.assertEqual(lc.lyric_words(lyrics), lc.lyric_words(supplied))
                song = {**fixture(), 'duration': 120, 'lyrics': lyrics,
                        'generation': generation_options({'version': 1, 'duration': 120})}
                self.assertIs(validate_materials(song, {'details': {'lyricSheet': {'text': supplied}}}), song)
                chunks = music_backend.composition(song, 1)['composition_plan']['chunks']
                sung = [chunk for chunk in chunks if '\n' in chunk['text']]
                self.assertEqual(len(sung), 1)
                self.assertTrue(sung[0]['text'].startswith(canonical + '\n'))
                self.assertEqual(words('\n'.join(c['text'] for c in chunks)), supplied.split())

    def test_normalization_preserves_literal_text_and_line_endings(self):
        text = ' [ Verse 1 ] \r\n  Keep  this, exactly! \r\n[unknown words]\r\n[Pre Chorus 2]\r\nInline [Final Chorus] words.\r\n'
        result = normalize_section_labels(text)
        self.assertEqual(result, '[Verse 1]\r\n  Keep  this, exactly! \r\n[unknown words]\r\n[Pre-Chorus 2]\r\nInline [Final Chorus] words.\r\n')
        self.assertEqual(normalize_section_labels(result), result)
        for newline in ('\r', '\n', '\r\n', '\u2028', '\u2029'):
            self.assertEqual(normalize_section_labels('[ Verse ]' + newline + 'Keep this.'), '[Verse]' + newline + 'Keep this.')
        self.assertEqual(words('[Verse]\rOne line.\r[Final Chorus]\rTwo lines.'), ['One', 'line.', 'Two', 'lines.'])

    def test_unknown_brackets_inline_tags_and_empty_labels_are_literal(self):
        for text in ['[]', '[ ]', '[Sing this softly]', '[Chorus: repeat twice]',
                     '[Verse 1 and 2]', '[Verse\n1]', 'Sing [Chorus] now.', '[A]']:
            with self.subTest(text=text):
                self.assertIsNone(section_label(text))
                self.assertEqual(normalize_section_labels(text), text)
        supplied = '[Sing this softly]\nCarry the lantern home.'
        self.assertEqual(words(supplied), supplied.split())
        with self.assertRaisesRegex(ValueError, 'first mismatch'):
            validate_materials({'recipe': 'new', 'duration': 120, 'lyrics': 'Carry the lantern home.'},
                               {'details': {'lyricSheet': {'text': supplied}}})

    def test_section_words_cannot_satisfy_a_required_sung_phrase(self):
        brief = {'details': {'generation': {'version': 1, 'requiredPhrases': ['final chorus']}}}
        song = {**fixture(), 'lyrics': '[Final Chorus]\nCarry the lantern home.\n[End]'}
        with self.assertRaisesRegex(ValueError, 'required lyric phrase'):
            constraints(song, brief)
        song['lyrics'] = '[Final Chorus]\nSing the final chorus softly.\n[End]'
        self.assertEqual(constraints(song, brief)['lyrics'], song['lyrics'])

    def test_explicit_word_limit_ignores_all_supported_headings(self):
        with tempfile.TemporaryDirectory() as tmp:
            contract = lc.prepare(tmp, {'prompt': 'Exactly 4 words.', 'details': {'voiceModel': 'v8'}})
            song = {**fixture(), 'lyrics': '[ Last Chorus 2 ]\nCarry the lantern home.\n[End]'}
            self.assertEqual(lc.validate(song, contract, tmp), song)
            self.assertEqual(load(Path(tmp) / 'lyric-pacing.json')['words'], 4)
            song['lyrics'] += '\n[unknown phrase]'
            with self.assertRaisesRegex(ValueError, 'word count is 6'):
                lc.validate(song, contract, tmp)

    def test_no_chorus_passes_real_planning_and_backend_paths(self):
        body = fixture()['lyrics'].replace('[Verse]\n', '').replace('[End]', '').strip()
        for heading in ('', '[Verse 1]\n', '[Section 1]\n'):
            for supplied in (False, True):
                with self.subTest(heading=heading, supplied=supplied), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    (root / 'PREFERENCES.md').write_text('Default to strong verses and choruses.', encoding='utf-8')
                    song = {**fixture(), 'lyrics': heading + body + '\n[end]'}
                    brief = {'prompt': 'No chorus or repeating refrain. Let the song develop continuously.',
                             'details': {'voiceModel': 'v8', 'generation': {'version': 1}}}
                    if supplied:
                        brief['details']['lyricSheet'] = {'mode': 'preserve', 'text': body}
                    config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
                    def model(command, *args, **kwargs):
                        self.assertIn('A chorus or recurring refrain is optional.', kwargs['input_text'])
                        save(Path(command[command.index('--output-last-message') + 1]), song)
                    with patch('planner.run_owned', side_effect=model) as run:
                        result = make_plan(config, brief, root, [])
                        frozen = (root / 'plan.json').read_bytes()
                        save(root / 'render-request.json', {'frozen': True})
                        self.assertEqual(make_plan(config, brief, root, []), result)
                    run.assert_called_once()
                    self.assertEqual((root / 'plan.json').read_bytes(), frozen)
                    self.assertNotIn('[Chorus', result['lyrics'])
                    self.assertEqual(words(result['lyrics']), body.split())
                    chunks = music_backend.composition(result, 1)['composition_plan']['chunks']
                    self.assertEqual(words('\n'.join(c['text'] for c in chunks)), body.split())
                    self.assertFalse(any('[Chorus' in c['text'] for c in chunks))
                    self.assertTrue(all(3000 <= c['duration_ms'] <= 120000 for c in chunks))
                    if not heading:
                        self.assertTrue(any(c['text'].startswith('[Section]\n') for c in chunks))

    def test_original_normalization_handles_escaped_labels_and_terminal_case(self):
        raw = {**fixture(), 'lyrics': fixture()['lyrics'].replace('[Verse]', '[ Verse 1 ]').replace('[End]', '[end]').replace('\n', '\\n')}
        before = copy.deepcopy(raw)
        result = validate(normalize(raw), [])
        self.assertEqual(result['lyrics'].count('[End]'), 1)
        self.assertTrue(result['lyrics'].startswith('[Verse 1]\n'))
        self.assertEqual(raw, before)
        inline = {**fixture(), 'lyrics': fixture()['lyrics'].replace('[End]', 'I sing [End]')}
        self.assertTrue(normalize(inline)['lyrics'].endswith('I sing [End]\n[End]'))

    def test_backend_never_discards_words_after_an_early_end_marker(self):
        for lyrics in ('[Verse]\nCarry the lantern home.\n[End]\nKeep the river flowing.\n[End]',
                       '[End]\nCarry the lantern home.\n[End]',
                       'Carry the lantern home.\n[End]\n[End]\nKeep the river flowing.',
                       '[Intro]\n[Section 1]\nCarry the lantern home.\n[Outro]'):
            with self.subTest(lyrics=lyrics):
                song = {**fixture(), 'duration': 240, 'lyrics': lyrics,
                        'generation': generation_options({'version': 1, 'duration': 240})}
                result = music_backend.composition(song, 1)
                chunks = result['composition_plan']['chunks']
                self.assertEqual(request_duration(result), 240000)
                self.assertEqual(words('\n'.join(c['text'] for c in chunks)), words(lyrics))
                self.assertNotIn('[End]', '\n'.join(c['text'] for c in chunks))

    def test_exhausted_retries_report_current_mismatch_without_rewriting_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config, brief, raw = materials_tests.RequestMaterialsTests().setup_case(root)
            raw['lyrics'] = raw['lyrics'].replace('lantern', 'candle', 1)
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief), 'brief': brief})
            attempts = []
            for name in ('planner-result.json', 'planner-result-material-2.json', 'planner-result-material-3.json'):
                save(root / name, raw)
                attempts.append({'output': name, 'status': 'rejected', 'error': 'Old heading error'})
            ledger = root / 'material-planning-attempts.json'
            save(ledger, {'briefHash': fingerprint(brief), 'attempts': attempts})
            before = ledger.read_bytes()
            with patch('planner.run_owned') as model, self.assertRaisesRegex(ValueError, "word 2: expected 'lantern'; received 'candle'"):
                make_plan(config, brief, root, [])
            model.assert_not_called()
            self.assertEqual(ledger.read_bytes(), before)

    def test_fresh_caption_preserves_timing_and_removes_default_form_conflicts(self):
        caption = ('A continuous narrative, no chorus. ' + timing_instruction(180) + SPARSE_GUIDANCE +
                   'Strongly sung rock melodies, sustained notes and clear verse-to-chorus contrast. ')
        updated = composition_caption(caption)
        self.assertIn('A continuous narrative, no chorus.', updated)
        self.assertIn('between 168 and 172 seconds', updated)
        self.assertIn('Do not add, omit or repeat lyric words.', updated)
        self.assertNotIn('verses and choruses', updated)
        self.assertNotIn('final chorus', updated)
        self.assertNotIn('verse-to-chorus', updated)
        self.assertIn('grow toward the final section', arrangement_guidance({'version': 1, 'energy': 'build'}))


if __name__ == '__main__':
    unittest.main()
