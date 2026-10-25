import copy
import tempfile
import unittest
from pathlib import Path
from common import fingerprint, load, save, sha
from nonverbal_recovery import BASE, REPORT, measurements, policy_source, prepare, verify


class NonverbalRecoveryTests(unittest.TestCase):
    def fixture(self, root):
        work = root/'work'; directory = root/'job'; work.mkdir(); directory.mkdir()
        plan = {'vocal_mode': 'nonverbal', 'lyrics': 'Mmm hrru nng aa'}
        request = {'directory': str(directory), 'prompt_id': 'job', 'plan': plan, 'music_backend': 'local'}
        save(directory/'planning-input.json', {'brief': {'prompt': 'Only nonverbal breaths and grunts', 'details': {}}})
        save(work/'track.json', plan)
        save(work/'desktop-job.json', {'track_sha256': sha(work/'track.json'), 'workers': {}})
        save(work/'distonyc-configured.json', {'prompt_id': 'job', 'plan_hash': fingerprint(plan)})
        for name in BASE:
            if not (work/name).exists(): (work/name).write_bytes(b'preserved source')
        evidence = {'duration': 540, 'first_detected_voice': 4.38, 'last_detected_voice': 522.5,
                    'voiced_energy_fraction': .4102, 'last_second_mix_dbfs': -72.15}
        save(work/'arrangement-checks.json', evidence)
        save(work/'desktop-status.json', {'status': 'failed', 'stage': 'configure',
            'completed': ['generate', 'separate', 'words'], 'error': 'Insufficient vocal signal activity'})
        return request, work, evidence

    def test_one_recovery_pins_source_and_keeps_all_frozen_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            request, work, evidence = self.fixture(Path(temporary))
            before = {name: (work/name).read_bytes() for name in BASE}
            self.assertTrue(prepare(request, work))
            self.assertFalse(prepare(request, work))
            self.assertTrue(verify(work, evidence))
            import numpy as np
            self.assertTrue(verify(work, {key: np.float64(value) if isinstance(value, float) else value
                                         for key, value in evidence.items()}))
            self.assertEqual(before, {name: (work/name).read_bytes() for name in BASE})
            (work/'selected-vocals.wav').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'inputs changed'): verify(work)

    def test_wrong_intent_and_bad_evidence_are_not_relaxed(self):
        with tempfile.TemporaryDirectory() as temporary:
            request, work, evidence = self.fixture(Path(temporary))
            self.assertFalse(prepare({**request, 'plan': {}}, work))
            save(Path(request['directory'])/'planning-input.json', {'brief': {'prompt': 'Ordinary lyrics', 'details': {}}})
            with self.assertRaisesRegex(ValueError, 'does not request'): prepare(request, work)
            for changes in ({'voiced_energy_fraction': .01}, {'duration': float('nan')},
                            {'last_detected_voice': 30}, {'last_detected_voice': 540, 'last_second_mix_dbfs': -5}):
                with self.assertRaises(ValueError): measurements({**evidence, **changes})

    def test_only_exact_activity_assertion_is_adapted_and_other_guards_run(self):
        source = "assert float(mask.mean())>=.50,('Insufficient vocal signal activity',evidence)\nassert ending, 'ending failed'\n"
        with tempfile.TemporaryDirectory() as temporary:
            request, work, evidence = self.fixture(Path(temporary)); prepare(request, work)
            transformed = policy_source(source, work)
            class Mask:
                def mean(self): return .41
            with self.assertRaisesRegex(AssertionError, 'ending failed'):
                exec(transformed, {'mask': Mask(), 'evidence': evidence, 'ending': False,
                                   '_distonyc_accept_nonverbal': lambda row: verify(work, row)})
            with self.assertRaisesRegex(ValueError, 'Unsupported'):
                policy_source(source.replace('>=.50', '>=.60'), work)
            changed = copy.deepcopy(evidence); changed['voiced_energy_fraction'] = .42
            with self.assertRaisesRegex(ValueError, 'evidence changed'): verify(work, changed)


if __name__ == '__main__': unittest.main()
