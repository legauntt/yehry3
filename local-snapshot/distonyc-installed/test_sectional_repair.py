import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import fingerprint, load, save, sha
from composition_ending import work_path
from request_materials import words
from sectional_repair import REPORT, child_request, prepare, render_repair, sections, verify
from sparse_vocal_repair import prepare as prepare_sparse
from test_sparse_vocal_repair import SparseVocalRepairTests


class SectionalRepairTests(unittest.TestCase):
    def fixture(self, root):
        request, original = SparseVocalRepairTests().fixture(root)
        request['plan']['lyrics'] = '\n'.join(
            line if line.startswith('[') else line + ' We hold the lantern high through the long and winding night.'
            for line in request['plan']['lyrics'].splitlines())
        job = Path(request['directory']); planning = load(job/'planning-input.json')
        planning['brief']['details']['lyricSheet']['text'] = request['plan']['lyrics']
        planning['briefHash'] = fingerprint(planning['brief']); save(job/'planning-input.json', planning)
        save(job/'plan.json', {'briefHash': planning['briefHash'], 'plan': request['plan']})
        save(original/'distonyc-configured.json', {'plan_hash': fingerprint(request['plan'])})
        request['config']['settings']['output_dir'] = str(root/'outputs')
        request['config']['settings']['ffmpeg'] = 'unused-test-ffmpeg'
        request['config']['settings']['voice_python'] = 'unused-test-python'
        save(Path(request['directory'])/'render-request.json', request)
        prior = prepare_sparse(request); prior['status'] = 'failed'
        save(Path(request['directory'])/'sparse-vocal-repair.json', prior)
        work = Path(prior['work_path']); work.mkdir()
        for name in ('desktop-job.json', 'track.json', 'generated.wav', 'selected-mix.wav',
                     'selected-vocals.wav', 'selected-backing.wav', 'arrangement-checks.json'):
            (work/name).write_bytes(b'retained failed second source')
        save(work/'desktop-status.json', {'status': 'failed', 'stage': 'configure',
             'completed': ['generate', 'separate', 'backing', 'words'], 'error': 'Insufficient vocal signal activity'})
        return request, original, work

    def test_partition_preserves_exact_words_order_and_total_duration(self):
        with tempfile.TemporaryDirectory() as directory:
            request, _, _ = self.fixture(Path(directory))
            groups = sections(request['plan'])
            self.assertEqual(sum((words(p['lyrics']) for p in groups), []), words(request['plan']['lyrics']))
            self.assertEqual(sum(p['duration'] for p in groups), 310)
            self.assertEqual(len(groups), 3)
            self.assertTrue(all(60 <= p['duration'] <= 300 for p in groups))

    def test_preserves_earlier_work_and_fails_closed_on_tampering(self):
        for change in ('parent', 'prior_audio', 'budget', 'assembly'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                request, original, prior = self.fixture(Path(directory))
                originals = {p: p.read_bytes() for w in (original, prior) for p in w.iterdir()}
                journal = prepare(request); self.assertEqual(prepare(request), journal)
                for p, content in originals.items(): self.assertEqual(p.read_bytes(), content)
                if change == 'parent': request['voice_model'] = 'v6'
                elif change == 'prior_audio': (prior/'selected-vocals.wav').write_bytes(b'changed')
                elif change == 'budget': journal['attempts_per_section'] = 4
                else: (Path(journal['work_path'])/'finish_suite.py').write_text('changed')
                with self.assertRaises(ValueError): verify(request, journal)

    def test_three_failed_compositions_are_retained_and_never_repeated(self):
        with tempfile.TemporaryDirectory() as directory:
            request, _, _ = self.fixture(Path(directory)); prepare(request); attempts = []
            def fail(child):
                attempts.append(child['prompt_id']); work = work_path(child); work.mkdir()
                save(work/'desktop-status.json', {'status': 'failed', 'stage': 'configure',
                     'error': 'Insufficient vocal signal activity'})
                raise RuntimeError('Insufficient vocal signal activity')
            with self.assertRaisesRegex(RuntimeError, 'exhausted'):
                render_repair(request, fail, lambda _: self.fail('No verified section'))
            self.assertEqual(len(set(attempts)), 3)
            with self.assertRaisesRegex(RuntimeError, 'exhausted'):
                render_repair(request, lambda _: self.fail('No fourth attempt'), lambda _: None)
            self.assertEqual(len(load(Path(request['directory'])/REPORT)['attempts'][0]), 3)

    def test_interruption_and_voice_failure_resume_the_same_reserved_child(self):
        for stage in ('generate', 'validate'):
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as directory:
                request, _, _ = self.fixture(Path(directory)); prepare(request); attempts = []
                def fail(child):
                    attempts.append(child); work=work_path(child); work.mkdir(exist_ok=True)
                    save(work/'desktop-status.json', {'status': 'failed', 'stage': stage, 'error': 'Connection lost'})
                    raise RuntimeError('Connection lost')
                for _ in range(2):
                    with self.assertRaisesRegex(RuntimeError, 'Connection lost'): render_repair(request, fail, lambda _: None)
                self.assertEqual(attempts[0], attempts[1])
                self.assertEqual(len(load(Path(request['directory'])/REPORT)['attempts'][0]), 1)

    def test_verified_sections_are_reused_after_master_interruption(self):
        with tempfile.TemporaryDirectory() as directory:
            request, _, _ = self.fixture(Path(directory)); prepare(request); calls=[]
            def render(child):
                calls.append(child['prompt_id']); work=work_path(child); work.mkdir()
                save(work/'mix-results.json', {'status': 'completed'})
                return {'status': 'verified', 'work_path': str(work), 'voice_model': 'v7'}
            with patch('sectional_repair.subprocess.run', side_effect=RuntimeError('Master interrupted')):
                with self.assertRaisesRegex(RuntimeError, 'Master interrupted'):
                    render_repair(request, render, lambda _: {'status': 'verified'})
                with self.assertRaisesRegex(RuntimeError, 'Master interrupted'):
                    render_repair(request, lambda _: self.fail('Completed section rerendered'), lambda _: {'status': 'verified'})
            self.assertEqual(len(calls), 3)
            journal = load(Path(request['directory'])/REPORT)
            self.assertTrue(all(rows[-1]['status'] == 'verified' for rows in journal['attempts']))

    def test_assembly_warning_requires_every_original_policy_and_export_hash(self):
        from quality_verify import warning_is_valid
        from longform import aggregate_issues
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); work=root/'suite'; work.mkdir()
            private=work/'private-movements'; private.mkdir(); parts=[]; reports=[]
            for index in range(3):
                source=root/f'part-{index}'; source.mkdir(); pins={}
                for name in ('selected-vocals.wav','selected-backing.wav','matched-vocals.wav'):
                    (source/name).write_bytes(b'pinned stem'); pins[name]=sha(source/name)
                save(source/'vocal-quality-policy.json', {'version':2,'recovery_disposition':'not_supported_for_voice_model',
                     'audio_changed':False,'other_integrity_checks_retained':True,'inputs_sha256':pins})
                files=[]
                for suffix in ('mp3','wav'):
                    path=private/f'{index}.{suffix}'; path.write_bytes(b'verified export')
                    files.append({'file':str(path),'bytes':path.stat().st_size,'sha256':sha(path)})
                report={'status':'completed','title':str(index),'duration':90,'voice_checks':{'passed':True},
                        'longest_missing_vocal_run_seconds':.8,'qualityIssues':[{'code':'vocal_dropout','seconds':.8}],
                        'final_post_vocal_seconds':8,'arrangement':{'first_detected_voice':2},'files':files}
                save(source/'mix-results.json', report); reports.append(report)
                parts.append({'result':{'status':'verified','work_path':str(source)},'mix_report_sha256':sha(source/'mix-results.json')})
            issues,_=aggregate_issues(reports)
            save(work/'mix-results.json', {'complete_movement_pcm_preserved':True,'movement_provenance':parts,
                 'longest_missing_vocal_run_seconds':.8,'qualityIssues':issues})
            self.assertTrue(warning_is_valid(work))
            (root/'part-1'/'selected-vocals.wav').write_bytes(b'changed source')
            self.assertFalse(warning_is_valid(work))
            (root/'part-1'/'selected-vocals.wav').write_bytes(b'pinned stem')
            (private/'0.mp3').write_bytes(b'changed export')
            self.assertFalse(warning_is_valid(work))


if __name__ == '__main__': unittest.main()
