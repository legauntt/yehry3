import ast
import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from common import load, save, sha
from planner import make_plan, validate
from plan_schema import SCHEMA
from test_planner import fixture
from vocal_accents import (REFERENCE_ID, REFERENCE_SHA256, configure, direction, for_movement,
                          preserve_caption, validate as validate_accent, verify_frozen)

PROFILE = Path('C:/Users/Jesse/Music/One More Round - extended/AI extension/troofs-studio')
RECIPES = Path('C:/Users/Jesse/code/troofs-desktop/worker/recipes')


def accented(section='intro'):
    return {**fixture(), 'vocal_accents': [{'section': section, 'duration_seconds': 6, 'words': 'A rose upon the stairway'}]}


class VocalAccentTests(unittest.TestCase):
    def test_legacy_plan_remains_identical_and_empty_is_supported(self):
        for plan in (fixture(), {**fixture(), 'vocal_accents': []}):
            before = copy.deepcopy(plan)
            self.assertEqual(validate(plan, []), before)
            self.assertEqual(plan, before)

    def test_one_short_phrase_from_actual_lyrics(self):
        for section in ('intro', 'bridge', 'outro'):
            plan = accented(section)
            self.assertEqual(validate(plan, []), plan)
            self.assertIn(plan['vocal_accents'][0]['words'], direction(plan['vocal_accents'][0]))
        for change in ({'duration_seconds': 3}, {'duration_seconds': 10}, {'duration_seconds': True},
                       {'section': 'chorus'}, {'words': 'Ooom aah'}, {'words': 'Verse'}, {'words': 'rose'},
                       {'words': 'new words that were never in this song'}):
            plan = accented(); plan['vocal_accents'][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError): validate(plan, [])
        plan = accented(); plan['vocal_accents'] *= 2
        with self.assertRaises(ValueError): validate(plan, [])
        with self.assertRaises(ValueError): validate({**fixture(), 'vocal_accents': None}, [])

    def test_faithful_source_performance_cannot_gain_an_accent(self):
        for recipe in ('remix', 'acoustic', 'barbershop', 'needs_attention'):
            with self.subTest(recipe=recipe), self.assertRaisesRegex(ValueError, 'retain faithful'):
                validate_accent({**accented(), 'recipe': recipe})

    def test_suite_uses_one_accent_in_the_selected_movement(self):
        for section, expected in [('intro', 0), ('bridge', 2), ('outro', 4)]:
            plan = accented(section)
            plan['movements'] = [{'lyrics': 'Different chapter words'} for _ in range(5)]
            plan['movements'][expected]['lyrics'] = fixture()['lyrics']
            validate_accent(plan)
            self.assertEqual([i for i in range(5) if for_movement(plan, i)], [expected])
            plan['movements'][expected]['lyrics'] = 'Other words'
            with self.assertRaises(ValueError): validate_accent(plan)

    def test_planner_receives_the_available_treatment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'PREFERENCES.md').write_text('Keep Tony V6.')
            def model(command, *args, **kwargs):
                prompt = kwargs['input_text']
                self.assertIn('FIRST HALF', prompt)
                self.assertIn('Use vocal_accents=[] for most songs', prompt)
                self.assertIn('2–8 words', prompt)
                save(Path(command[command.index('--output-last-message') + 1]), accented())
            with patch('planner.run_owned', side_effect=model):
                result = make_plan({'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}},
                                   {'prompt': 'An original with a brief throaty intro', 'details': {}}, root, [])
            self.assertEqual(result['vocal_accents'], accented()['vocal_accents'])
            self.assertEqual(SCHEMA['properties']['vocal_accents']['maxItems'], 1)

    def test_generation_retains_requested_caption_and_lm_draft(self):
        code = """def run():
    if True:
        if True:
            planned=[{'caption': 'An unrelated description', 'audio_codes': 'retained'}]
            planned=planned[0]
            save(HERE/'planned-request.json',planned)
            return planned
"""
        patched = preserve_caption(code)
        saved = {}
        namespace = {'HERE': Path('work'), 'CAPTION': 'One short slurred lyric accent',
                     'save': lambda path, value: saved.update({path.name: copy.deepcopy(value)})}
        exec(compile(patched, 'generation-test.py', 'exec'), namespace)
        result = namespace['run']()
        self.assertEqual(result['caption'], namespace['CAPTION'])
        self.assertEqual(result['audio_codes'], 'retained')
        self.assertEqual(saved['vocal-accent-lm-draft.json']['caption'], 'An unrelated description')
        self.assertEqual(saved['planned-request.json']['caption'], namespace['CAPTION'])
        with self.assertRaisesRegex(ValueError, 'Unknown composition'):
            preserve_caption('new unknown recipe')

    @unittest.skipUnless(PROFILE.exists() and RECIPES.exists(), 'Local saved reference integration')
    def test_real_reference_is_frozen_and_both_recipes_keep_basis_wiring(self):
        for name in ('generate_song.py', 'generate_opera.py'):
            for basis in (False, True):
                with self.subTest(recipe=name, basis=basis), tempfile.TemporaryDirectory() as directory:
                    work = Path(directory)
                    target = 'generate_base.py' if basis else 'generate_song.py'
                    (work / target).write_text((RECIPES / name).read_text('utf-8'), 'utf-8')
                    track = {'caption': 'Keep the requested band and words.'}
                    if basis: track['basis_sources'] = [{'id': 'original-song'}]
                    save(work / 'desktop-status.json', {'completed': []})
                    configure(work, track, accented(), {'studio_dir': str(PROFILE)})
                    save(work / 'track.json', track)
                    self.assertEqual(sha(work / 'vocal-accent-reference.wav'), REFERENCE_SHA256)
                    self.assertEqual(track['vocal_accent_reference']['source_interval_seconds'], [0, 9.5])
                    self.assertEqual('build_references' in (work / 'generate_song.py').read_text(), basis)
                    for path in work.glob('*.py'): ast.parse(path.read_text('utf-8'))
                    verify_frozen(work)
                    save(work / 'desktop-status.json', {'completed': ['generate']})
                    before = {p.name: p.read_bytes() for p in work.iterdir()}
                    with self.assertRaisesRegex(ValueError, 'started audio'):
                        configure(work, track, accented(), {'studio_dir': str(PROFILE)})
                    self.assertEqual(before, {p.name: p.read_bytes() for p in work.iterdir()})
                    (work / 'vocal-accent-reference.wav').write_bytes(b'changed')
                    with self.assertRaisesRegex(ValueError, 'reference changed'): verify_frozen(work)

    @unittest.skipUnless(PROFILE.exists(), 'Local saved audio integration')
    def test_runtime_appends_only_preferred_half_and_preserves_basis_audio(self):
        import numpy as np
        import soundfile as sf
        import shutil
        from vocal_accent_runtime import install
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            reference = PROFILE / 'vocal-techniques' / REFERENCE_ID / 'reference.wav'
            shutil.copy2(reference, work / 'vocal-accent-reference.wav')
            original = np.repeat((.05 * np.sin(np.arange(44100) * .03))[:, None], 2, axis=1).astype('float32')
            def original_references():
                sf.write(work / 'catalog-reference.wav', original, 44100, subtype='PCM_24')
                save(work / 'reference-manifest.json', {'clips': [{'basis_id': 'selected'}], 'reference_seconds': 1.0})
            base = SimpleNamespace(HERE=work, np=np, sf=sf, references=original_references,
                CONFIG={'vocal_accent_reference': {'sha256': REFERENCE_SHA256, 'profile': REFERENCE_ID}})
            install(base); base.references()
            combined, sr = sf.read(work / 'catalog-reference.wav', dtype='float32', always_2d=True)
            self.assertEqual(len(combined), round(10.5 * sr))
            np.testing.assert_allclose(combined[:len(original)], original, atol=2e-7)
            manifest = load(work / 'reference-manifest.json')
            self.assertEqual(manifest['clips'][0]['basis_id'], 'selected')
            self.assertEqual(manifest['clips'][-1]['interval'], [0, 9.5])
            self.assertFalse(manifest['audio_copied_into_final_mix'])
            first = (work / 'catalog-reference.wav').read_bytes()
            base.references()
            self.assertEqual(first, (work / 'catalog-reference.wav').read_bytes())


if __name__ == '__main__': unittest.main()
