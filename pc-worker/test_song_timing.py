import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import load, save, sha
from duration_runtime import adapt
from generation_controls import normalize, constraints
from generation_flow import approved_plan
from generation_candidates import prepare
from planner import make_plan, validate
from renderer import module_at
from request_materials import minimum_duration, render_brief
from test_duration import suite_plan, ENGINE, STUDIO
from test_planner import fixture
import music_backend
import paid_music
from test_paid_music import plan as paid_plan


class SongTimingTests(unittest.TestCase):
    def test_explicit_lengths_plan_and_resume_with_matching_schema_and_frozen_brief(self):
        for seconds in (69, 119, 666):
            with self.subTest(seconds=seconds), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / 'PREFERENCES.md').write_text('Use the selected saved voice.')
                raw = {**fixture(), 'duration': seconds} if seconds < 600 else suite_plan(3, 222)
                brief = {'id': 'timing-test', 'prompt': 'A song about the morning train',
                         'details': {'generation': {'version': 1, 'duration': seconds, 'reviewLyrics': True}}}
                config = {'planner_model': 'test', 'codex': 'test', 'settings': {'studio_dir': str(root)}}
                def model(command, *args, **kwargs):
                    self.assertEqual(load(root / 'plan-schema.json')['properties']['duration']['minimum'], 69 if seconds < 120 else 120)
                    save(Path(command[command.index('--output-last-message') + 1]), raw)
                with patch('planner.run_owned', side_effect=model) as called:
                    song = make_plan(config, brief, root, [])
                    self.assertEqual(make_plan(config, brief, root, []), song)
                called.assert_called_once()
                self.assertEqual(song['duration'], seconds)
                self.assertEqual(song['generation']['duration'], seconds)
                class API:
                    review = None
                    def call(self, *args): return {'review': self.review}
                client = API()
                _, offer = approved_plan(song, brief, root, [], client)
                client.review = {'id': offer['reviewId'], 'kind': 'lyrics', 'payload': offer['payload'],
                                 'state': 'approved', 'decision': {'action': 'approve', 'lyrics': song['lyrics']}}
                approved, pending = approved_plan(song, brief, root, [], client)
                self.assertIsNone(pending); self.assertEqual(approved['duration'], seconds)
                if seconds < 120:
                    self.assertEqual(render_brief({'directory': str(root), 'plan': song}), {k: v for k, v in brief.items() if k != 'id'})
                    with self.assertRaisesRegex(ValueError, 'duration selection'):
                        render_brief({'directory': str(root), 'plan': {**song, 'duration': seconds + 1}})
                else:
                    self.assertEqual(sum(part['duration'] for part in song['movements']), 666)

    def test_boundaries_do_not_change_auto_or_allow_unsupported_paid_suites(self):
        for seconds in (69, 600, 601, 666):
            self.assertEqual(normalize({'version': 1, 'duration': seconds})['duration'], seconds)
        for seconds in (68, 667, 69.5):
            with self.assertRaises(ValueError): normalize({'version': 1, 'duration': seconds})
        self.assertEqual(minimum_duration({'details': {}}), 120)
        self.assertEqual(minimum_duration({'details': {'lyricSheet': {'text': 'supplied'}}}), 60)
        with self.assertRaises(ValueError): validate({**fixture(), 'duration': 69}, [])
        with self.assertRaisesRegex(ValueError, 'Choose 1 composition'):
            normalize({'version': 1, 'duration': 666, 'candidates': 2})
        for seconds in (69, 600):
            song = paid_plan(seconds)
            music_backend.plan_constraints(song, {'details': {'musicBackend': 'eleven_music', 'generation': song['generation']}})
            self.assertEqual(paid_music.request_duration(music_backend.composition(song, 1)), seconds * 1000)
        for seconds in (601, 666):
            song = paid_plan(seconds)
            with self.assertRaises(ValueError):
                music_backend.plan_constraints(song, {'details': {'musicBackend': 'eleven_music', 'generation': song['generation']}})
            with self.assertRaises(ValueError): music_backend.composition(song, 1)

    def test_short_composition_preview_keeps_frozen_planning_provenance(self):
        from common import fingerprint
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            brief = {'prompt': 'A short song', 'details': {'generation': {'version': 1, 'duration': 69, 'candidates': 2}}}
            song = constraints({**fixture(), 'duration': 69}, brief)
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief), 'brief': brief})
            save(root / 'plan.json', {'briefHash': fingerprint(brief), 'plan': song})
            request = {'prompt_id': 'short-preview', 'directory': str(root), 'plan': song,
                       'config': {'settings': {'studio_dir': str(root)}}}
            class ReachedRender(Exception): pass
            def render(child, **kwargs):
                self.assertTrue(kwargs['preflight'])
                self.assertEqual(render_brief(child), brief)
                raise ReachedRender()
            with self.assertRaises(ReachedRender): prepare(request, render)
            changed = load(root / 'candidate-0' / 'planning-input.json'); changed['brief']['prompt'] = 'tampered'
            save(root / 'candidate-0' / 'planning-input.json', changed)
            with self.assertRaises(ValueError): prepare(request, render)

    @unittest.skipUnless(ENGINE.exists() and STUDIO.exists(), 'Installed Troofs engine integration')
    def test_native_short_song_preparation_keeps_audio_guards_and_source_files(self):
        engine_hash, studio_hash = sha(ENGINE), sha(STUDIO / 'studio.py')
        engine = module_at('manual_duration_test_engine', ENGINE); adapt(engine, 69)
        studio = engine.engine({'studio_dir': str(STUDIO), 'python': 'python', 'voice_python': 'python'})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); cat = root / 'catalog'; cat.mkdir()
            save(cat / 'sources.json', [{'recording': '06-someday'}]); (cat / 'tony-catalog-adapter.pt').write_bytes(b'test')
            studio.plan.__globals__.update(CAT=cat, AI=root, ROOT=root)
            spec = {**fixture(), 'kind': 'new', 'id': 'manual-duration-check', 'seed': 100}
            for seconds in (69, 119, 600):
                spec['duration'] = seconds; engine.validate_spec(spec); save(root / 'spec.json', spec)
                self.assertEqual(studio.plan(root / 'spec.json')[1]['duration'], seconds)
            for seconds in (68, 601):
                spec['duration'] = seconds
                with self.assertRaises(Exception): engine.validate_spec(spec)
            spec.update(duration=69, keyscale='H minor')
            with self.assertRaises(Exception): engine.validate_spec(spec)
        self.assertEqual((sha(ENGINE), sha(STUDIO / 'studio.py')), (engine_hash, studio_hash))
