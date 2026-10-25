import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from common import save
from review_measurements import measurements, backfill

class ReviewMeasurementsTests(unittest.TestCase):
    def test_saved_error_is_reduced_to_numeric_public_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            save(work / 'arrangement-checks.json', {'voiced_energy_fraction': .394})
            save(work / 'desktop-status.json', {'error': "private/path\nAssertionError: ('Insufficient mutually voiced frames in pitched source', {'label': 'phrase-001', 'source_voiced_frames': 16, 'converted_voiced_frames': 6, 'analyzed_frames': 929})"})
            rows = measurements(work)
            self.assertEqual(rows[0]['fraction'], .394)
            self.assertEqual(rows[1]['convertedFrames'], 6)
            self.assertNotIn('private', str(rows))
            save(work / 'arrangement-checks.json', {'voiced_energy_fraction': float('nan')})
            save(work / 'desktop-status.json', {'error': "Insufficient mutually voiced frames in pitched source', {'label': '<script>'}"})
            self.assertEqual(measurements(work), [])

    def test_backfill_pins_recording_and_preserves_catalog_fields(self):
        import base64
        import json
        activity = {'code': 'vocal_activity_check', 'fraction': .394, 'requiredFraction': .5, 'minimumFraction': .05}
        class API:
            def call(self, path, body):
                self.path, self.body = path, body
                return {'ok': True, 'qualityIssues': [activity]}
        api = API()
        catalog = {'songs': [{'id': 'song', 'url': 'same.mp3', 'title': 'Keep this', 'guide': {'url': 'guide.mp3'}}]}
        with patch('review_measurements.measurements', return_value=[activity]), patch('publish.catalog_content', return_value=catalog), patch('publish.gh_json', side_effect=[{'sha': 'revision'}, {}]) as gh:
            backfill({}, api, 'song', 'same.mp3', '.')
            updated = json.loads(base64.b64decode(gh.call_args.args[2]['content']))['songs'][0]
            self.assertEqual(updated['guide'], {'url': 'guide.mp3'})
            self.assertEqual(updated['title'], 'Keep this')
            self.assertEqual(updated['qualityIssues'], [activity])
            self.assertEqual(api.body['url'], 'same.mp3')
        with patch('review_measurements.measurements', return_value=[activity]), patch('publish.catalog_content', return_value=catalog), patch('publish.gh_json', return_value={'sha': 'revision'}) as gh:
            with self.assertRaisesRegex(ValueError, 'recording changed'):
                backfill({}, api, 'song', 'different.mp3', '.')
            self.assertEqual(gh.call_count, 1)
