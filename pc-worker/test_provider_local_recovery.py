import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from common import fingerprint, load, save, sha
import provider_local_recovery as recovery


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        job = root / 'job'
        job.mkdir()
        self.request = {'prompt_id': 'test', 'directory': str(job), 'music_backend': 'eleven_music',
                        'paid_authorization': {'reservedCents': 275}, 'basis': [],
                        'voice_model': 'v9', 'voice_epoch': 150,
                        'plan': {'recipe': 'new', 'lyrics': 'Yeh yeh yow', 'duration': 165},
                        'config': {'settings': {'studio_dir': str(root / 'studio')},
                                   'automatic_outro_retry': True}}
        work = recovery.work_path(self.request)
        work.mkdir()
        save(work / 'track.json', {'test': True})
        save(work / 'desktop-job.json', {'track_sha256': sha(work / 'track.json'), 'workers': {}})
        save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'generate', 'completed': []})
        save(work / 'paid-request.json', {})
        save(work / 'paid-inputs.json', {})
        save(work / 'paid-error.json', {'http_status': 400, 'prompt_id': 'test',
                                      'detail': {'status': 'bad_composition_plan',
                                                 'message': 'Terms of Service'}})
        save(work / 'distonyc-configured.json', {'plan_hash': fingerprint(self.request['plan'])})
        for name in recovery.PLANNING: save(job / name, self.request if name == 'render-request.json' else {})

    def prepare(self):
        return recovery.prepare(self.request, 'Jesse explicitly authorized Local ACE recovery')

    def test_preserves_original_and_one_child_across_restarts(self):
        original = copy.deepcopy(self.request)
        record = self.prepare()
        self.assertEqual(self.prepare(), record)
        child = recovery.verify(self.request, record)
        self.assertEqual(child['plan'], original['plan'])
        self.assertEqual(child['voice_model'], 'v9')
        self.assertEqual(child['voice_epoch'], 150)
        self.assertEqual(child['music_backend'], 'local')
        self.assertNotIn('paid_authorization', child)
        self.assertEqual(self.request, original)
        seen = []
        def render(value):
            seen.append(value)
            return {'status': 'verified', 'work_path': str(recovery.work_path(value))}
        result = recovery.render_recovery(self.request, render)
        self.assertEqual(len(seen), 1)
        self.assertEqual(result['music_backend'], 'local')
        self.assertIsNone(recovery.render_recovery(child, render))
        self.assertEqual(load(Path(original['directory']) / 'render-request.json'), original)

    def test_refuses_audio_uncertain_response_and_changed_inputs(self):
        work = recovery.work_path(self.request)
        save(work / 'paid-receipt.json', {})
        with self.assertRaises(ValueError): self.prepare()
        (work / 'paid-receipt.json').unlink()
        error = load(work / 'paid-error.json')
        error['http_status'] = 500
        save(work / 'paid-error.json', error)
        with self.assertRaises(ValueError): self.prepare()
        error['http_status'] = 400
        save(work / 'paid-error.json', error)
        record = self.prepare()
        record['attempts'] = 0
        with self.assertRaises(ValueError): recovery.verify(self.request, record)
        record['attempts'] = 1
        save(Path(self.request['directory']) / 'plan.json', {'changed': True})
        with self.assertRaises(ValueError): recovery.verify(self.request, record)

    def test_failure_retains_child_for_resume(self):
        self.prepare()
        with self.assertRaises(RuntimeError):
            recovery.render_recovery(self.request, lambda _: (_ for _ in ()).throw(RuntimeError('GPU timeout')))
        record = self.prepare()
        self.assertEqual(record['attempts'], 1)
        self.assertEqual(record['status'], 'failed')

    def test_server_revision_must_match_the_preserved_authorization(self):
        record = self.prepare()
        old = {'musicBackend': 'eleven_music', 'voiceModel': 'v9'}
        prompt = {'details': {**old, 'musicBackend': 'local'},
                  'paidAuthorization': self.request['paid_authorization'],
                  'backendRevisions': [{'requestId': record['operation_id'], 'backend': 'local',
                      'reason': 'provider_policy', 'previousDetails': old,
                      'previousPaidAuthorization': self.request['paid_authorization']}]}
        frozen = recovery.frozen_prompt(prompt, self.request['directory'])
        self.assertEqual(frozen['details'], old)
        self.assertEqual(prompt['details']['musicBackend'], 'local')
        prompt['details']['voiceModel'] = 'v6'
        with self.assertRaises(ValueError): recovery.frozen_prompt(prompt, self.request['directory'])

    def test_normal_requests_do_not_need_recovery_files(self):
        prompt = {'details': {'musicBackend': 'local'}}
        self.assertIs(recovery.frozen_prompt(prompt, self.request['directory']), prompt)
        self.assertIsNone(recovery.render_recovery({}, lambda _: None))


if __name__ == '__main__': unittest.main()
