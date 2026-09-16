import tempfile
import unittest
from pathlib import Path

from common import save
from lyrical_ending import analyze, match_phrase, review
from lyric_timing import normalize_words


VERSE = 'I took a letter down the river and read it to the rain one more time'
CLOSE = 'Now the letter has a home and I can leave again'
LYRICS = '[Verse]\n' + VERSE + '\n[Final Chorus]\n' + CLOSE + '\n[End]'


def heard(text, start, step=.5):
    return [{'token': token, 'start': start + index * step, 'end': start + index * step + .4}
            for index, token in enumerate(normalize_words(text))]


class LyricalEndingTests(unittest.TestCase):
    def test_detects_early_meaningful_finish_despite_wordless_tail(self):
        words = heard(VERSE, 10) + heard(CLOSE, 100) + heard('oh oh oh oh oh oh', 140)
        result = analyze(LYRICS, words, 160)
        self.assertEqual(result['status'], 'supported')
        self.assertGreater(result['post_lyric_seconds'], 50)
        self.assertEqual(result['qualityIssues'][0]['code'], 'early_lyric_ending')
        self.assertFalse(result['listening_review'])

    def test_uses_later_chorus_occurrence(self):
        words = heard(VERSE, 10) + heard(CLOSE, 50) + heard(CLOSE, 142)
        result = analyze(LYRICS, words, 160)
        self.assertEqual(result['qualityIssues'], [])
        self.assertGreater(result['final_phrase']['start'], 140)

    def test_missing_closing_line_is_advisory_without_invented_timing(self):
        words = heard(VERSE, 10) + heard(VERSE, 100)
        result = analyze(LYRICS, words, 160)
        self.assertEqual(result['status'], 'closing_words_unconfirmed')
        self.assertEqual(result['qualityIssues'], [{'code': 'unconfirmed_lyric_ending'}])
        self.assertIsNone(result['final_phrase'])
        self.assertNotIn('post_lyric_seconds', result)

    def test_bad_transcript_and_short_mantras_do_not_establish_fidelity(self):
        result = analyze(LYRICS, heard('thank you thank you thank you thank you thank you thank you', 10), 160)
        self.assertEqual(result['status'], 'uncertain')
        self.assertEqual(result['qualityIssues'], [])
        self.assertIsNone(match_phrase(['oh', 'oh', 'oh', 'oh'], heard('oh oh oh oh', 10)))

    def test_explicit_long_ending_keeps_evidence_without_outro_issue(self):
        result = analyze(LYRICS, heard(VERSE, 10) + heard(CLOSE, 100), 160, allow_long=True)
        self.assertGreater(result['post_lyric_seconds'], 50)
        self.assertEqual(result['qualityIssues'], [])

    def test_saved_review_pins_raw_transcript(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            save(work / 'track.json', {'lyrics': LYRICS, 'duration': 160})
            words = [{'word': row['token'], 'start': row['start'], 'end': row['end']}
                     for row in heard(VERSE, 10) + heard(CLOSE, 100)]
            save(work / 'selected-vocals-words.json', {'segments': [{'words': words}]})
            result = review(work)
            self.assertEqual(review(work), result)
            words[-1]['end'] += .1
            save(work / 'selected-vocals-words.json', {'segments': [{'words': words}]})
            with self.assertRaisesRegex(ValueError, 'evidence changed'): review(work)


if __name__ == '__main__': unittest.main()
