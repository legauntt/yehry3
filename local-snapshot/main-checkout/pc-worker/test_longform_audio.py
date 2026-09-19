"""Private synthetic signal checks; no music model, singer, or publication."""
import copy
import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

from common import load, save, sha
from longform import join_wavs, master
from renderer import module_at
from test_duration import ENGINE, suite_plan

FFMPEG = Path(r'C:\utilz\ffmpeg-custom\bin\ffmpeg.exe')
SR = 44100


class LongformAudioTests(unittest.TestCase):
    def test_join_preserves_every_pcm_sample_including_quiet_tails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); paths = []; original = []
            for index in range(3):
                signal = np.random.default_rng(index).uniform(-.2, .2, (SR, 2)).astype('float32')
                signal[-1000:] *= .00001
                path = root / f'{index}.wav'; sf.write(path, signal, SR, subtype='PCM_24')
                paths.append(path); original.append(sf.read(path, dtype='int32', always_2d=True)[0])
            destination = root / 'joined.wav'
            self.assertEqual(join_wavs(paths, destination), SR * 3)
            actual, rate = sf.read(destination, dtype='int32', always_2d=True)
            np.testing.assert_array_equal(actual, np.concatenate(original))
            self.assertEqual(rate, SR)
            bad = root / 'bad.wav'; sf.write(bad, np.zeros((100, 2)), 48000)
            with self.assertRaisesRegex(ValueError, 'format'): join_wavs([bad], root / 'bad-output.wav')

    @unittest.skipUnless(FFMPEG.exists() and ENGINE.exists(), 'Local FFmpeg and engine integration')
    def test_full_nineteen_minute_master_passes_real_delivery_verification(self):
        with tempfile.TemporaryDirectory(prefix='distonyc-synthetic-') as directory:
            root = Path(directory); work = root / 'suite'; work.mkdir()
            private = work / 'private-movements'; private.mkdir()
            output = root / 'public'; cat = root / 'catalog-expansion-v6'; cat.mkdir()
            adapter = cat / 'tony-catalog-adapter.pt'; adapter.write_bytes(b'synthetic-test-model-identity')
            spec = suite_plan(); save(work / 'spec.json', {'kind': 'new', **spec})
            snapshot = work / 'finish_suite.py'; shutil.copy2(Path(__file__).with_name('longform.py'), snapshot)
            parts = []
            for index in range(5):
                source = root / f'movement-{index}'; source.mkdir()
                wav = private / f'{index}.wav'
                t = np.arange(SR, dtype='float32') / SR
                tone = np.column_stack([.12 * np.sin(2 * np.pi * (220 + index * 22) * t)] * 2)
                with sf.SoundFile(wav, 'w', samplerate=SR, channels=2, subtype='PCM_24') as audio:
                    for _ in range(227): audio.write(tone)
                    audio.write(np.zeros((SR, 2), dtype='float32'))
                report = {'status': 'completed', 'title': f'Synthetic movement {index}', 'duration': 228,
                          'voice_checks': {'passed': True, 'synthetic_fixture': True},
                          'longest_missing_vocal_run_seconds': 0, 'final_post_vocal_seconds': 4,
                          'arrangement': {'first_detected_voice': 1}, 'qualityIssues': [],
                          'files': [{'file': str(wav), 'bytes': wav.stat().st_size, 'sha256': sha(wav)}]}
                save(source / 'mix-results.json', report)
                save(source / 'track.json', {'title': report['title'], 'model_sha256': sha(adapter)})
                parts.append({'number': index + 1, 'result': {'status': 'verified', 'work_path': str(source)},
                              'mix_report_sha256': sha(source / 'mix-results.json')})
            journal = {'title': 'Synthetic assembly verification', 'requested_duration': 1140,
                       'spec_sha256': sha(work / 'spec.json'), 'finisher_sha256': sha(snapshot), 'parts': parts,
                       'settings': {'output_dir': str(output), 'ffmpeg': str(FFMPEG)}}
            save(work / 'suite-job.json', journal)
            master(work)
            engine = module_at('longform_delivery_test', ENGINE)
            result = engine.verify_work(work, output)
            self.assertEqual(result['status'], 'verified')
            self.assertEqual(result['duration'], 1140)
            report = load(work / 'mix-results.json')
            self.assertEqual(report['sample_difference'], 0)
            self.assertEqual([r['start'] for r in report['chapters']], [0, 228, 456, 684, 912])
            self.assertEqual(len(list(output.rglob('*.*'))), 2)
            self.assertTrue(all(Path(item['path']).is_relative_to(output) for item in result['files']))
            final_hashes = [sha(item['path']) for item in result['files']]
            # A corrupt or changed finished movement cannot be silently rebuilt.
            broken = copy.deepcopy(parts[0]); source = Path(broken['result']['work_path'])
            save(source / 'mix-results.json', {})
            with self.assertRaisesRegex(ValueError, 'report changed'): master(work)
            self.assertEqual([sha(item['path']) for item in result['files']], final_hashes)


if __name__ == '__main__': unittest.main()
