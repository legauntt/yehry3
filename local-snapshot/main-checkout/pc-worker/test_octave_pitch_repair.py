import unittest
import tempfile
from pathlib import Path
import numpy as np
from octave_pitch_repair import SR, patch, pitch_check, fit_context, apply, prepare, save, sha, load


class OctaveRepairTests(unittest.TestCase):
    def test_patch_preserves_pcm_outside_both_crossfades(self):
        rng = np.random.default_rng(17)
        original = rng.uniform(-.1, .1, (3*SR, 2)).astype('float32')
        shifted = rng.uniform(-.1, .1, original.shape).astype('float32')
        result = patch(original, shifted, SR, 2*SR)
        np.testing.assert_array_equal(result[:SR], original[:SR])
        np.testing.assert_array_equal(result[2*SR:], original[2*SR:])
        np.testing.assert_array_equal(result[SR+3000:2*SR-3000], shifted[SR+3000:2*SR-3000])
        np.testing.assert_array_equal(result[SR], original[SR])
        np.testing.assert_array_equal(result[2*SR-1], original[2*SR-1])

    def test_rejects_long_and_nonfinite_replacements(self):
        audio = np.zeros((6*SR, 2), dtype='float32')
        with self.assertRaises(ValueError):
            patch(audio, audio, 0, 5*SR)
        invalid = audio.copy()
        invalid[SR, 0] = np.nan
        with self.assertRaises(ValueError):
            patch(audio, invalid, SR//2, 2*SR)

    def test_pitch_check_keeps_octave_error_fatal(self):
        expected = np.full(100, 440.)
        wrong = pitch_check(expected, expected / 2)
        self.assertEqual(wrong['median_pitch_error_cents'], 1200.)
        self.assertEqual(wrong['median_signed_cents'], -1200.)
        correct = pitch_check(expected, expected)
        self.assertEqual(correct['median_pitch_error_cents'], 0.)
        with self.assertRaises(ValueError):
            pitch_check(expected, np.zeros(100))

    def test_filter_tail_padding_cannot_enter_the_correction(self):
        original = np.zeros((3*SR, 2), dtype='float32')
        shortened = np.ones((3*SR-SR//10, 2), dtype='float32')
        fitted = fit_context(original, shortened, 2*SR)
        self.assertEqual(fitted.shape, original.shape)
        np.testing.assert_array_equal(fitted[:2*SR], shortened[:2*SR])
        with self.assertRaises(ValueError):
            fit_context(original, shortened, 3*SR-SR//20)

    def test_failed_musical_attempt_cannot_be_reset_by_prepare(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            report = work / 'pitch-octave-repair/status.json'
            save(report, {'status': 'failed', 'attempts': 1, 'error': 'Corrected passage still fails pitch'})
            before = sha(report)
            with self.assertRaises(ValueError):
                prepare(work, 'phrase-027', [234.32, 236.33])
            self.assertEqual(sha(report), before)

    def test_partial_application_resumes_only_pinned_replacements(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            root = work / 'pitch-octave-repair'
            root.mkdir()
            first, second = work / 'first.bin', work / 'second.bin'
            first.write_bytes(b'first-original')
            second.write_bytes(b'second-original')
            pins = {'first.bin': sha(first), 'second.bin': sha(second)}
            candidate = root / 'candidate.bin'
            candidate.write_bytes(b'verified replacement')
            expected = sha(candidate)
            save(root / 'status.json', {'status': 'applying', 'label': 'phrase-027',
                'candidate_sha256': {'candidate.bin': expected}, 'source_sha256': pins,
                'replacements': {name: {'source': 'candidate.bin', 'sha256': expected} for name in pins}})
            # Simulate an interruption after one atomic replacement.
            first.write_bytes(candidate.read_bytes())
            result = apply(work)
            self.assertEqual(result['status'], 'applied')
            self.assertEqual(sha(second), expected)
            self.assertEqual(apply(work)['status'], 'applied')
            second.write_bytes(b'unexpected change')
            with self.assertRaises(ValueError):
                apply(work)


if __name__ == '__main__':
    unittest.main()
