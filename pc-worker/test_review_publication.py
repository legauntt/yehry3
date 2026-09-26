"""Synthetic audio exercises the real review export; no paid/GPU model is invoked."""
import shutil
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import soundfile as sf
from common import load, save, sha
from review_publication import classify, execute, export, verify

FFMPEG = Path(r'C:\utilz\ffmpeg-custom\bin\ffmpeg.exe')


class ReviewPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name) / 'song'
        self.work.mkdir()
        self.output = Path(self.temp.name) / 'output'
        self.settings = {'output_dir': str(self.output), 'ffmpeg': str(FFMPEG)}
        self.model = self.work.parent / 'catalog-expansion-v6/tony-catalog-adapter.pt'
        self.model.parent.mkdir()
        self.model.write_bytes(b'synthetic model identity')
        save(self.work / 'track.json', {'title': 'Retained test', 'duration': 6, 'model_sha256': sha(self.model)})
        save(self.work / 'desktop-job.json', {'kind': 'new', 'track_sha256': sha(self.work / 'track.json'),
              'workers': {}, 'settings': self.settings})
        save(self.work / 'desktop-status.json', {'status': 'failed', 'stage': 'configure',
              'error': "AssertionError: ('Insufficient vocal signal activity', {})"})

    def policy(self):
        save(self.work / 'validation-publication.json', {'version': 1, 'validationFailures': ['vocal_activity'],
              'manifest_sha256': sha(self.work / 'desktop-job.json'), 'allow_generated': True})

    def audio(self, name, frames=6*44100):
        t = np.arange(frames) / 44100
        signal = .08 * np.sin(2 * np.pi * 220 * t)
        samples = np.column_stack([signal, signal]).astype('float32')
        sf.write(self.work / name, samples, 44100, subtype='FLOAT')
        return samples

    def test_only_actual_quality_failures_are_eligible(self):
        self.assertEqual(classify(self.work, RuntimeError('stage failed')), ['vocal_activity'])
        for stage, error, expected in [
            ('validate', "assert item['median_pitch_error_cents']<60,item\nAssertionError: {}", ['voice_validation']),
            ('validate', "assert sha(checkpoint_path) == expected\nAssertionError", []),
            ('finish', "AssertionError: Missing vocal phrase", ['vocal_dropout']),
            ('finish', "OSError: unavailable file", []),
            ('configure', "AssertionError: Insufficient vocal signal activity\nOSError: unavailable file", []),
            ('configure', "ValueError: Frozen inputs changed", []),
        ]:
            save(self.work / 'desktop-status.json', {'status': 'failed', 'stage': stage, 'error': error})
            self.assertEqual(classify(self.work, RuntimeError(error)), expected)

    def test_post_stage_integrity_error_keeps_its_cause_when_stage_error_is_null(self):
        save(self.work / 'desktop-status.json', {'status': 'running', 'stage': 'analysis', 'error': None})
        self.assertEqual(classify(self.work, ValueError('Saved review report changed')), [])

    @unittest.skipUnless(FFMPEG.is_file(), 'Local FFmpeg required for real encoding')
    def test_generated_performance_is_playable_and_explicitly_flagged(self):
        source = self.audio('selected-mix.wav')
        original_hash = sha(self.work / 'selected-mix.wav')
        self.policy()
        result = export(self.work)
        self.assertEqual(result['duration'], 6)
        self.assertEqual(result['reviewState'], 'needs_review')
        self.assertIn('unconverted_vocals', result['validationFailures'])
        wav = next(row['path'] for row in result['files'] if row['path'].endswith('.wav'))
        decoded, _ = sf.read(wav, dtype='float32', always_2d=True)
        self.assertEqual(decoded.shape, source.shape)
        self.assertLess(float(np.max(np.abs(decoded - source))), 2e-7)
        self.assertEqual(sha(self.work / 'selected-mix.wav'), original_hash)
        self.assertEqual(export(self.work), result)  # restart reuses verified artifacts
        self.assertFalse(load(self.work / 'mix-results.json')['voice_checks']['passed'])
        self.assertFalse(load(self.work / 'mix-results.json')['vocal_dropout_measured'])
        save(self.work / 'spec.json', {'kind': 'new', 'lyrics': 'The retained lyric sheet.'})
        from worker import metadata
        _, meta = metadata({'settings': {**self.settings, 'studio_dir': str(self.work / 'studio')}},
                           {'title': 'Retained test'}, result)
        self.assertEqual(meta['validationFailures'], result['validationFailures'])
        with Path(wav).open('ab') as stream: stream.write(b'changed')
        with self.assertRaisesRegex(ValueError, 'changed or is missing'):
            verify(self.work, self.output)

    @unittest.skipUnless(FFMPEG.is_file(), 'Local FFmpeg required for real encoding')
    def test_complete_converted_mix_is_preferred_and_lengths_are_enforced(self):
        self.audio('selected-mix.wav')
        self.audio('matched-vocals.wav')
        self.audio('selected-backing.wav')
        self.policy()
        result = export(self.work)
        self.assertNotIn('unconverted_vocals', result['validationFailures'])
        self.assertEqual(result['duration'], 6)
        self.assertEqual(verify(self.work, self.output), result)
        save(self.work / 'track.json', {'changed': True})
        with self.assertRaisesRegex(ValueError, 'track changed'):
            verify(self.work, self.output)

    def test_incomplete_audio_and_missing_outputs_still_stop(self):
        self.audio('matched-vocals.wav')
        self.audio('selected-backing.wav', frames=5*44100)
        self.policy()
        with self.assertRaisesRegex(ValueError, 'lengths differ'):
            export(self.work)
        self.assertFalse((self.work / 'review-delivery.json').exists())

    @unittest.skipUnless(FFMPEG.is_file(), 'Local FFmpeg required for real encoding')
    def test_review_movements_remain_flagged_in_the_complete_suite(self):
        from longform import master
        suite = Path(self.temp.name) / 'suite'
        suite.mkdir()
        private = suite / 'private-movements'
        save(suite / 'spec.json', {'movements': [{}, {}, {}], 'lyrics': 'Complete suite lyrics'})
        shutil.copy2(Path(__file__).with_name('longform.py'), suite / 'finish_suite.py')
        parts = []
        for index in range(3):
            self.work = Path(self.temp.name) / ('movement-' + str(index))
            self.work.mkdir()
            save(self.work / 'track.json', {'title': 'Movement', 'duration': 40, 'model_sha256': sha(self.model)})
            save(self.work / 'desktop-job.json', {'kind': 'new', 'track_sha256': sha(self.work / 'track.json'),
                 'workers': {}, 'settings': {**self.settings, 'output_dir': str(private)}})
            self.audio('selected-mix.wav', frames=40*44100)
            self.policy()
            result = export(self.work)
            parts.append({'number': index + 1, 'result': result, 'mix_report_sha256': sha(self.work / 'mix-results.json')})
        save(suite / 'suite-job.json', {'title': 'Review suite', 'parts': parts, 'settings': self.settings,
             'spec_sha256': sha(suite / 'spec.json'), 'finisher_sha256': sha(suite / 'finish_suite.py')})
        master(suite)
        report = load(suite / 'mix-results.json')
        self.assertEqual(report['duration'], 120)
        self.assertEqual(report['reviewState'], 'needs_review')
        self.assertIn('unconverted_vocals', report['validationFailures'])
        self.assertFalse(report['voice_checks']['passed'])

    def test_engine_error_reaches_review_export_and_cancellation_does_not(self):
        engine = SimpleNamespace(execute_stages=lambda *a, **k: (_ for _ in ()).throw(RuntimeError('quality')),
                                 validate_saved=lambda *a: None)
        request = {'config': {'settings': {**self.settings, 'voice_python': 'test-python'}}}
        with patch('review_publication.subprocess.run') as run, patch('review_publication.verify', return_value={'status': 'verified'}):
            self.assertEqual(execute(engine, request, self.work, {}), {'status': 'verified'})
            run.assert_called_once()
            self.assertEqual(load(self.work / 'validation-publication.json')['validationFailures'], ['vocal_activity'])
        engine.execute_stages = lambda *a, **k: (_ for _ in ()).throw(KeyboardInterrupt())
        with patch('review_publication.subprocess.run') as run:
            with self.assertRaises(KeyboardInterrupt): execute(engine, request, self.work, {})
            run.assert_not_called()

    @unittest.skipUnless(FFMPEG.is_file() and (Path.home() / 'code/troofs-desktop/worker/engine_tasks.py').is_file(), 'Installed engine integration')
    def test_actual_stage_failure_produces_review_delivery_without_marking_check_passed(self):
        engine_path = Path.home() / 'code/troofs-desktop/worker/engine_tasks.py'
        spec = importlib.util.spec_from_file_location('review_test_engine', engine_path)
        engine = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(engine)
        model = self.work.parent / 'catalog-expansion-v6'
        model.mkdir(exist_ok=True)
        (model / 'tony-catalog-adapter.pt').write_bytes(b'synthetic model identity')
        save(self.work / 'track.json', {'title': 'Retained test', 'duration': 6, 'model_sha256': sha(model / 'tony-catalog-adapter.pt')})
        self.audio('selected-mix.wav')
        manifest = load(self.work / 'desktop-job.json')
        manifest.update(track_sha256=sha(self.work / 'track.json'), tasks=[{'name':'configure',
                        'command':[sys.executable, '-c', "assert False, 'Insufficient vocal signal activity'"]}])
        save(self.work / 'desktop-job.json', manifest)
        save(self.work / 'desktop-status.json', {'status':'ready', 'completed':[]})
        request = {'config': {'settings': {**self.settings, 'voice_python':sys.executable}}}
        result = execute(engine, request, self.work, manifest)
        self.assertEqual(result['reviewState'], 'needs_review')
        self.assertEqual(load(self.work / 'desktop-status.json')['status'], 'failed')
        self.assertIn('unconverted_vocals', result['validationFailures'])

    def recovery_engine(self, outcomes):
        calls = []
        def stages(*a, **k):
            calls.append('stages'); outcome = outcomes[len(calls) - 1]
            if isinstance(outcome, Exception): raise outcome
            return outcome
        return SimpleNamespace(execute_stages=stages, validate_saved=lambda *a: None), calls

    def assembly_failure(self):
        save(self.work / 'desktop-status.json', {'status': 'failed', 'stage': 'assemble',
              'error': 'Traceback (most recent call last):\n  assert active.any()\nAssertionError\n'})

    def test_silent_section_is_repaired_in_the_same_attempt_and_the_song_finishes(self):
        self.assembly_failure()
        engine, calls = self.recovery_engine([RuntimeError('assemble'), {'status': 'verified', 'finished': True}])
        request = {'config': {'settings': {**self.settings, 'voice_python': 'test-python'}}, 'voice_model': 'v9'}
        with patch('review_publication.inactive_recovery.recover', return_value=True) as recover,                 patch('review_publication.subprocess.run') as export_run:
            self.assertEqual(execute(engine, request, self.work, {}), {'status': 'verified', 'finished': True})
            recover.assert_called_once()
            export_run.assert_not_called()  # never reached the generated-singer review export
        self.assertEqual(len(calls), 2)
        self.assertFalse((self.work / 'validation-publication.json').exists())

    def test_a_repair_the_limits_reject_still_ends_in_the_honest_review_export(self):
        self.assembly_failure()
        engine, calls = self.recovery_engine([RuntimeError('assemble')])
        request = {'config': {'settings': {**self.settings, 'voice_python': 'test-python'}}, 'voice_model': 'v9'}
        with patch('review_publication.inactive_recovery.recover', return_value=False),                 patch('review_publication.subprocess.run'), patch('review_publication.verify', return_value={'status': 'verified'}):
            self.assertEqual(execute(engine, request, self.work, {}), {'status': 'verified'})
        self.assertEqual(len(calls), 1)
        self.assertEqual(load(self.work / 'validation-publication.json')['validationFailures'], ['voice_validation'])

    def test_repair_that_resumes_into_a_new_quality_failure_uses_that_failure(self):
        self.assembly_failure()
        engine, calls = self.recovery_engine([RuntimeError('assemble'), RuntimeError('validate')])
        def repaired(work, settings):
            save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'validate',
                  'error': "assert item['median_pitch_error_cents']<60,item\nAssertionError: {}"})
            return True
        request = {'config': {'settings': {**self.settings, 'voice_python': 'test-python'}}, 'voice_model': 'v9'}
        with patch('review_publication.inactive_recovery.recover', side_effect=repaired),                 patch('review_publication.subprocess.run'), patch('review_publication.verify', return_value={'status': 'verified'}):
            execute(engine, request, self.work, {})
        self.assertEqual(load(self.work / 'validation-publication.json')['validationFailures'], ['voice_validation'])

    def test_v6_and_other_failures_never_invoke_the_recovery(self):
        self.assembly_failure()
        for model, status in (('v6', None), ('v9', {'status': 'failed', 'stage': 'finish', 'error': 'OSError: disk'})):
            if status: save(self.work / 'desktop-status.json', status)
            engine, _ = self.recovery_engine([RuntimeError('boom')])
            request = {'config': {'settings': {**self.settings, 'voice_python': 'test-python'}}, 'voice_model': model}
            with patch('review_publication.inactive_recovery.recover') as recover,                     patch('review_publication.subprocess.run'), patch('review_publication.verify', return_value={}):
                try: execute(engine, request, self.work, {})
                except RuntimeError: pass
            recover.assert_not_called()


if __name__ == '__main__': unittest.main()
