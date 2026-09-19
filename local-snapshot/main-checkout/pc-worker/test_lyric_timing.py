import tempfile, unittest
from pathlib import Path
from common import save
from lyric_timing import make_cues, make_suite_cues, valid_cues


DURATION = 205.03510204081633
REAL_TEXT = '\n'.join(['Yeah'] * 34)
REAL_HEARD = [
    {'token': 'you', 'start': 0.0, 'end': 1.98},
    {'token': "that's", 'start': 78.18, 'end': 79.58},
    {'token': 'it', 'start': 79.58, 'end': 80.98},
    {'token': 'yeah', 'start': 92.14, 'end': 93.54},
    {'token': 'yeah', 'start': 105.76, 'end': 107.16},
    {'token': 'mhmm', 'start': 141.4, 'end': 142.8},
    {'token': 'mhmm', 'start': 142.8, 'end': 145.0},
    {'token': 'mhmm', 'start': 145.0, 'end': 145.08},
    {'token': "i'm", 'start': 204.36, 'end': 204.44},
    {'token': 'going', 'start': 204.44, 'end': 204.44},
    {'token': 'to', 'start': 204.44, 'end': 204.44},
    {'token': 'say', 'start': 204.44, 'end': 204.48},
    {'token': 'that', 'start': 204.48, 'end': 204.48},
    {'token': "i'm", 'start': 204.48, 'end': 204.48},
    {'token': 'going', 'start': 204.48, 'end': 204.48},
    {'token': 'to', 'start': 204.48, 'end': 204.48},
    {'token': 'say', 'start': 204.48, 'end': 204.96},
    {'token': 'that', 'start': 204.96, 'end': 204.98},
]


class LyricTimingTests(unittest.TestCase):
    def test_exhausted_real_timestamps_omit_cues(self):
        self.assertEqual(len(REAL_TEXT.splitlines()), 34)
        self.assertEqual(len(REAL_HEARD), 18)
        self.assertEqual(make_cues(None, REAL_TEXT, DURATION, REAL_HEARD), [])

    def test_duplicate_and_zero_duration_cues_are_invalid(self):
        self.assertFalse(valid_cues([
            {'line': 0, 'start': 1.0, 'end': 2.0},
            {'line': 1, 'start': 1.0, 'end': 3.0},
        ], 10.0))
        self.assertFalse(valid_cues([
            {'line': 0, 'start': 1.0, 'end': 1.0},
        ], 10.0))

    def test_valid_cues_are_preserved(self):
        heard = [
            {'token': 'hello', 'start': 1.0, 'end': 2.0},
            {'token': 'world', 'start': 4.0, 'end': 5.0},
        ]
        expected = [
            {'line': 0, 'start': 1.0, 'end': 2.0},
            {'line': 1, 'start': 4.0, 'end': 5.0},
        ]
        self.assertEqual(make_cues(None, 'Hello\nWorld', 10.0, heard), expected)

    def test_suite_offsets_second_part_and_remains_valid(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); first = root / 'first'; second = root / 'second'
            first.mkdir(); second.mkdir()
            save(first / 'matched-vocals-words.json', [
                {'words': [{'word': 'First', 'start': 1.0, 'end': 2.0}]},
            ])
            save(second / 'matched-vocals-words.json', [
                {'words': [{'word': 'Second', 'start': 1.0, 'end': 2.0}]},
            ])
            cues = make_suite_cues([(first, 10.0), (second, 10.0)], 'First\nSecond', 20.0)
            self.assertEqual(cues, [
                {'line': 0, 'start': 1.0, 'end': 2.0},
                {'line': 1, 'start': 11.0, 'end': 12.0},
            ])
            self.assertTrue(valid_cues(cues, 20.0))


if __name__ == '__main__':
    unittest.main()
