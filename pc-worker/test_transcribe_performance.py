import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from transcribe_performance import digest, performance_source, public_draft, recognize, vocal_windows, write


class PerformanceTranscriptionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / 'published' / 'song-1' / 'archive'
        self.folder.mkdir(parents=True)
        recording, vocals = self.folder / 'recording.mp3', self.folder / 'vocals.wav'
        recording.write_bytes(b'the exact released Tony mix')
        vocals.write_bytes(b'the converted Tony voice')
        self.song = {'id': 'song-1', 'url': f'https://example.test/song-{digest(recording)[:12]}.mp3',
                     'duration': 20, 'lyrics': {'text': 'These are the intended words'}}
        self.manifest = {'source': {'songId': 'song-1', 'url': self.song['url'],
                                    'sha256': digest(recording), 'bytes': recording.stat().st_size},
                         'material': {'vocal_reference_sha256': digest(vocals),
                                      'vocal_reference_path': 'C:\\production\\matched-vocals.wav'}}
        self.save_manifest()

    def save_manifest(self):
        write(self.folder / 'source.json', self.manifest)

    def test_pins_both_released_recording_and_converted_tony_vocals(self):
        source = performance_source(self.song, self.root)
        self.assertEqual(source['vocals'], (self.folder / 'vocals.wav').resolve())
        (self.folder / 'recording.mp3').write_bytes(b'a different performance')
        with self.assertRaisesRegex(ValueError, 'published identity'):
            performance_source(self.song, self.root)

    def test_rejects_replaced_vocals_and_guide_singer(self):
        (self.folder / 'vocals.wav').write_bytes(b'a different voice')
        with self.assertRaisesRegex(ValueError, 'vocal stem'):
            performance_source(self.song, self.root)
        self.manifest['material']['vocal_reference_sha256'] = digest(self.folder / 'vocals.wav')
        self.manifest['material']['vocal_reference_path'] = 'C:/production/selected-vocals.wav'
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, 'guide vocal'):
            performance_source(self.song, self.root)

    def test_recognizer_receives_audio_without_lyric_prompts(self):
        model = Mock()
        word = SimpleNamespace(word=' Actually', start=1, end=2, probability=.9)
        segment = SimpleNamespace(start=1, end=2, text=' Actually', avg_logprob=-.2,
                                  no_speech_prob=.01, words=[word])
        model.transcribe.return_value = (iter([segment]), SimpleNamespace(duration=20))
        rows, duration = recognize(model, self.folder / 'vocals.wav')
        args, kwargs = model.transcribe.call_args
        self.assertEqual(args, (str(self.folder / 'vocals.wav'),))
        self.assertIsNone(kwargs['initial_prompt'])
        self.assertIsNone(kwargs['prefix'])
        self.assertFalse(kwargs['condition_on_previous_text'])
        self.assertNotIn('hotwords', kwargs)
        draft = public_draft(self.song, performance_source(self.song, self.root), rows, 'test', duration)
        self.assertEqual(draft['segments'][0]['text'], 'Actually')
        self.assertEqual(self.song['lyrics']['text'], 'These are the intended words')
        self.assertEqual(draft['review'], 'machine')
        self.assertNotIn('words', draft['segments'][0])

    def test_empty_or_invalid_recognition_cannot_become_supplied_lyrics(self):
        source = performance_source(self.song, self.root)
        with self.assertRaisesRegex(ValueError, 'No words'):
            public_draft(self.song, source, [], 'test', 20)
        with self.assertRaisesRegex(ValueError, 'duration differs'):
            public_draft(self.song, source, [], 'test', 70)

    def test_repeated_character_artifacts_stay_uncertain_despite_model_confidence(self):
        source = performance_source(self.song, self.root)
        rows = [{'start': 1, 'end': 3, 'text': 'Ye' + 'a' * 100, 'avg_logprob': -.1,
                 'no_speech_prob': .01, 'words': []}]
        draft = public_draft(self.song, source, rows, 'test', 20)
        self.assertTrue(draft['segments'][0]['uncertain'])
        self.assertEqual(draft['segments'][0]['text'], rows[0]['text'])

    def test_phrase_detection_excludes_silence_and_keeps_sustained_singing(self):
        import numpy as np
        audio = np.zeros(20 * 16000, dtype=np.float32)
        audio[3 * 16000:5 * 16000] = .1
        audio[12 * 16000:17 * 16000] = .03
        self.assertEqual(vocal_windows(audio), [(2.7, 5.3), (11.7, 17.3)])
        self.assertEqual(vocal_windows(np.zeros(16000)), [])


if __name__ == '__main__':
    unittest.main()
