import unittest
import numpy as np
from vocal_evidence import confirmed_bleed, longest_run, spectral_evidence


class VocalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.t = np.arange(44100 * 3) / 44100
        self.a, self.b = 44100, 44100 + 8820

    def tone(self, frequency=350, phase=np.pi / 2):
        return .08 * np.stack([np.sin(2 * np.pi * frequency * self.t),
                               np.sin(2 * np.pi * frequency * self.t + phase)], axis=1)

    def inspect(self, source, backing):
        return spectral_evidence(source, backing, self.a, self.b)

    def test_shared_diffuse_tone_requires_no_pitch_in_every_source_channel(self):
        source = self.tone()
        evidence = self.inspect(source, source * 2)
        self.assertTrue(evidence['spectral_candidate'])
        self.assertFalse(confirmed_bleed(evidence))
        self.assertTrue(confirmed_bleed({**evidence, 'source_voiced_frames': [0, 0, 0]}))
        for pitch in ([1, 0, 0], [0, 1, 0], [0, 0, 1]):
            self.assertFalse(confirmed_bleed({**evidence, 'source_voiced_frames': pitch}))

    def test_centered_low_note_is_protected_even_when_backing_contains_it(self):
        source = self.tone(phase=0)
        self.assertFalse(self.inspect(source, source).get('spectral_candidate', False))

    def test_broadband_consonants_and_quiet_high_frequency_tails_are_protected(self):
        for source in (self.tone(3500), self.tone(3500) * .08,
                       np.random.default_rng(4).normal(0, .04, (len(self.t), 2))):
            self.assertFalse(self.inspect(source, source).get('spectral_candidate', False))

    def test_unrelated_backing_and_phase_mismatch_cannot_exempt_source_sound(self):
        source = self.tone()
        for backing in (self.tone(220), -source):
            self.assertFalse(self.inspect(source, backing).get('spectral_candidate', False))

    def test_missing_run_keeps_exact_original_point_four_second_limit(self):
        self.assertEqual(longest_run([201.2, 201.4, 202.0, 202.2]), .4)
        self.assertEqual(longest_run([182.2, 182.4, 182.6]), .6)
        self.assertEqual(longest_run([]), 0)


if __name__ == '__main__': unittest.main()
