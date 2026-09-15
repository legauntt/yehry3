import tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from common import load, save, sha
from remix_sources import prepare, resolve, material, register, descriptor
from source_material import source_material
from worker import basis_files, run_once


class RemixSources(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.work = self.root / 'music/work'; self.work.mkdir(parents=True)
        self.config = {'state_dir': str(self.root / 'state'), 'basis_root': str(self.root / 'library'),
            'settings': {'studio_dir': str(self.root / 'music/studio'), 'output_dir': str(self.root / 'exports')}, 'catalog_remix': True}
        self.job = self.root / 'state/jobs/original'; self.job.mkdir(parents=True)
        files = []
        for ext in ('mp3', 'wav'):
            path = self.root / 'exports' / (ext + 's') / ('original.' + ext); path.parent.mkdir(parents=True); path.write_bytes(b'original-' + ext.encode())
            files.append({'path': str(path), 'bytes': path.stat().st_size, 'sha256': sha(path)})
        (self.work / 'matched-vocals.wav').write_bytes(b'converted Tony vocal stem')
        save(self.job / 'render-result.json', {'status': 'verified', 'new_training': False, 'work_path': str(self.work), 'files': files})
        self.prompt = {'id': 'original', 'songId': 'distonyc-source', 'status': 'published',
            'releaseUrl': 'https://github.com/legauntt/yehry3/releases/download/distonyc-v1/source.mp3',
            'result': {**files[0], 'title': 'The original', 'duration': 160, 'lyrics': {'text': 'Our familiar hook and words', 'kind': 'written'}}}

    def test_exact_source_survives_retries_and_reaches_planner_material(self):
        source = prepare(self.config, self.prompt); basis = resolve(self.config, source)
        self.assertEqual(source, prepare(self.config, self.prompt))
        self.assertTrue(Path(source_material(self.config, [basis])['vocal_reference_path']).samefile(self.work / 'matched-vocals.wav'))
        self.assertEqual(basis_files(self.config, {'details': {'remixSource': source, 'basisSongIds': []}}), [basis])
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            basis_files(self.config, {'details': {'remixSource': source, 'basisSongIds': ['another']}})

    def test_changed_recording_and_frozen_stems_fail_closed(self):
        source = prepare(self.config, self.prompt); basis = resolve(self.config, source)
        (self.work / 'matched-vocals.wav').write_bytes(b'changed stem')
        with self.assertRaisesRegex(ValueError, 'changed'): material(self.config, basis)
        with self.assertRaisesRegex(ValueError, 'changed'): prepare(self.config, self.prompt)

    def test_changed_source_descriptor_cannot_retarget_same_title(self):
        source = prepare(self.config, self.prompt)
        with self.assertRaisesRegex(ValueError, 'differs'): resolve(self.config, {**source, 'url': source['url'].replace('source.mp3', 'other.mp3')})
        with self.assertRaisesRegex(ValueError, 'no verified'): resolve(self.config, {**source, 'songId': 'other-same-title'})
        for change in ({'songId': '../escape'}, {'url': 'https://127.0.0.1/private'}, {'bytes': 64000001}, {'duration': float('nan')}):
            with self.assertRaises(ValueError): descriptor({**source, **change})

    def test_changed_manifest_and_lyrics_cannot_modify_started_material(self):
        source = prepare(self.config, self.prompt); basis = resolve(self.config, source)
        manifest = Path(basis['path']).parent / 'source.json'; saved = load(manifest)
        saved['material']['lyrics_draft'] = 'new words'; save(manifest, saved)
        with self.assertRaisesRegex(ValueError, 'material changed'): material(self.config, basis)

    def test_missing_specialist_stems_are_not_advertised(self):
        (self.work / 'matched-vocals.wav').unlink()
        self.assertIsNone(prepare(self.config, self.prompt))
        with self.assertRaisesRegex(ValueError, 'Only a published'): prepare(self.config, {**self.prompt, 'status': 'failed'})

    def test_published_byte_mismatch_blocks_registration(self):
        with self.assertRaisesRegex(ValueError, 'differs from the published'):
            prepare(self.config, {**self.prompt, 'result': {**self.prompt['result'], 'sha256': 'a' * 64}})

    def test_registration_never_sends_local_paths_and_feature_gates_claims(self):
        calls = []
        class API:
            def call(self, path, body=None): calls.append((path, body)); return {'prompt': None}
        api = API(); register(self.config, api, self.prompt)
        self.assertEqual(set(calls[0][1]), {'version', 'url', 'sha256', 'bytes'})
        run_once(self.config, api)
        self.assertIn('catalog-remix-v1', calls[-1][1]['capabilities'])
        calls.clear(); self.config['catalog_remix'] = False; run_once(self.config, api)
        self.assertNotIn('catalog-remix-v1', calls[-1][1]['capabilities'])

    def test_v7_remix_uses_source_material_and_reuses_accepted_plan(self):
        from planner import make_plan
        from test_worker import plan
        source = prepare(self.config, self.prompt); basis = resolve(self.config, source)
        studio = Path(self.config['settings']['studio_dir']); studio.mkdir()
        (studio / 'PREFERENCES.md').write_text('Keep the hook catchable.', encoding='utf-8')
        self.config.update(codex='test', planner_model='test')
        request = {'id': 'new-remix', 'prompt': 'Remix the original with a new arrangement and familiar hook',
            'details': {'remixSource': source, 'basisSongIds': [], 'voiceModel': 'v7',
                'lyricSheet': {'text': 'Our familiar hook and words', 'mode': 'adapt'}}}
        job = self.root / 'state/jobs/new-remix'; job.mkdir()
        calls = []
        def compose(command, directory, *args, **kwargs):
            calls.append(kwargs['input_text'])
            self.assertIn('retained Tony vocal references', kwargs['input_text'])
            self.assertIn('Our familiar hook and words', kwargs['input_text'])
            self.assertIn('"voiceModel": "v7"', kwargs['input_text'])
            output = Path(command[command.index('--output-last-message') + 1])
            save(output, {**plan(), 'recipe': 'new' if len(calls) == 1 else 'reinterpretation'})
        with patch('planner.run_owned', side_effect=compose):
            accepted = make_plan(self.config, request, job, [basis])
        self.assertEqual(accepted['recipe'], 'reinterpretation')
        self.assertEqual(len(calls), 2)
        self.assertEqual(load(job / 'source-material.json')['vocal_reference_sha256'], sha(self.work / 'matched-vocals.wav'))
        with patch('planner.run_owned', side_effect=AssertionError('A retry cannot replan')):
            self.assertEqual(make_plan(self.config, request, job, [basis]), accepted)

if __name__ == '__main__': unittest.main()
