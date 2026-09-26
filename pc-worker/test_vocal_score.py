import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import load, save
from generation_controls import arrangement_guidance, normalize as options
from generation_runtime import configure
from lyrical_ending import review
from music_backend import composition
from paid_music import request_duration
from planner import make_plan, validate
from replan import prepare
from test_planner import fixture, PlannerTests


def wordless():
    return {**fixture(), 'vocal_mode': 'nonverbal', 'duration': 540,
            'lyrics': '[Verse 1]\n' + 'Mmm brruuh ngaa hrrm\n' * 12 + '[Verse 2]\n' + 'Rrmm uuuh brrr mmm\n' * 12 + '[End]',
            'arrangement': 'Entirely wordless spoken-like vocal gestures, humming, breathing, grunts and laughter. Sparse bass and drums, a complete final vocal gesture and natural decay.',
            'generation': options({'version': 1, 'duration': 540})}


class VocalScoreTests(unittest.TestCase):
    def test_nine_minute_nonverbal_plan_preserves_score_and_duration(self):
        song = wordless()
        self.assertEqual(validate(song, []), song)
        body = composition(song, 123)
        self.assertEqual(request_duration(body), 540000)
        chunks = body['composition_plan']['chunks']
        performed = '\n'.join(c['text'] for c in chunks)
        self.assertEqual(performed.count('Mmm brruuh ngaa hrrm'), 12)
        for chunk in chunks:
            styles = ' '.join(chunk['positive_styles'])
            self.assertIn('Entirely nonverbal', styles)
            self.assertNotIn('closing lyric', styles)
            self.assertNotIn('meaningful', styles)
            self.assertIn('English words', chunk['negative_styles'])
        self.assertIn('final chord resolves', chunks[-1]['positive_styles'][-1])

    def test_legacy_lyrics_keep_their_delivery_and_reject_invalid_mode(self):
        song = wordless(); song.pop('vocal_mode')
        body = composition(song, 123)
        self.assertIn('closing lyric', ' '.join(body['composition_plan']['chunks'][1]['positive_styles']))
        self.assertNotIn('English words', body['composition_plan']['chunks'][1]['negative_styles'])
        with self.assertRaisesRegex(ValueError, 'vocal mode'):
            validate({**song, 'vocal_mode': 'instrumental'}, [])
        for performance in ('natural', 'restrained', 'raw'):
            self.assertNotIn('lyric endings', arrangement_guidance({'version': 1, 'performance': performance}, 'nonverbal'))

    def test_planner_receives_rule_in_one_bounded_call_then_reuses_plan(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config, brief, calls, mocked = PlannerTests().run_feedback_case(root, [wordless()])
            brief.update(prompt='9 minutes of Tony speaking pure jibberish (non-English)',
                         details={'musicBackend': 'eleven_music', 'voiceModel': 'v9',
                                  'generation': wordless()['generation'], 'keep': 'No words, just humming, breathing, grunts and laughs.'})
            before = copy.deepcopy(brief)
            with mocked:
                result = make_plan(config, brief, root, [])
                self.assertEqual(make_plan(config, brief, root, []), result)
            self.assertEqual(len(calls), 1)
            self.assertIn('NONVERBAL VOCALS ARE SUPPORTED', calls[0])
            self.assertIn('non-English lyrics in a real language are still lyrics', calls[0])
            self.assertEqual(brief, before)
            self.assertEqual(result['vocal_mode'], 'nonverbal')

    def test_runtime_marks_score_without_weakening_finisher(self):
        recipes = Path(__file__).resolve().parents[2] / 'troofs-desktop/worker/recipes'
        if not recipes.exists(): self.skipTest('Production recipe integration')
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            (work/'generate_song.py').write_bytes((recipes/'generate_song.py').read_bytes())
            (work/'finish_song.py').write_bytes((recipes/'finish_song.py').read_bytes())
            track = {'bpm': 84, 'keyscale': 'C# minor', 'music_backend': 'eleven_music'}
            configure(work, track, {'arrangement': wordless()['arrangement']}, wordless())
            self.assertEqual(track['vocal_mode'], 'nonverbal')
            self.assertNotIn('meaningful', track['caption'])
            self.assertIn('encoded_peak<10**(-.5/20)', (work/'finish_song.py').read_text('utf-8'))
            save(work/'track.json', track)
            with patch('lyrical_ending.timestamp_words') as asr:
                self.assertEqual(review(work)['status'], 'not_applicable')
                asr.assert_not_called()

    def test_replan_keeps_refusal_and_blocks_started_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            refused = {'plan': {**fixture(), 'recipe': 'needs_attention'}}
            save(root/'plan.json', refused)
            prepare(root, 'nonverbal-rule-repair', guided=True, note='Honor the wordless request.')
            self.assertEqual(load(root/'replans/1/plan.json'), refused)
            self.assertEqual(prepare(root, 'nonverbal-rule-repair', guided=True)['number'], 1)
            save(root/'render-request.json', {'frozen': True})
            with self.assertRaisesRegex(ValueError, 'frozen plan'):
                prepare(root, 'another-pass', guided=True)


if __name__ == '__main__': unittest.main()
