import sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

from common import load, save, sha
import pitch_alternate
from pitch_alternate import JOURNAL, b_side, fields, prepare, requested, saved, title
from publish import asset_url, song_record, upload_alternates
from winprocess import Stopped
from worker import run_once


def job(root, voice='v8', mode='clean'):
    """A finished versioned-voice job folder with one phrase, as the engine leaves it."""
    work = root / 'AI' / 'troofs-desktop-abc'; (work / 'conversion').mkdir(parents=True)
    for name in ('phrase-001.wav', 'phrase-001-semantic.npy', 'phrase-001-mel.npy', 'phrase-001-reference.json',
                 'phrase-001-f0.npy', 'phrase-001-f0-raw.npy', 'phrase-001-converted-mel.npy', 'phrase-001-converted.wav',
                 'tony-anchor-f0.npy', 'pitch-inputs.json'):
        (work / 'conversion' / name).write_text(name)
    for name in ('selected-vocals.wav', 'selected-backing.wav', 'selected-mix.wav', 'generated.wav', 'matched-vocals.wav',
                 'matched-mix.wav', 'mix-config.json', 'conversion-plan.json', 'voice-checks.json', 'mix-results.json',
                 'delivery-manifest.json', 'finish_versioned.py', 'engine_voice.py', 'arrangement-quality-policy.json'):
        (work / name).write_text(name)
    save(work / 'pitch-repair.json', {'mode': mode})
    save(work / 'track.json', {'title': 'Night Train', 'voice_model': voice, 'generation': {'version': 1, 'pitchRepair': mode}})
    save(work / 'desktop-status.json', {'status': 'completed', 'completed': ['generate', 'pitch', 'finish']})
    save(work / 'desktop-job.json', {'version': 1, 'job_id': 'abc', 'kind': 'new', 'settings': {}, 'workers': {}, 'track_sha256': sha(work / 'track.json'),
        'tasks': [{'name': 'generate', 'command': ['py', str(work / 'generate_song.py')]}] +
                 [{'name': name, 'command': ['vpy', r'C:\profile\voice_runtime.py', str(work), name]} for name in ('prepare', 'features', 'pitch', 'diffuse', 'vocode', 'assemble', 'validate')] +
                 [{'name': 'finish', 'command': ['vpy', str(work / 'finish_versioned.py'), '--work', str(work)]}, {'name': 'analysis', 'command': ['vpy', 'x']}]})
    return work


def listing(folder):
    return {str(path.relative_to(folder)): sha(path) for path in sorted(folder.rglob('*')) if path.is_file()}


class Preparation(unittest.TestCase):
    def test_b_side_folder_differs_only_by_setting_and_never_writes_the_a_side(self):
        with tempfile.TemporaryDirectory() as directory:
            work = job(Path(directory)); before = listing(work)
            variant, manifest = prepare(work, 'wild')
            self.assertEqual(listing(work), before)
            self.assertEqual(variant.name, 'troofs-desktop-abc-pitch-wild')
            track = load(variant / 'track.json')
            self.assertEqual((track['pitch_repair'], track['title']), ('wild', 'Night Train - Wild pitch'))
            self.assertEqual(track['generation'], {'version': 1, 'pitchRepair': 'clean'})
            self.assertEqual([task['name'] for task in manifest['tasks']], ['pitch', 'diffuse', 'vocode', 'assemble', 'validate', 'finish'])
            self.assertEqual(manifest['tasks'][0]['command'], ['vpy', r'C:\profile\voice_runtime.py', str(variant), 'pitch'])
            self.assertEqual(manifest['tasks'][-1]['command'], ['vpy', str(variant / 'finish_versioned.py'), '--work', str(variant)])
            self.assertEqual(manifest['track_sha256'], sha(variant / 'track.json'))
            self.assertEqual(load(variant / 'desktop-status.json'), {'status': 'ready', 'completed': []})
            kept = {str(path.relative_to(variant)).replace('\\', '/') for path in variant.rglob('*') if path.is_file()}
            self.assertLessEqual({'conversion/phrase-001.wav', 'conversion/phrase-001-semantic.npy', 'conversion/phrase-001-mel.npy',
                                  'conversion/phrase-001-reference.json', 'selected-vocals.wav', 'selected-backing.wav', 'mix-config.json',
                                  'conversion-plan.json', 'arrangement-quality-policy.json', 'finish_versioned.py'}, kept)
            self.assertFalse(kept & {'conversion/phrase-001-f0.npy', 'conversion/phrase-001-f0-raw.npy', 'conversion/phrase-001-converted.wav',
                                     'conversion/phrase-001-converted-mel.npy', 'conversion/tony-anchor-f0.npy', 'conversion/pitch-inputs.json',
                                     'matched-vocals.wav', 'matched-mix.wav', 'voice-checks.json', 'mix-results.json', 'delivery-manifest.json',
                                     'pitch-repair.json', 'generated.wav', 'selected-mix.wav'})
            self.assertEqual(prepare(work, 'wild')[0], variant)

    def test_unsupported_songs_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'different journaled'): prepare(job(Path(directory) / 'same'), 'clean')
            with self.assertRaisesRegex(ValueError, 'versioned-voice'): prepare(job(Path(directory) / 'v6', voice='v6'), 'wild')
            import shutil
            moved = job(Path(directory) / 'moved').with_name('troofs-desktop-copy'); shutil.copytree(moved.with_name('troofs-desktop-abc'), moved)
            with self.assertRaisesRegex(ValueError, 'does not address'): prepare(moved, 'wild')
            self.assertFalse(moved.with_name('troofs-desktop-copy-pitch-wild').exists())
            old = job(Path(directory) / 'old'); (old / 'pitch-repair.json').unlink()
            with self.assertRaisesRegex(ValueError, 'different journaled'): prepare(old, 'wild')


class Journal(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(); root = Path(self.folder.name)
        self.directory = root / 'job'; self.directory.mkdir(); (root / 'out/mp3s').mkdir(parents=True)
        self.mp3 = root / 'out/mp3s/Night Train - Wild pitch.mp3'; self.mp3.write_bytes(b'B' * 2000)
        self.config = {'settings': {'python': sys.executable, 'output_dir': str(root / 'out')}}
        self.item = {'pitchRepair': 'wild', 'mp3': str(self.mp3), 'bytes': 2000, 'sha256': sha(self.mp3), 'duration': 181.5, 'work_path': 'x'}
        self.plan = {'generation': {'version': 1, 'pitchRepair': 'clean', 'pitchCompare': 'wild'}}
        self.heartbeat = type('Heartbeat', (), {'stage': '', 'stopped': lambda self: False})()
    def tearDown(self): self.folder.cleanup()

    def test_nothing_runs_unless_a_b_side_was_requested(self):
        self.assertIsNone(requested({'generation': {'version': 1, 'pitchRepair': 'clean'}}))
        self.assertIsNone(requested({}))
        def never(*args, **kwargs): raise AssertionError('must not run')
        self.assertIsNone(b_side(self.config, {'generation': {'version': 1}}, self.directory, self.heartbeat, never, Stopped))
        self.assertFalse((self.directory / JOURNAL).exists())

    def test_failures_publish_the_a_side_alone_and_stop_after_two_attempts(self):
        calls = []
        def crash(*args, **kwargs): calls.append(args[0]); raise RuntimeError('Operation failed (exit 1)')
        for _ in range(3): self.assertIsNone(b_side(self.config, self.plan, self.directory, self.heartbeat, crash, Stopped))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][-2:], ['--mode', 'wild'])
        self.assertEqual(load(self.directory / JOURNAL)['attempts'], 2)

    def test_cancellation_is_not_swallowed(self):
        def stop(*args, **kwargs): raise Stopped('lease lost')
        with self.assertRaises(Stopped): b_side(self.config, self.plan, self.directory, self.heartbeat, stop, Stopped)

    def test_completed_b_side_is_reused_and_reverified(self):
        def child(*args, **kwargs): save(self.directory / JOURNAL, {**load(self.directory / JOURNAL), 'status': 'completed', 'alternate': self.item})
        self.assertEqual(b_side(self.config, self.plan, self.directory, self.heartbeat, child, Stopped), self.item)
        def never(*args, **kwargs): raise AssertionError('must not run twice')
        self.assertEqual(b_side(self.config, self.plan, self.directory, self.heartbeat, never, Stopped), self.item)
        self.mp3.write_bytes(b'C' * 2000)
        self.assertIsNone(b_side(self.config, self.plan, self.directory, self.heartbeat, never, Stopped))
        with self.assertRaisesRegex(ValueError, 'changed'): saved(self.directory, self.config)

    def test_published_fields_come_from_the_runtime_journal(self):
        work = job(Path(self.folder.name) / 'song')
        self.assertEqual(fields({'work_path': str(work)}, None), {'pitchRepair': 'clean'})
        self.assertEqual(fields({'work_path': str(work)}, self.item),
                         {'pitchRepair': 'clean', 'alternates': [{'pitchRepair': 'wild', 'sha256': self.item['sha256'], 'bytes': 2000, 'duration': 181.5}]})
        self.assertEqual(fields({'work_path': str(work)}, {**self.item, 'pitchRepair': 'clean'}), {'pitchRepair': 'clean'})
        (work / 'pitch-repair.json').unlink()
        self.assertEqual(fields({'work_path': str(work)}, self.item), {})
        self.assertEqual(fields({}, self.item), {})

    def test_upload_and_catalog_carry_only_what_the_server_accepted(self):
        row = {key: self.item[key] for key in ('pitchRepair', 'sha256', 'bytes', 'duration')}
        prompt = {'songId': 'distonyc-one', 'releaseUrl': asset_url('distonyc-one', 'a' * 64), 'prompt': 'Idea', 'details': {'voiceModel': 'v8'},
                  'result': {'title': 'Night Train', 'duration': 181.5, 'sha256': 'a' * 64, 'bytes': 9, 'pitchRepair': 'clean', 'alternates': [row]}}
        with patch('publish.upload_asset') as sent:
            upload_alternates(self.config, {**prompt, 'result': {**prompt['result'], 'alternates': []}}, self.directory)
            sent.assert_not_called()
            with self.assertRaisesRegex(ValueError, 'differs'): upload_alternates(self.config, prompt, self.directory)
            save(self.directory / JOURNAL, {'status': 'completed', 'alternate': self.item})
            upload_alternates(self.config, prompt, self.directory)
            sent.assert_called_once_with(self.config, 'distonyc-one', row, str(self.mp3), self.directory, None)
        record = song_record(prompt)
        self.assertEqual(record['pitchRepair'], 'clean')
        self.assertEqual(record['alternates'], [{**row, 'url': asset_url('distonyc-one', row['sha256'])}])
        self.assertNotEqual(record['alternates'][0]['url'], record['url'])
        self.assertEqual(title('Night Train', 'haunted'), 'Night Train - Haunted pitch')


class WorkerFlow(unittest.TestCase):
    def test_completion_describes_both_sides_and_uploads_the_b_side_after_the_song(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); work = job(root / 'song')
            plan = {'recipe': 'new', 'title': 'Night Train', 'duration': 200, 'generation': {'version': 1, 'pitchRepair': 'clean', 'pitchCompare': 'wild'}}
            prompt = {'id': 'b-side', 'status': 'processing', 'prompt': 'A railway song', 'songId': 'distonyc-b', 'releaseUrl': 'x',
                      'details': {'voiceModel': 'v8', 'basisSongIds': [], 'generation': plan['generation']}}
            config = {'state_dir': str(root / 'state'), 'settings': {'studio_dir': str(root), 'python': sys.executable, 'output_dir': str(root / 'out')}}
            item = {'pitchRepair': 'wild', 'mp3': 'b.mp3', 'bytes': 200000, 'sha256': 'b' * 64, 'duration': 181.5, 'work_path': 'x'}
            completed, order = [], []
            class API:
                def call(self, path, body=None, timeout=25):
                    if path.endswith('/complete'): completed.append(body['result']); prompt.update(status='completed', result=body['result'])
                    elif path.endswith('/publishing'): prompt['status'] = 'publishing'
                    return {'prompt': dict(prompt)}
            def render(*args, **kwargs): save(root / 'state/jobs/b-side/render-result.json', {'voice_model': 'v8', 'work_path': str(work)})
            with patch('worker.basis_files', return_value=[]), patch('worker.make_plan', return_value=plan), patch('worker.public_plan', return_value={}), \
                    patch('generation_flow.approved_plan', return_value=(plan, None)), patch('worker.run_owned', side_effect=render), \
                    patch('worker.metadata', return_value=('a.mp3', {'title': 'Night Train', 'duration': 200, 'voiceModel': 'v8'})), \
                    patch('pitch_alternate.b_side', return_value=item) as sing, \
                    patch('worker.upload', side_effect=lambda *a, **k: order.append('song')), \
                    patch('worker.upload_alternates', side_effect=lambda *a, **k: (order.append('b side'), (_ for _ in ()).throw(OSError('stop after contract')))):
                with self.assertRaisesRegex(OSError, 'stop after contract'): run_once(config, API())
            sing.assert_called_once()
            self.assertEqual(completed[0]['pitchRepair'], 'clean')
            self.assertEqual(completed[0]['alternates'], [{'pitchRepair': 'wild', 'sha256': 'b' * 64, 'bytes': 200000, 'duration': 181.5}])
            self.assertEqual(order, ['song', 'b side'])


if __name__ == '__main__': unittest.main()
