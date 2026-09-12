import importlib.util, json, os, subprocess, sys, tempfile, time, unittest, uuid
from pathlib import Path
from unittest.mock import patch
from common import APIError, fingerprint, load, save, sha
from planner import validate, make_plan, normalize
from publish import merge_catalog, update_catalog
from worker import run_once, basis_files, metadata
from winprocess import Stopped, run_owned
from lyrics import make_sheet, export_sheet

def plan():
    return {'recipe': 'new', 'title': 'Night Train', 'style': 'rock', 'duration': 200, 'bpm': 100,
        'keyscale': 'D minor', 'lyrics': '[Verse]\n' + 'A late train carries us back home\n' * 8 + '[End]',
        'arrangement': 'Close, expressive Tony vocals over acoustic guitar. Grow into a full chorus with a resolved final chord and its natural decay.',
        'preserve_generated_backing': True, 'explanation': 'Original Tony song'}

class WorkerTests(unittest.TestCase):
    def test_lyrics_use_frozen_render_inputs_and_preserve_export(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); work = root / 'render'; work.mkdir()
            config = {'settings': {'studio_dir': str(root / 'studio'), 'output_dir': str(root / 'exports')}}
            save(work / 'spec.json', {'kind': 'new', 'lyrics': '[Verse]\nActual saved words\n[End]'})
            sheet = make_sheet(config, plan(), {'work_path': str(work)})
            self.assertEqual(sheet, {'text': '[Verse]\nActual saved words', 'kind': 'written'})
            path = export_sheet(config, 'song.mp3', 'Song', sheet)
            self.assertEqual(export_sheet(config, 'song.mp3', 'Song', sheet), path)
            with self.assertRaises(ValueError): export_sheet(config, 'song.mp3', 'Song', {**sheet, 'text': 'Other words'})
            save(work / 'spec.json', {'kind': 'barbershop'})
            save(work / 'original-transcripts.json', [{'text': ' Saved source line.'}, {'text': 'Another line.'}])
            sheet = make_sheet(config, plan(), {'work_path': str(work)})
            self.assertEqual(sheet, {'text': 'Saved source line.\nAnother line.', 'kind': 'transcribed'})

    def test_native_lyric_formatting_and_plan_response_recovery(self):
        original = plan(); original['lyrics'] = original['lyrics'].replace('\n', '\\n').replace('[End]', '')
        fixed = normalize(original)
        self.assertIn('\n', fixed['lyrics']); self.assertTrue(fixed['lyrics'].endswith('[End]'))
        with tempfile.TemporaryDirectory() as directory, patch('planner.run_owned') as model:
            root = Path(directory); brief = {'prompt': 'An original song', 'details': {}}
            save(root / 'planning-input.json', {'briefHash': fingerprint(brief)})
            save(root / 'planner-result.json', original)
            self.assertEqual(make_plan({'planner_model': 'test'}, brief, root, []), fixed)
            model.assert_not_called(); self.assertTrue((root / 'plan.json').exists())

    def test_lost_publish_response_retries_only_the_fallback_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); prompt = {'id': 'test-prompt', 'status': 'processing', 'prompt': 'Original test song', 'details': {}, 'songId': 'distonyc-test', 'releaseUrl': 'https://example.com/song.mp3'}
            job = root / 'jobs' / prompt['id']; job.mkdir(parents=True)
            files = []
            for ext in ['mp3', 'wav']:
                file = root / (ext + 's') / ('test.' + ext); file.parent.mkdir(); file.write_bytes(b'fixture')
                files.append({'path': str(file), 'bytes': file.stat().st_size, 'sha256': sha(file)})
            save(job / 'render-result.json', {'status': 'verified', 'new_training': False, 'duration': 200, 'files': files})
            save(job / 'plan.json', {'briefHash': fingerprint({'prompt': prompt['prompt'], 'details': prompt['details']}), 'plan': plan()})
            class API:
                def call(self, path, body=None, timeout=25):
                    if path.endswith('/complete'): prompt.update(status='completed', result=body['result'])
                    if path.endswith('/publishing'): prompt['status'] = 'publishing'
                    if path.endswith('/publish'):
                        prompt['status'] = 'published'; raise OSError('Response lost after publication')
                    return {'prompt': dict(prompt)}
            config = {'state_dir': str(root), 'settings': {'output_dir': str(root)}}
            with patch('worker.basis_files', return_value=[]), patch('worker.run_owned') as render, patch('worker.upload') as upload, patch('worker.update_catalog') as catalog:
                with self.assertRaises(OSError): run_once(config, API())
                self.assertTrue((root / 'claim.json').exists())
                run_once(config, API()); render.assert_not_called(); upload.assert_called_once(); catalog.assert_called_once()
                self.assertFalse((root / 'claim.json').exists())

    def test_invalid_plans_and_recipe_boundaries(self):
        self.assertEqual(validate(plan(), [])['recipe'], 'new')
        self.assertTrue(validate({**plan(), 'fear_hunger': True}, [])['fear_hunger'])
        with self.assertRaises(ValueError): validate({**plan(), 'fear_hunger': 'yes'}, [])
        for change in [{'title': '../escape'}, {'title': 'NUL'}, {'duration': 10}, {'lyrics': 'short'}, {'keyscale': 'run a command'}, {'recipe': 'remix'}]:
            with self.assertRaises(ValueError): validate({**plan(), **change}, [])
        with self.assertRaises(ValueError): validate({**plan(), 'recipe': 'barbershop'}, [{'relativePath': 'unknown.mp3'}])
        self.assertEqual(validate({**plan(), 'recipe': 'barbershop'}, [{'relativePath': 'dvdp/11_medusa.m4a'}])['recipe'], 'barbershop')

    def test_idle_never_calls_model_renderer_or_publisher(self):
        class API:
            def call(self, path, body): self.path = path; return {'prompt': None}
        with tempfile.TemporaryDirectory() as directory, patch('worker.make_plan') as model, patch('worker.run_owned') as render, patch('worker.upload') as upload:
            api = API(); run_once({'state_dir': directory}, api)
            self.assertEqual(api.path, '/claim'); self.assertEqual(load(Path(directory) / 'health.json')['status'], 'idle')
            model.assert_not_called(); render.assert_not_called(); upload.assert_not_called()
            self.assertFalse((Path(directory) / 'claim.json').exists())

    def test_claim_is_saved_before_a_lost_response_and_replayed(self):
        class API:
            def __init__(self): self.bodies = []
            def call(self, path, body):
                self.bodies.append(body.copy())
                if len(self.bodies) == 1: raise OSError('connection dropped')
                return {'prompt': None}
        with tempfile.TemporaryDirectory() as directory:
            api = API(); config = {'state_dir': directory}
            with self.assertRaises(OSError): run_once(config, api)
            run_once(config, api); self.assertEqual(api.bodies[0], api.bodies[1])

    def test_expired_claim_uses_a_new_fencing_token(self):
        class API:
            def __init__(self): self.bodies = []
            def call(self, path, body):
                self.bodies.append(body.copy())
                if len(self.bodies) == 1: raise APIError(410, 'expired')
                return {'prompt': None}
        with tempfile.TemporaryDirectory() as directory:
            api = API(); run_once({'state_dir': directory}, api)
            self.assertNotEqual(api.bodies[0]['leaseToken'], api.bodies[1]['leaseToken'])

    def test_plan_cache_avoids_another_model_call_and_rejects_changed_brief(self):
        with tempfile.TemporaryDirectory() as directory, patch('planner.run_owned') as model:
            brief = {'prompt': 'A song for the train', 'details': {}}
            save(Path(directory) / 'plan.json', {'briefHash': fingerprint(brief), 'plan': plan()})
            self.assertEqual(make_plan({}, brief, directory, []), plan()); model.assert_not_called()
            with self.assertRaises(ValueError): make_plan({}, {**brief, 'prompt': 'Changed prompt'}, directory, [])

    def test_basis_path_escape_rejected_and_content_pinned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'safe.mp3').write_bytes(b'audio')
            catalog = root / 'basis.json'; config = {'basis_root': str(root), 'basis_catalog': str(catalog)}
            save(catalog, {'songs': [{'id': 'one', 'title': 'Little Bit More', 'relativePath': 'safe.mp3'}]})
            result = basis_files(config, {'details': {'basisSongIds': ['one']}})
            self.assertEqual(result[0]['sha256'], sha(root / 'safe.mp3'))
            self.assertEqual(basis_files(config, {'details': {'source': 'Little Bit More'}}), result)
            self.assertEqual(basis_files(config, {'details': {'source': 'Little Bit More', 'basisSongIds': []}}), [])
            save(catalog, {'songs': [{'id': 'one', 'relativePath': '../outside.mp3'}]})
            with self.assertRaises(ValueError): basis_files(config, {'details': {'basisSongIds': ['one']}})

    def test_catalog_merge_preserves_other_work_and_retries_conflicts(self):
        prompt = {'songId': 'distonyc-one', 'result': {'title': 'New song', 'duration': 200}, 'releaseUrl': 'https://example.com/song.mp3'}
        import base64
        def response(songs, revision): return {'content': base64.b64encode(json.dumps({'version': 1, 'songs': songs}).encode()).decode(), 'sha': revision}
        original = {'id': 'existing', 'title': 'Existing song'}; concurrent = {'id': 'concurrent', 'title': 'Added by someone else'}
        calls = []
        def gh(config, args, body=None):
            if body is None: return response([original] if not calls else [concurrent, original], 'first' if not calls else 'second')
            calls.append(body)
            if len(calls) == 1: raise RuntimeError('HTTP 409 conflict')
            return {}
        with patch('publish.gh_json', side_effect=gh): update_catalog({}, prompt)
        saved = json.loads(base64.b64decode(calls[-1]['content']))
        self.assertEqual([s['id'] for s in saved['songs']], ['distonyc-one', 'concurrent', 'existing'])
        self.assertEqual(calls[-1]['sha'], 'second')
        self.assertFalse(merge_catalog(saved, saved['songs'][0]))
        self.assertTrue(merge_catalog(saved, {**saved['songs'][0], 'collections': ['distonyc', 'fearhunger']}))
        self.assertFalse(merge_catalog(saved, {key: value for key, value in saved['songs'][0].items() if key != 'collections'}))
        self.assertEqual(saved['songs'][0]['collections'], ['distonyc', 'fearhunger'])
        with self.assertRaises(ValueError): merge_catalog(saved, {**saved['songs'][0], 'title': 'Other song'})

    @unittest.skipUnless(os.name == 'nt', 'Windows process isolation')
    def test_cancel_kills_owned_grandchild_and_preserves_unrelated_process(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); gate = root / 'gate'; pidfile = root / 'child.json'
            script = root / 'parent.py'
            script.write_text('import subprocess, sys, time, json\nfrom pathlib import Path\n'
                'while not Path(sys.argv[1]).exists(): time.sleep(.02)\n'
                'p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"])\n'
                'Path(sys.argv[2]).write_text(json.dumps({"pid":p.pid}))\n'
                'time.sleep(60)\n', encoding='utf-8')
            unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'], creationflags=subprocess.CREATE_NO_WINDOW)
            try:
                with self.assertRaises(Stopped): run_owned([sys.executable, script, gate, pidfile], root, root / 'log', lambda: pidfile.exists(), gate=gate, timeout=15)
                self.assertIsNone(unrelated.poll())
                import ctypes
                kernel = ctypes.WinDLL('kernel32', use_last_error=True); kernel.OpenProcess.restype = ctypes.c_void_p
                kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
                kernel.CloseHandle.argtypes = [ctypes.c_void_p]
                handle = kernel.OpenProcess(0x1000, False, load(pidfile)['pid'])
                if handle:
                    code = ctypes.c_ulong(); kernel.GetExitCodeProcess(handle, ctypes.byref(code)); kernel.CloseHandle(handle)
                    self.assertNotEqual(code.value, 259)
            finally: unrelated.kill(); unrelated.wait()

if __name__ == '__main__': unittest.main()
