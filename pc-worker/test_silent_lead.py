"""The voice interval skips only an introduction with nothing above the assembler's activity floor."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

from common import load, save
from inactive_voice_repair import SR, inactive_rows
from quality_configure import trim_silent_lead


class SilentLeadTests(unittest.TestCase):
    def work(self, sounds, duration=60, channels=2):
        """`sounds` are (start, stop, amplitude, phase) tones on top of digital silence."""
        directory = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__('shutil').rmtree(directory, ignore_errors=True))
        time = np.arange(SR * duration) / SR
        audio = np.zeros((len(time), 2), dtype='float32')
        for start, stop, amplitude, phase in sounds:
            live = (time >= start) & (time < stop)
            tone = (amplitude * np.sin(2 * np.pi * 180 * time[live])).astype('float32')
            audio[live, 0] += tone
            audio[live, 1] += tone * phase
        sf.write(directory / 'selected-vocals.wav', audio, SR, subtype='FLOAT')
        save(directory / 'voice-interval.json', {'interval': [0., duration - 3], 'basis': 'Retain the entire introduction'})
        return directory

    def assertStart(self, config, expected):
        # The 25 ms envelope window starts the measured sound a hair early; that is the safe direction.
        self.assertAlmostEqual(config['interval'][0], expected, delta=.05)
        self.assertLessEqual(config['interval'][0], expected)

    def test_a_silent_introduction_is_skipped_up_to_a_margin_before_the_first_sound(self):
        work = self.work([(30, 55, .2, 1)])
        config = trim_silent_lead(work)
        self.assertStart(config, 27.)
        self.assertEqual(config['interval'][1], 57.)
        self.assertEqual(config['silent_lead']['original_start'], 0.)
        self.assertAlmostEqual(config['silent_lead']['first_sound_seconds'], 30, delta=.05)
        self.assertEqual(load(work / 'voice-interval.json'), config)

    def test_a_quiet_chuckle_above_the_floor_keeps_the_whole_introduction(self):
        work = self.work([(10, 11, .004, 1), (30, 55, .2, 1)])
        self.assertStart(trim_silent_lead(work), 7.)
        work = self.work([(4, 5, .004, 1), (30, 55, .2, 1)])
        self.assertNotIn('silent_lead', trim_silent_lead(work))

    def test_opposite_phase_singing_is_not_hidden_by_the_mono_sum(self):
        work = self.work([(20, 55, .2, -1)])
        self.assertStart(trim_silent_lead(work), 17.)
        work = self.work([(3, 55, .2, -1)])
        self.assertNotIn('silent_lead', trim_silent_lead(work))

    def test_a_short_lead_and_an_all_silent_source_are_left_alone(self):
        for sounds in ([(6, 55, .2, 1)], []):
            work = self.work(sounds)
            self.assertEqual(trim_silent_lead(work)['interval'], [0., 57.])
            self.assertNotIn('silent_lead', load(work / 'voice-interval.json'))

    def test_it_is_idempotent_across_a_resumed_configure(self):
        work = self.work([(30, 55, .2, 1)])
        first = trim_silent_lead(work)
        self.assertEqual(trim_silent_lead(work), first)

    def test_the_skipped_lead_leaves_no_phrase_the_assembler_would_reject(self):
        work = self.work([(30, 55, .2, 1)])
        start, stop = trim_silent_lead(work)['interval']
        rows = [{'label': 'phrase-%03d' % index, 'interval': [a, min(a + 9.4, stop)]}
                for index, a in enumerate(np.arange(start, stop - 1, 8.6), 1)]
        self.assertEqual(inactive_rows(work, rows), [])
        whole = [{'label': 'phrase-%03d' % index, 'interval': [a, a + 9.4]} for index, a in enumerate(np.arange(0, 47, 8.6), 1)]
        self.assertTrue(inactive_rows(work, whole))  # the untrimmed layout is what crashed the assembler


if __name__ == '__main__': unittest.main()
