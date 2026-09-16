import collections
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import load, save, sha
from duration_policy import choose, join_lyrics
from duration_runtime import adapt, extend
from duration_ending import compile_policy
from longform import child_request, render_suite, aggregate_issues
from planner import normalize, validate
from renderer import module_at
from test_planner import fixture
from winprocess import Stopped

ENGINE = Path(__file__).resolve().parents[2] / 'troofs-desktop/worker/engine_tasks.py'
STUDIO = Path.home() / 'Music/One More Round - extended/AI extension/troofs-studio'


def suite_plan(count=5, seconds=228):
    base = fixture()
    movements = [{'duration': seconds, 'lyrics': base['lyrics'], 'arrangement': base['arrangement']} for _ in range(count)]
    return {**base, 'duration': count * seconds, 'movements': movements, 'lyrics': join_lyrics(movements)}


class DurationTests(unittest.TestCase):
    def test_variety_is_stable_and_long_songs_are_rare(self):
        rows = [choose(str(i)) for i in range(20000)]
        counts = collections.Counter(row['band'] for row in rows)
        for band, low, high in [('baseline', .65, .69), ('short', .13, .17), ('extended', .15, .19),
                                ('rare_long', .005, .013), ('exceptional_suite', .0002, .002)]:
            self.assertTrue(low < counts[band] / len(rows) < high, (band, counts))
        self.assertEqual(rows[48], choose('48'))
        self.assertEqual({r['target_seconds'] for r in rows if r['band'] == 'exceptional_suite'}, {1140})
        self.assertTrue(all(120 <= r['target_seconds'] <= 1140 for r in rows))
        self.assertIn(120, {r['target_seconds'] for r in rows})
        self.assertIn(480, {r['target_seconds'] for r in rows})

    def test_duration_boundaries_and_old_frozen_plans(self):
        old = fixture(); original = copy.deepcopy(old)
        self.assertEqual(validate(old, []), original)
        for duration in (120, 240, 480, 600):
            self.assertEqual(validate({**old, 'duration': duration}, [])['duration'], duration)
        self.assertEqual(validate(suite_plan(), [])['duration'], 1140)
        for duration in (119, 1141):
            with self.assertRaisesRegex(ValueError, 'duration'): validate({**old, 'duration': duration}, [])
        with self.assertRaisesRegex(ValueError, 'movements'): validate({**old, 'duration': 1140}, [])

    def test_movement_contract_and_lyric_normalization(self):
        for change in ('sum', 'duration', 'lyrics', 'arrangement', 'count'):
            plan = suite_plan()
            if change == 'sum': plan['movements'][0]['duration'] += 1
            elif change == 'duration': plan['movements'][0]['duration'] = 601
            elif change == 'lyrics': plan['movements'][0]['lyrics'] = '[End]'
            elif change == 'arrangement': plan['movements'][0]['arrangement'] = 'Short'
            else: plan['movements'] = plan['movements'][:2]
            with self.subTest(change=change), self.assertRaises(ValueError): validate(plan, [])
        plan = suite_plan(); plan['lyrics'] = ''
        plan['movements'][0]['lyrics'] = plan['movements'][0]['lyrics'].removesuffix('[End]').replace('\n', '\\n')
        raw = copy.deepcopy(plan)
        clean = validate(normalize(plan), [])
        self.assertEqual(plan, raw)
        self.assertEqual(clean['lyrics'].count('[End]'), 1)
        self.assertIn('[Movement 5]', clean['lyrics'])

    @unittest.skipUnless(ENGINE.exists() and STUDIO.exists(), 'Installed Troofs engine integration')
    def test_actual_engine_and_studio_accept_native_lengths_without_file_edits(self):
        engine_hash, studio_hash = sha(ENGINE), sha(STUDIO / 'studio.py')
        engine = module_at('duration_test_engine', ENGINE); adapt(engine)
        studio = engine.engine({'studio_dir': str(STUDIO), 'python': 'python', 'voice_python': 'python'})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); cat = root / 'catalog'; cat.mkdir()
            save(cat / 'sources.json', [{'recording': '06-someday'}]); (cat / 'tony-catalog-adapter.pt').write_bytes(b'test')
            studio.plan.__globals__.update(CAT=cat, AI=root, ROOT=root)
            spec = {**fixture(), 'kind': 'new', 'id': 'duration-check', 'seed': 100}
            for duration in (120, 240, 480, 600):
                spec['duration'] = duration
                engine.validate_spec(spec)
                save(root / 'spec.json', spec)
                self.assertEqual(studio.plan(root / 'spec.json')[1]['duration'], duration)
            for duration in (119, 601, 1140):
                spec['duration'] = duration
                with self.assertRaises(Exception): engine.validate_spec(spec)
                save(root / 'spec.json', spec)
                with self.assertRaises(Exception): studio.plan(root / 'spec.json')
            spec.update(duration=480, keyscale='H minor')
            with self.assertRaises(Exception): engine.validate_spec(spec)
        self.assertEqual((sha(ENGINE), sha(STUDIO / 'studio.py')), (engine_hash, studio_hash))

    def test_unknown_runtime_and_ending_policy_fail_closed(self):
        with self.assertRaises(ValueError): extend(suite_plan)
        with self.assertRaises(ValueError): compile_policy('minimum = 170', '<test>')
        code = compile_policy("minimum = 180\nassert voice_quiet\nend = max(end, minimum)\n", '<test>')
        for duration, expected in ((120, 120), (240, 180), (600, 180)):
            scope = {'track': {'duration': duration}, 'end': 110, 'voice_quiet': True}; exec(code, scope)
            self.assertEqual(scope['end'], expected)
        with self.assertRaises(AssertionError): exec(code, {'track': {'duration': 120}, 'end': 110, 'voice_quiet': False})

    @unittest.skipUnless(ENGINE.exists() and STUDIO.exists(), 'Installed Troofs engine integration')
    def test_submitted_lyrics_runtime_accepts_one_minute_and_keeps_other_guards(self):
        engine_hash, studio_hash = sha(ENGINE), sha(STUDIO / 'studio.py')
        engine = module_at('short_lyrics_engine', ENGINE); adapt(engine, 60)
        studio = engine.engine({'studio_dir': str(STUDIO), 'python': 'python', 'voice_python': 'python'})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); cat = root / 'catalog'; cat.mkdir()
            save(cat / 'sources.json', [{'recording': '06-someday'}]); (cat / 'tony-catalog-adapter.pt').write_bytes(b'test')
            studio.plan.__globals__.update(CAT=cat, AI=root, ROOT=root)
            spec = {**fixture(), 'kind': 'new', 'id': 'short-lyrics-check', 'seed': 100}
            for seconds in (60, 85, 90, 119, 120, 600):
                spec['duration'] = seconds; engine.validate_spec(spec); save(root / 'spec.json', spec)
                self.assertEqual(studio.plan(root / 'spec.json')[1]['duration'], seconds)
            for seconds in (59, 601):
                spec['duration'] = seconds
                with self.assertRaises(Exception): engine.validate_spec(spec)
                save(root / 'spec.json', spec)
                with self.assertRaises(Exception): studio.plan(root / 'spec.json')
            spec.update(duration=60, keyscale='H minor')
            with self.assertRaises(Exception): engine.validate_spec(spec)
        self.assertEqual((sha(ENGINE), sha(STUDIO / 'studio.py')), (engine_hash, studio_hash))
        code = compile_policy('minimum = 180\nassert voice_quiet\nend = max(end, minimum)\n', '<test>')
        scope = {'track': {'duration': 60}, 'end': 50, 'voice_quiet': True}; exec(code, scope)
        self.assertEqual(scope['end'], 60)

    def test_ending_policy_tolerates_only_sample_roundoff(self):
        source = "minimum = 180\nassert end/SR >= last+2\n"
        code = compile_policy(source, '<test>')
        last = 228.98000000000002
        end = round((last + 2) * 44100)
        exec(code, {'track': {'duration': 240}, 'end': end, 'SR': 44100, 'last': last})
        with self.assertRaises(AssertionError):
            exec(code, {'track': {'duration': 240}, 'end': end - 1, 'SR': 44100, 'last': last})

    def test_suite_children_keep_outputs_private_and_do_not_mutate_parent(self):
        parent = {'prompt_id': 'request', 'directory': 'jobs/request', 'plan': suite_plan(),
                  'config': {'settings': {'output_dir': 'public'}}}
        saved = copy.deepcopy(parent); child = child_request(parent, Path('private'), 2)
        self.assertEqual(parent, saved)
        self.assertEqual(child['plan']['duration'], 228)
        self.assertEqual(child['plan']['movements'], [])
        self.assertEqual(child['config']['settings']['output_dir'], str(Path('private/private-movements')))
        self.assertEqual(child['plan']['keyscale'], parent['plan']['keyscale'])
        self.assertEqual(child['suite_progress']['index'], 2)

    def test_cancel_and_restart_reuse_completed_movements(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); jobs = root / 'job'; jobs.mkdir(); studio = root / 'studio'; studio.mkdir()
            request = {'prompt_id': 'resume-suite', 'directory': str(jobs), 'plan': suite_plan(3, 240), 'basis': [],
                       'config': {'settings': {'studio_dir': str(studio), 'voice_python': 'python', 'output_dir': str(root / 'public')}}}
            attempts = []; verified = []
            def render(child):
                number = child['suite_progress']['index']
                attempts.append(number)
                if attempts == [0, 1]: raise Stopped('Canceled')
                work = root / ('movement-' + str(number)); work.mkdir(exist_ok=True)
                save(work / 'mix-results.json', {'status': 'completed'})
                return {'status': 'verified', 'work_path': str(work)}
            def verify(child):
                verified.append(child['verify_existing'])
                return {'status': 'verified', 'work_path': child['verify_existing']}
            with self.assertRaises(Stopped): render_suite(request, render, verify)
            work = next(root.glob('troofs-suite-*'))
            self.assertEqual(len(load(work / 'suite-job.json')['parts']), 1)
            def master(*args, **kwargs): save(work / 'mix-results.json', {'status': 'completed'})
            with patch('longform.subprocess.run', side_effect=master): result = render_suite(request, render, verify)
            self.assertEqual(attempts, [0, 1, 1, 2])
            self.assertIn(str(root / 'movement-0'), verified)
            self.assertEqual(render_suite(request, render, verify), result)
            self.assertEqual(attempts, [0, 1, 1, 2])
            changed = copy.deepcopy(request); changed['plan']['title'] = 'Changed'
            with self.assertRaisesRegex(ValueError, 'inputs changed'): render_suite(changed, render, verify)
            save(work / 'spec.json', {})
            with self.assertRaisesRegex(ValueError, 'plan changed'): render_suite(request, render, verify)

    def test_warning_rollup_keeps_final_outro_and_chapter_gaps(self):
        reports = [{'title': str(i), 'duration': 228, 'final_post_vocal_seconds': 30 if i == 0 else 10,
                    'arrangement': {'first_detected_voice': 4},
                    'qualityIssues': [{'code': 'long_instrumental_outro', 'seconds': 30}] if i == 0 else
                                     [{'code': 'vocal_dropout', 'seconds': 301}]} for i in range(3)]
        issues, chapters = aggregate_issues(reports)
        self.assertEqual({r['code']: r['seconds'] for r in issues}, {'long_instrumental_break': 34, 'vocal_dropout': 602})
        self.assertEqual([row['start'] for row in chapters], [0, 228, 456])


if __name__ == '__main__': unittest.main()
