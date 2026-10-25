import copy
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from audit_lyric_cues import apply_report, audit_song
from common import save, sha
from restore_lyric_evidence import retained_source


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.song = {'id': 'song', 'title': 'Song', 'duration': 30,
                     'url': 'https://example.com/song-abcdef123456.mp3',
                     'lyrics': {'kind': 'written', 'text': 'Same familiar words',
                                'cues': [{'line': 0, 'start': 1, 'end': 5}]}}
        self.row = {**self.song, 'before': copy.deepcopy(self.song['lyrics']),
                    'after': {**self.song['lyrics'], 'cues': []}, 'changed': True}

    def test_unknown_audio_hash_cannot_fall_back_to_same_lyrics(self):
        other = {'directory': Path('another-take'), 'title': 'Song',
                 'keys': ['same familiar words'], 'hashes': {'0' * 64}}
        result = audit_song(self.song, [other])
        self.assertEqual(result['status'], 'unverified')
        self.assertNotIn('after', result)

    def test_cue_only_apply_preserves_other_metadata_and_is_repeatable(self):
        song = {**copy.deepcopy(self.song), 'votes': 17, 'publishedAt': 'original'}
        catalog = {'songs': [song]}
        for _ in range(2):
            self.assertEqual(len(apply_report(catalog, {'songs': [self.row]})), 1)
        self.assertEqual(song['lyrics']['cues'], [])
        self.assertEqual(song['lyrics']['text'], self.song['lyrics']['text'])
        self.assertEqual(song['votes'], 17)
        self.assertEqual(song['publishedAt'], 'original')

    def test_concurrent_edit_rejects_entire_batch_before_mutation(self):
        song = copy.deepcopy(self.song)
        newer = {**copy.deepcopy(self.song), 'id': 'newer'}
        newer['lyrics']['text'] = 'Recently edited'
        row = {**copy.deepcopy(self.row), 'id': 'newer'}
        with self.assertRaisesRegex(ValueError, 'changed'):
            apply_report({'songs': [song, newer]}, {'songs': [self.row, row]})
        self.assertEqual(song['lyrics'], self.row['before'])

    def test_report_cannot_change_lyric_words(self):
        row = copy.deepcopy(self.row)
        row['after']['text'] = 'A machine guessed these words'
        with self.assertRaisesRegex(ValueError, 'only change cues'):
            apply_report({'songs': [self.song]}, {'songs': [row]})

    def test_supported_existing_timeline_wins_a_tie(self):
        source = {'directory': Path('correct-recording'), 'title': 'Song',
                  'keys': ['same familiar words'], 'hashes': {'abcdef123456' + '0' * 52}}
        report = {'source': 'matched-vocals-words.json', 'recall': 1, 'score': 1,
                  'cues': [{'line': 0, 'start': 0, 'end': 5}], 'rejected': [],
                  'words': [{'token': word, 'start': 1 + i, 'end': 2 + i}
                            for i, word in enumerate(['same', 'familiar', 'words'])]}
        with patch('audit_lyric_cues.cue_report', return_value=report):
            row = audit_song(self.song, [source])
        self.assertFalse(row['changed'])
        self.assertEqual(row['after'], self.song['lyrics'])

    def test_restored_evidence_requires_the_exact_unchanged_vocal(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            folder = root / 'published' / 'song' / ('a' * 64)
            folder.mkdir(parents=True)
            vocal = folder / 'vocals.wav'
            vocal.write_bytes(b'retained vocal')
            save(folder / 'source.json', {'source': {'url': self.song['url']},
                                         'material': {'vocal_reference_sha256': sha(vocal)}})
            self.assertEqual(retained_source(self.song, root)[2], vocal)
            self.assertIsNone(retained_source({**self.song, 'url': 'another-recording'}, root))
            vocal.write_bytes(b'changed vocal')
            with self.assertRaisesRegex(ValueError, 'hash changed'):
                retained_source(self.song, root)


if __name__ == '__main__': unittest.main()
