import array
import math
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
from common import save, sha
from audio_editor import render, run, vocal_regions, analyze, validate_job

FFMPEG = os.environ.get('FFMPEG') or shutil.which('ffmpeg') or r'C:\utilz\ffmpeg-custom\bin\ffmpeg.exe'


class AudioEditorTests(unittest.TestCase):
    def test_isolated_vocals_regions_and_silence(self):
        samples = array.array('f', (0.2 * math.sin(i * .35) if 8000 <= i < 16000 or 28000 <= i < 36000 else 0 for i in range(48000)))
        self.assertEqual(vocal_regions(samples), [[.92, 2.08], [3.42, 4.58]])
        self.assertEqual(vocal_regions(array.array('f', [0] * 16000)), [])

    @unittest.skipUnless(Path(FFMPEG).is_file(), 'FFmpeg is required for audio verification')
    def test_real_mp3_crop_fade_original_preservation_and_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); original = root / 'original.mp3'
            run([FFMPEG, '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:a', 'libmp3lame', original])
            digest = sha(original)
            source = {'url': f'https://github.com/legauntt/yehry3/releases/download/distonyc-v1/test-{digest[:12]}.mp3', 'duration': 8}
            save(root / 'source.json', {'url': source['url'], 'sha256': digest})
            job = {'kind': 'render', 'source': source, 'end': 5, 'fade': 2}
            config = {'settings': {'ffmpeg': FFMPEG}}
            output, result = render(config, job, root)
            self.assertAlmostEqual(result['duration'], 5, delta=.15)
            self.assertEqual(sha(original), digest)
            samples = array.array('f'); samples.frombytes(run([FFMPEG, '-v', 'error', '-i', output, '-f', 'f32le', '-ac', '1', '-ar', '8000', '-']))
            rms = lambda a, b: math.sqrt(sum(v * v for v in samples[int(a * 8000):int(b * 8000)]) / ((b - a) * 8000))
            self.assertGreater(rms(1, 2), .05)
            self.assertLess(rms(4.8, 4.95), rms(1, 2) * .12)
            with patch('audio_editor.run', side_effect=AssertionError('Re-encoding is not needed')), patch('audio_editor.probe', return_value=8):
                self.assertEqual(render(config, job, root)[1], result)
            self.assertNotEqual(result['sha256'], digest)

    def test_wrong_source_and_invalid_crop_are_rejected(self):
        base = {'songId': 'test', 'editId': 'a' * 36, 'kind': 'render', 'source': {'url': 'http://127.0.0.1/private.mp3', 'duration': 8}, 'end': 5, 'fade': 2}
        with self.assertRaises(ValueError): validate_job(base)

    def test_missing_stems_and_transcript_have_explicit_unavailable_result(self):
        import urllib.error
        with tempfile.TemporaryDirectory() as temporary, patch('urllib.request.urlopen', side_effect=urllib.error.HTTPError('url', 404, 'missing', {}, None)):
            result = analyze({'basis_root': temporary}, {'songId': 'test', 'source': {'url': 'https://yehry3.app/test.mp3', 'duration': 8}})
            self.assertEqual(result, {'method': 'unavailable', 'regions': []})

    def test_transcript_fallback_is_bound_to_recording(self):
        import io, json
        value = {'songId': 'test', 'audioUrl': 'https://yehry3.app/test.mp3', 'audioSha256': 'a' * 64, 'duration': 8, 'segments': [{'start': 1, 'end': 3}]}
        with tempfile.TemporaryDirectory() as temporary:
            job = {'songId': 'test', 'source': {'url': value['audioUrl'], 'duration': 8}}
            with patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(value).encode())):
                self.assertEqual(analyze({'basis_root': temporary}, job), {'method': 'transcript', 'regions': [[1, 3]]})
            value['audioUrl'] += '?different'
            with patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(value).encode())):
                self.assertEqual(analyze({'basis_root': temporary}, job)['method'], 'unavailable')


if __name__ == '__main__': unittest.main()
