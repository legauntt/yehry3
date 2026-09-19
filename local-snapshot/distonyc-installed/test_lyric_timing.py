import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from backfill_lyric_cues import candidate, choose, published_hash, sync_cues
from common import save


class LyricTimingTests(unittest.TestCase):
    def test_published_audio_hash_selects_the_exact_render(self):
        song = {
            'id': 'distonyc-test',
            'title': 'Repeated Song',
            'url': 'https://example.com/distonyc-test-abcdef123456.mp3',
            'lyrics': {'text': '[Chorus]\nSame words\n\n[Chorus]\nSame words'},
        }
        with tempfile.TemporaryDirectory() as root:
            candidates = []
            for name, digest in [('unfinished-render', '111111111111' + '0' * 52), ('published-render', 'abcdef123456' + '0' * 52)]:
                directory = Path(root) / name
                directory.mkdir()
                save(directory / 'track.json', {'title': song['title'], 'lyrics': song['lyrics']['text']})
                save(directory / 'matched-vocals-words.json', [{'words': [{'word': 'same', 'start': 1, 'end': 2}]}])
                save(directory / 'delivery-manifest.json', [{'file': f'{name}.mp3', 'sha256': digest}])
                candidates.append(candidate(directory))
            selected, reason = choose(song, candidates)
            self.assertEqual(selected['directory'].name, 'published-render')
            self.assertIn('published audio sha256', reason)

    def test_hash_prefix_comes_from_release_filename(self):
        self.assertEqual(published_hash({'url': 'https://example.com/a-deadbeefcafe.mp3?download=1'}), 'deadbeefcafe')
        self.assertEqual(published_hash({'url': 'https://example.com/a.mp3'}), '')

    def test_delivery_manifest_wins_when_legacy_url_has_no_hash(self):
        song = {
            'id': 'legacy-song',
            'title': 'Legacy Song',
            'url': 'https://example.com/legacy-song.mp3',
            'lyrics': {'text': '[Verse]\nThe same finished words'},
        }
        candidates = [
            {'directory': Path('earlier'), 'title': song['title'], 'keys': ['the same finished words'], 'hashes': set()},
            {'directory': Path('delivered'), 'title': song['title'], 'keys': ['the same finished words'], 'hashes': {'1' * 64}},
        ]
        selected, reason = choose(song, candidates)
        self.assertEqual(selected['directory'].name, 'delivered')
        self.assertIn('delivered', reason)

    def test_sync_cues_uses_worker_api_without_changing_the_catalog(self):
        song = {'id': 'distonyc-test', 'title': 'Test', 'lyrics': {'text': 'Words', 'kind': 'written', 'cues': [{'line': 0, 'start': 1, 'end': 2}]}}
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / 'config.json'
            save(config, {'api': 'https://example.com/yehry3', 'worker_id': 'worker-identifier-1'})
            client = Mock()
            with patch.dict('os.environ', {'DISTONYC_WORKER_TOKEN': 'x' * 32}), patch('backfill_lyric_cues.API', return_value=client):
                self.assertEqual(sync_cues(config, [song]), 1)
            client.call.assert_called_once_with('/songs/distonyc-test/lyrics/cues', {'lyrics': song['lyrics']})


if __name__ == '__main__':
    unittest.main()
