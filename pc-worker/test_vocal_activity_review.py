import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from common import save, sha, load
from quality_finish import finish
from renderer import with_quality
from publish import song_record
from quality_configure import compile_policy, review_vocal_activity


class VocalActivityReviewTests(unittest.TestCase):
    def test_converted_export_retains_review_through_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            source = work / 'finish_song.py'
            source.write_text('# frozen finisher')
            save(work / 'arrangement-quality-policy.json', {'validationFailures': ['vocal_activity']})
            save(work / 'track.json', {})
            save(work / 'mix-results.json', {'status': 'completed'})
            with patch('quality_finish.compile_policy', return_value=compile('pass', 'test', 'exec')):
                finish(work, sha(source))
            self.assertEqual(load(work / 'mix-results.json')['validationFailures'], ['vocal_activity'])
            result = with_quality({'work_path': directory, 'title': 'Sparse song', 'duration': 240})
            record = song_record({'songId': 'song', 'releaseUrl': 'https://example.com/song.mp3', 'result': result})
            self.assertEqual(record['reviewState'], 'needs_review')
            self.assertEqual(record['validationFailures'], ['vocal_activity'])

    def test_threshold_and_invalid_evidence(self):
        for value, accepted in [(0, False), (.04999, False), (.05, True), (.1, True), (.394, True)]:
            failures = []
            self.assertEqual(review_vocal_activity({'voiced_energy_fraction': value}, failures), accepted)
            self.assertEqual(failures, ['vocal_activity'] if accepted else [])
        for value in [None, float('nan'), float('inf'), -1, 2]:
            with self.assertRaises(ValueError): review_vocal_activity({'voiced_energy_fraction': value}, [])

    def test_sparse_recording_converts_with_review_and_ending_still_checked(self):
        source = """assert first<13,('Long instrumental introduction',evidence)
assert float(mask.mean())>=.50,('Insufficient vocal signal activity',evidence)
assert last-first>duration*.6 and max([g['seconds'] for g in gaps],default=0)<9.5,('Too much instrumental space',evidence)
assert ending_ok, 'Ending needs completion'
converted=True
"""
        code = compile_policy(source, 'saved.py')
        for activity in [.049, .05, .1, .394, .7]:
            for ending in [False, True]:
                failures = []
                class Mask:
                    def mean(self): return activity
                values = dict(first=2, last=20 if activity < .5 else 230, duration=240,
                              gaps=[], mask=Mask(), evidence={'voiced_energy_fraction': activity}, ending_ok=ending,
                              _distonyc_review_intro=lambda first: None, _distonyc_review_breaks=lambda gaps: None,
                              _distonyc_review_vocal_activity=lambda evidence: review_vocal_activity(evidence, failures))
                if activity < .05 or not ending:
                    with self.assertRaises(AssertionError): exec(code, values)
                else:
                    exec(code, values)
                    self.assertTrue(values['converted'])
                    self.assertEqual(failures, ['vocal_activity'] if activity < .5 else [])
