import copy
import io
import tempfile
import time
import unittest
import types
from pathlib import Path
from unittest.mock import Mock, patch

from transcribe_performance import digest, public_draft, recognize, write
from transcript_sources import released_address, released_audio, resolve_source
from transcript_data import public_transcript
from transcript_service import pending_songs, publish_batch, run, snapshot


class TranscriptServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.audio = self.root / 'audio.mp3'
        self.audio.write_bytes(b'released recording')
        self.sha = digest(self.audio)
        self.song = {'id': 'new-song', 'title': 'A new release', 'duration': 20,
                     'url': f'https://github.com/legauntt/yehry3/releases/download/distonyc-v1/new-song-{self.sha[:12]}.mp3',
                     'lyrics': {'text': 'WRITTEN WORDS MUST NOT REPLACE RECOGNITION'}}
        self.draft = {'version': 1, 'songId': self.song['id'], 'audioUrl': self.song['url'],
                      'audioSha256': self.sha, 'inputSha256': self.sha, 'input': 'released-recording',
                      'model': 'faster-whisper large-v3-turbo', 'duration': 20, 'review': 'machine',
                      'segments': [{'start': 1, 'end': 3, 'text': 'Actually heard', 'uncertain': True}]}
        self.current = {'head': 'head1', 'tree': 'tree1', 'songs': [self.song], 'transcripts': {}}

    def test_download_pins_the_actual_release_and_rejects_a_changed_file(self):
        with patch('transcript_sources.urllib.request.urlopen', return_value=io.BytesIO(self.audio.read_bytes())):
            audio, _, sha = released_audio(self.song, self.root)
        self.assertEqual(sha, self.sha)
        audio.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'changed'):
            released_audio(self.song, self.root)
        with self.assertRaises(ValueError):
            released_address({**self.song, 'url': 'https://example.test/private.mp3'})

    def test_a_missing_or_guide_stem_falls_back_only_to_the_verified_public_recording(self):
        with patch('transcript_sources.performance_source', side_effect=ValueError('guide vocal')), \
             patch('transcript_sources.released_audio', return_value=(self.audio, self.audio, self.sha)):
            source = resolve_source(self.song, self.root, self.root)
        self.assertEqual(source['input'], 'released-recording')
        self.assertEqual(source['vocals'], self.audio)
        self.assertEqual(source['vocal_sha256'], self.sha)

    def test_no_words_is_an_explicit_outcome_and_language_is_not_forced_to_english(self):
        model = Mock()
        model.transcribe.return_value = (iter([]), Mock(duration=20))
        rows, duration = recognize(model, self.audio, language=None)
        self.assertIsNone(model.transcribe.call_args.kwargs['language'])
        self.assertEqual(model.transcribe.call_args.kwargs['task'], 'transcribe')
        self.assertIsNone(model.transcribe.call_args.kwargs['initial_prompt'])
        draft = public_draft(self.song, {'audio_sha256': self.sha, 'vocal_sha256': self.sha,
                             'input': 'released-recording'}, rows, 'large-v3-turbo', duration, allow_empty=True)
        self.assertEqual(public_transcript(draft, self.song)['outcome'], 'no-words-recognized')
        self.assertEqual(draft['segments'], [])

    def test_a_pre_finish_stem_with_a_different_timeline_uses_the_released_mix(self):
        source = {'vocals': self.audio}
        container = Mock(duration=25000000)
        opened = Mock()
        opened.__enter__ = Mock(return_value=container)
        opened.__exit__ = Mock(return_value=False)
        av = types.SimpleNamespace(time_base=1000000, open=Mock(return_value=opened))
        with patch.dict('sys.modules', {'av': av}), \
             patch('transcript_sources.performance_source', return_value=source), \
             patch('transcript_sources.released_audio', return_value=(self.audio, self.audio, self.sha)):
            result = resolve_source(self.song, self.root, self.root)
        self.assertEqual(result['input'], 'released-recording')
        self.assertEqual(result['vocal_sha256'], self.sha)

    def test_publication_strips_private_evidence_and_refuses_mismatched_input(self):
        dirty = {**self.draft, 'input_file': 'private.wav', 'credentials': 'never public',
                 'segments': [{**self.draft['segments'][0], 'probabilities': [.1]}]}
        self.assertEqual(public_transcript(dirty, self.song), self.draft)
        with self.assertRaises(ValueError):
            public_transcript({**self.draft, 'inputSha256': '0' * 64}, self.song)

    def test_idle_polling_reuses_the_immutable_catalog_snapshot(self):
        responses = [{'object': {'sha': 'head1'}}, {'tree': {'sha': 'tree1'}},
                     {'tree': [{'path': 'catalog.json', 'sha': 'catalog-blob'}]},
                     {'object': {'sha': 'head1'}}]
        with patch('transcript_service.gh_json', side_effect=responses) as github, \
             patch('transcript_service.catalog_content', return_value={'songs': [self.song]}) as catalog:
            config = {'root': str(self.root)}
            self.assertEqual(snapshot(config), snapshot(config))
        self.assertEqual(github.call_count, 4)
        self.assertEqual(catalog.call_count, 1)

    def test_new_and_changed_recordings_are_pending_while_verified_files_and_backoff_are_respected(self):
        self.assertEqual(pending_songs({}, self.current, {}), [self.song])
        current = {**self.current, 'transcripts': {'new-song.whisper.json': 'blob1'}}
        state = {}
        with patch('transcript_service.read_transcript', return_value=self.draft) as read:
            self.assertEqual(pending_songs({}, current, state), [])
            self.assertEqual(pending_songs({}, current, state), [])
            self.assertEqual(read.call_count, 1)
            changed = {**current, 'songs': [{**self.song, 'url': self.song['url'].replace(self.sha[:12], '0' * 12)}]}
            self.assertEqual(len(pending_songs({}, changed, state)), 1)
        delayed = {'new-song': {'url': self.song['url'], 'retryAfter': time.time() + 100}}
        self.assertEqual(pending_songs({}, self.current, delayed), [])

    def test_publication_retries_on_a_new_git_head_without_force_or_catalog_writes(self):
        calls, refs = [], 0
        def github(config, args, body):
            nonlocal refs
            calls.append((args, body))
            if args[1].endswith('/git/trees'):
                return {'sha': 'new-tree'}
            if args[1].endswith('/git/commits'):
                return {'sha': 'new-commit'}
            refs += 1
            if refs == 1:
                raise RuntimeError('HTTP 422 branch moved')
            return {}
        latest = {**self.current, 'head': 'head2', 'tree': 'tree2'}
        with patch('transcript_service.snapshot', side_effect=[self.current, latest]), \
             patch('transcript_service.gh_json', side_effect=github):
            self.assertEqual(publish_batch({}, [self.draft]), 'new-commit')
        trees = [body for args, body in calls if args[1].endswith('/git/trees')]
        self.assertEqual([body['base_tree'] for body in trees], ['tree1', 'tree2'])
        self.assertTrue(all(body['tree'][0]['path'] == 'lyric-transcripts/new-song.whisper.json' for body in trees))
        updates = [body for args, body in calls if '/git/refs/' in args[1]]
        self.assertEqual(updates, [{'sha': 'new-commit', 'force': False}] * 2)

    def test_already_published_corrections_are_not_overwritten(self):
        current = {**self.current, 'transcripts': {'new-song.whisper.json': 'corrected'}}
        corrected = copy.deepcopy(self.draft)
        corrected['segments'][0]['text'] = 'Manually corrected words'
        with patch('transcript_service.snapshot', return_value=current), \
             patch('transcript_service.read_transcript', return_value=corrected), \
             patch('transcript_service.gh_json') as github:
            self.assertIsNone(publish_batch({}, [self.draft]))
        github.assert_not_called()

    def test_a_scheduled_run_transcribes_a_new_song_and_publishes_only_the_sanitized_draft(self):
        config = {'root': str(self.root), 'python': 'python', 'gh': 'gh', 'basis_root': str(self.root),
                  'speech_root': str(self.root), 'cache': str(self.root / 'private')}
        def recognize_child(command, cwd, log, **options):
            self.assertEqual(command[command.index('--song') + 1], self.song['id'])
            write(self.root / 'drafts/new-song.whisper.json', {**self.draft, 'private': 'omitted'})
        with patch('transcript_service.snapshot', return_value=self.current), \
             patch('transcript_service.run_owned', side_effect=recognize_child), \
             patch('transcript_service.publish_batch', return_value='committed') as publish:
            result = run(config)
        self.assertEqual(result['commit'], 'committed')
        self.assertEqual(publish.call_args.args[1], [self.draft])


if __name__ == '__main__':
    unittest.main()
