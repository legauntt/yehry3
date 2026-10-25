import tempfile
import unittest
from pathlib import Path
from common import save, sha
from instrumental_heavy import compile_policy, review_coverage, verify_intent
from quality_configure import review_breaks, review_intro
from generation_controls import normalize, planning_guidance, arrangement_guidance
from renderer import execution_manifest

SOURCE = """assert voice_ok, 'Missing vocals'
assert first<13,('Long instrumental introduction',evidence)
assert float(mask.mean())>=.50,('Insufficient vocal signal activity',evidence)
assert last-first>duration*.6 and max([g['seconds'] for g in gaps],default=0)<9.5,('Too much instrumental space',evidence)
assert remaining>1.2 or evidence['last_second_mix_dbfs']<-43,('Ending needs completion before fade',evidence)
passed=True
"""


class InstrumentalHeavyTests(unittest.TestCase):
    def run_policy(self, **changes):
        issues = []
        evidence = dict(duration=300., first_detected_voice=70., last_detected_voice=120.,
                        voiced_energy_fraction=.39, last_second_mix_dbfs=-20.)
        evidence.update(changes.pop('evidence', {}))
        namespace = dict(voice_ok=True, first=70., last=120., duration=300., remaining=180.,
                         gaps=[{'seconds': 50.}], evidence=evidence,
                         _review_coverage=lambda data: review_coverage(data, issues),
                         _review_breaks=lambda data: review_breaks(data, issues),
                         _review_intro=lambda data: review_intro(data, issues))
        namespace.update(changes)
        exec(compile_policy(SOURCE, 'fixture.py'), namespace)
        self.assertTrue(namespace['passed'])
        return issues

    def test_explicit_sparse_arrangement_passes_with_measured_notice(self):
        self.assertIn({'code': 'low_vocal_coverage', 'fraction': .39}, self.run_policy())
        with self.assertRaises(AssertionError):
            exec(compile(SOURCE, 'ordinary.py', 'exec'), dict(voice_ok=True, first=70., evidence={}))

    def test_checker_numpy_measurements_are_supported(self):
        import numpy as np
        self.assertIn({'code': 'low_vocal_coverage', 'fraction': .39},
                      self.run_policy(evidence={'first_detected_voice': np.float64(70),
                                                'last_detected_voice': np.float64(120)}))

    def test_empty_invalid_voice_and_ending_still_fail(self):
        with self.assertRaisesRegex(AssertionError, 'Missing vocals'): self.run_policy(voice_ok=False)
        with self.assertRaisesRegex(AssertionError, 'Ending needs'): self.run_policy(remaining=.3)
        for fraction in (0, -1, float('nan'), float('inf'), 1.1, True):
            with self.assertRaises(ValueError): self.run_policy(evidence={'voiced_energy_fraction': fraction})
        with self.assertRaises(ValueError): self.run_policy(evidence={'last_detected_voice': 70.})

    def test_unknown_guards_fail_closed_and_opera_supported(self):
        for source in (SOURCE.replace('>=.50', '>=.40'), SOURCE.replace('<9.5', '<20'), SOURCE + SOURCE):
            with self.assertRaises(ValueError): compile_policy(source, 'changed.py')
        opera = SOURCE.replace('last-first>duration*.6 and max', 'last-first>duration*.7 and max').replace('<9.5', '<16').replace('Too much instrumental space', 'Overlong orchestral gap')
        opera += "assert sum(g['seconds']>9.5 for g in gaps)<=1,('Repeated long instrumental interludes',evidence)\n"
        opera += "assert float(mask.mean())>=.65,('Insufficient lead vocal coverage for this opera',evidence)\n"
        compile_policy(opera, 'opera.py')

    def test_longform_coverage_is_weighted_by_duration_and_keeps_other_notices(self):
        from longform import aggregate_issues
        reports = [dict(duration=100, title='One', qualityIssues=[{'code': 'low_vocal_coverage', 'fraction': .2}, {'code': 'unconfirmed_lyric_ending'}],
                        final_post_vocal_seconds=1, arrangement={'voiced_energy_fraction': .2}),
                   dict(duration=300, title='Two', qualityIssues=[], arrangement={'voiced_energy_fraction': .4, 'first_detected_voice': 1})]
        issues, chapters = aggregate_issues(reports)
        self.assertIn({'code': 'low_vocal_coverage', 'fraction': .35}, issues)
        self.assertIn({'code': 'unconfirmed_lyric_ending'}, issues)
        self.assertEqual(chapters[1]['start'], 100)

    def test_only_boolean_request_option_is_accepted_and_guides_arrangement(self):
        self.assertNotIn('instrumentalHeavy', normalize({'version': 1}))
        for value in ('true', 1, None):
            with self.assertRaises(ValueError): normalize({'version': 1, 'instrumentalHeavy': value})
        options = normalize({'version': 1, 'instrumentalHeavy': True})
        self.assertTrue(options['instrumentalHeavy'])
        self.assertIn('instrumental-heavy', planning_guidance({'details': {'generation': options}}))
        self.assertIn('Instrumental-heavy', arrangement_guidance(options))

    def test_frozen_track_must_authorize_override(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            save(work / 'track.json', {'generation': {'instrumentalHeavy': True}})
            save(work / 'desktop-job.json', {'track_sha256': sha(work / 'track.json')})
            verify_intent(work)
            save(work / 'track.json', {'generation': {'instrumentalHeavy': False}})
            with self.assertRaisesRegex(ValueError, 'changed'): verify_intent(work)
            save(work / 'desktop-job.json', {'track_sha256': sha(work / 'track.json')})
            with self.assertRaisesRegex(ValueError, 'explicit'): verify_intent(work)

    def test_route_requires_explicit_option_and_never_rewrites_manifest(self):
        for style in ('rock', 'opera'):
            manifest = {'kind': 'new', 'style': style, 'workers': {'configure_song.py': 'hash'},
                        'tasks': [{'name': 'configure', 'command': ['python', 'saved/configure_song.py']}]}
            self.assertEqual(execution_manifest(manifest)['tasks'], manifest['tasks'])
            adapted = execution_manifest(manifest, instrumental_heavy=True)
            self.assertTrue(adapted['tasks'][0]['command'][1].endswith('instrumental_heavy.py'))
            self.assertEqual(manifest['tasks'][0]['command'][1], 'saved/configure_song.py')

    def test_retained_authorization_pins_audio_request_and_plan(self):
        from common import fingerprint
        from retained_instrumental import BASE, REPORT, verify_authorization
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); work = root / 'work'; work.mkdir()
            job = root / 'request-id'; job.mkdir()
            for name in BASE: save(work / name, {})
            save(job / 'render-request.json', {'prompt_id': job.name, 'plan': {'title': 'Same song'}})
            save(job / 'plan.json', {'title': 'Same song'})
            save(work / 'distonyc-configured.json', {'prompt_id': job.name,
                 'plan_hash': fingerprint({'title': 'Same song'})})
            save(work / REPORT, {'version': 1, 'request_id': job.name, 'directory': str(job),
                 'reason': 'User explicitly accepts this sparse retained recording',
                 'additional_generation': False, 'inputs_sha256': {name: sha(work / name) for name in BASE},
                 'job_sha256': {name: sha(job / name) for name in ('render-request.json', 'plan.json')}})
            save(job / 'retained-instrumental.json', {'authorization_sha256': sha(work / REPORT)})
            verify_authorization(work)
            save(work / 'selected-vocals.wav', {'changed': True})
            with self.assertRaisesRegex(ValueError, 'inputs changed'): verify_authorization(work)

    def test_retained_completion_refuses_converted_or_reviewed_songs(self):
        from retained_instrumental import eligible
        eligible({'status': 'published', 'result': {'validationFailures': ['unconverted_vocals']}})
        for changes in ({'status': 'processing'}, {'recordingCompletion': {'done': True}},
                        {'reviewDecision': 'accepted'}, {'result': {'validationFailures': []}}):
            with self.assertRaises(ValueError):
                eligible({'status': 'published', 'result': {'validationFailures': ['unconverted_vocals']}, **changes})

    def test_preview_marker_archive_preserves_exports_and_refuses_changed_audio(self):
        from retained_instrumental import archive_preview_marker
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); work = root / 'work'; work.mkdir()
            job = root / 'job'; job.mkdir()
            save(work / 'desktop-job.json', {})
            save(work / 'selected-vocals.wav', {})
            save(root / 'preview.mp3', {})
            files = [{'path': str(root / 'preview.mp3'), 'sha256': sha(root / 'preview.mp3')}]
            save(job / 'retained-prior-result.json', {'files': files})
            save(work / 'review-delivery.json', {'manifest_sha256': sha(work / 'desktop-job.json'),
                 'inputs_sha256': {'selected-vocals.wav': sha(work / 'selected-vocals.wav')},
                 'result': {'files': files}})
            save(root / 'preview.mp3', {'changed': True})
            with self.assertRaisesRegex(ValueError, 'export changed'): archive_preview_marker(work, job)
            save(root / 'preview.mp3', {})
            archive_preview_marker(work, job)
            self.assertFalse((work / 'review-delivery.json').exists())
            self.assertTrue((work / 'retained-prior-review-delivery.json').exists())
            self.assertTrue((root / 'preview.mp3').exists())


if __name__ == '__main__': unittest.main()
