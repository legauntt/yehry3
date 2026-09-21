import json, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import soundfile as sf

import inactive_voice_repair as repair
from common import load, save, sha
from inactive_voice_repair import SR, apply, assemble, check_limits, envelope, inactive_rows, validate


class InactiveVoiceRepairTests(unittest.TestCase):
    def engine(self, work):
        def validate_active(rows):
            save(work / 'voice-checks.json', {'chunks': [{'label': row['label']} for row in rows], 'passed': True})
        return SimpleNamespace(env=envelope,
            rms=lambda audio: float(np.sqrt(np.mean(audio * audio) + 1e-14)),
            connected_gate=lambda env, rate: np.ones_like(env), validate=validate_active)

    def six_section_fixture(self, work):
        (work / 'conversion').mkdir()
        duration = 56
        time = np.arange(SR * duration) / SR
        signal = (.06 * (1 + .2 * np.sin(2 * np.pi * .8 * time)) * np.sin(2 * np.pi * 180 * time)).astype('float32')
        source = np.repeat(signal[:, None], 2, axis=1)
        rows = [{'label': f'phrase-{index + 1:03d}',
                 'interval': [max(0, index * 2 - .1), min(duration, (index + 1) * 2 + .1)]}
                for index in range(28)]
        silent = {rows[index]['label'] for index in (0, 4, 8, 12, 16, 20)}
        for row in rows:
            if row['label'] in silent:
                a, b = [round(value * SR) for value in row['interval']]
                source[a:b] = 0
        sf.write(work / 'selected-vocals.wav', source, SR, subtype='FLOAT')
        sf.write(work / 'selected-backing.wav', np.full_like(source, .01), SR, subtype='FLOAT')
        for row in rows:
            a, b = [round(value * SR) for value in row['interval']]
            converted = source[a:b] * .5
            if row['label'] in silent:
                converted = np.full_like(converted, .015)
            sf.write(work / 'conversion' / (row['label'] + '-converted.wav'), converted, SR, subtype='FLOAT')
            np.save(work / 'conversion' / (row['label'] + '-f0.npy'), np.full(210, 180, dtype='float32'))
        save(work / 'conversion-plan.json', {'duration': duration, 'chunks': rows})
        save(work / 'voice-profile.json', {'files': {'adapter': 'saved-v7.pt'}})
        save(work / 'track.json', {'voice_model': 'v7'})
        (work / 'engine_voice.py').write_text('# retained engine fixture\n')
        save(work / 'desktop-status.json', {'status': 'failed', 'stage': 'assemble', 'completed': ['diffuse', 'vocode']})
        return rows, silent

    def test_six_sections_recover_once_preserving_backing_and_active_chunks(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            rows, silent = self.six_section_fixture(work)
            originals = {row['label']: sha(work / 'conversion' / (row['label'] + '-converted.wav')) for row in rows}
            backing_hash = sha(work / 'selected-backing.wav')
            engine = self.engine(work)
            with patch.object(repair.importlib.util, 'spec_from_file_location') as spec, \
                    patch.object(repair.importlib.util, 'module_from_spec', return_value=engine):
                spec.return_value.loader.exec_module.return_value = None
                apply(work)
                first = sha(work / 'matched-vocals.wav')
                apply(work)
            self.assertEqual(sha(work / 'matched-vocals.wav'), first)
            self.assertEqual(sha(work / 'selected-backing.wav'), backing_hash)
            for row in rows:
                label = row['label']
                current = work / 'conversion' / (label + '-converted.wav')
                if label in silent:
                    retained = work / 'inactive-voice-repair/originals' / current.name
                    self.assertEqual(sha(retained), originals[label])
                    self.assertEqual(float(np.max(np.abs(sf.read(current)[0]))), 0)
                else:
                    self.assertEqual(sha(current), originals[label])
            voice = sf.read(work / 'matched-vocals.wav', dtype='float32')[0]
            mix = sf.read(work / 'matched-mix.wav', dtype='float32')[0]
            backing = sf.read(work / 'selected-backing.wav', dtype='float32')[0]
            np.testing.assert_array_equal(mix, backing + voice)
            self.assertEqual(len(load(work / 'voice-checks.json')['chunks']), len(rows))
            report = load(work / repair.REPORT)
            self.assertEqual(report['version'], 2)
            self.assertEqual(report['status'], 'applied')
            self.assertEqual(len(report['sections']), 6)

    def test_changed_source_or_converted_section_is_rejected_on_restart(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            rows, silent = self.six_section_fixture(work)
            engine = self.engine(work)
            with patch.object(repair.importlib.util, 'spec_from_file_location') as spec, \
                    patch.object(repair.importlib.util, 'module_from_spec', return_value=engine):
                spec.return_value.loader.exec_module.return_value = None
                apply(work)
                for name in ('selected-backing.wav', 'track.json', 'conversion/phrase-002-converted.wav',
                             'conversion/phrase-001-f0.npy', 'conversion/phrase-001-converted.wav'):
                    with self.subTest(name=name):
                        target = work / name
                        before = target.read_bytes()
                        target.write_bytes(before + b'changed')
                        with self.assertRaisesRegex(ValueError, 'changed'):
                            apply(work)
                        target.write_bytes(before)

    def test_interrupted_validation_resumes_the_same_retained_sections(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            self.six_section_fixture(work)
            engine = self.engine(work)
            normal_validate = engine.validate
            engine.validate = lambda rows: (_ for _ in ()).throw(RuntimeError('interrupted validation'))
            with patch.object(repair.importlib.util, 'spec_from_file_location') as spec, \
                    patch.object(repair.importlib.util, 'module_from_spec', return_value=engine):
                spec.return_value.loader.exec_module.return_value = None
                with self.assertRaisesRegex(RuntimeError, 'interrupted validation'):
                    apply(work)
                journal = load(work / repair.REPORT)
                self.assertEqual(load(work / 'desktop-status.json')['stage'], 'validate')
                engine.validate = normal_validate
                apply(work)
            self.assertEqual(load(work / repair.REPORT)['sections'], journal['sections'])

    def test_opposite_stereo_vocals_are_not_classified_as_silence(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            signal = (.02 * np.sin(2 * np.pi * 180 * np.arange(SR) / SR)).astype('float32')
            sf.write(work / 'selected-vocals.wav', np.stack((signal, -signal), axis=1), SR, subtype='FLOAT')
            with self.assertRaisesRegex(ValueError, 'Stereo cancellation'):
                inactive_rows(work, [{'label': 'phrase-001', 'interval': [0, 1]}])

    def test_near_floor_stereo_residual_is_safely_inactive(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            time = np.arange(SR) / SR
            left = (.00085 * np.sin(2 * np.pi * 180 * time)).astype('float32')
            right = (.0017 * np.sin(2 * np.pi * 180 * time + .35)).astype('float32')
            sf.write(work / 'selected-vocals.wav', np.stack((left, right), axis=1), SR, subtype='FLOAT')
            found = inactive_rows(work, [{'label': 'phrase-001', 'interval': [0, 1]}])
            self.assertEqual([row['label'] for row in found], ['phrase-001'])
            self.assertTrue(found[0]['near_floor_stereo_residual'])

    def test_bounded_count_duration_and_performance_fraction_remain_enforced(self):
        rows = [{'interval': [index * 10, (index + 1) * 10], 'duration_seconds': 10} for index in range(6)]
        self.assertEqual(check_limits(rows, 260)['unique_seconds'], 60)
        with self.assertRaisesRegex(ValueError, 'limit'):
            check_limits(rows + [rows[0]], 260)
        with self.assertRaisesRegex(ValueError, 'limit'):
            check_limits([{'interval': [0, 61], 'duration_seconds': 61}], 260)
        with self.assertRaisesRegex(ValueError, 'share'):
            check_limits(rows, 120)
        self.assertEqual(check_limits([{'interval': [0, 25.5], 'duration_seconds': 25.5}], 100)['unique_seconds'], 25.5)
        with self.assertRaisesRegex(ValueError, 'share'):
            check_limits([{'interval': [0, 26.5], 'duration_seconds': 26.5}], 100)

        with self.assertRaisesRegex(ValueError, 'limit'):
            check_limits(rows, 260, legacy=True)

    def test_inactive_section_is_silenced_and_assembly_remains_contiguous(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            (work / 'conversion').mkdir()
            seconds = 3
            source = np.zeros((SR * seconds, 2), dtype='float32')
            first = round(.8 * SR)
            last = round(.8 * SR)
            source[:first] = (.08 * np.sin(2 * np.pi * 180 * np.arange(first) / SR))[:, None]
            source[-last:] = (.08 * np.sin(2 * np.pi * 180 * np.arange(last) / SR))[:, None]
            sf.write(work / 'selected-vocals.wav', source, SR, subtype='FLOAT')
            sf.write(work / 'selected-backing.wav', np.zeros_like(source), SR, subtype='FLOAT')
            rows = [
                {'label': 'phrase-001', 'interval': [0, 1.1]},
                {'label': 'phrase-002', 'interval': [.9, 2.1]},
                {'label': 'phrase-003', 'interval': [1.9, 3]},
            ]
            for row in rows:
                a, b = [round(value * SR) for value in row['interval']]
                converted = source[a:b] * .5
                sf.write(work / 'conversion' / (row['label'] + '-converted.wav'), converted, SR, subtype='FLOAT')
            (work / 'voice-profile.json').write_text(json.dumps({'files': {'adapter': 'saved-adapter.pt'}}))
            found = inactive_rows(work, rows)
            self.assertEqual([row['label'] for row in found], ['phrase-002'])
            engine = SimpleNamespace(
                env=envelope,
                rms=lambda audio: float(np.sqrt(np.mean(audio * audio) + 1e-14)),
                connected_gate=lambda env, rate: np.ones_like(env),
            )
            assemble(engine, work, rows, found)
            np.save(work / 'conversion/phrase-002-f0.npy', np.full(120, 180, dtype='float32'))
            def validate_active(active):
                self.assertEqual([row['label'] for row in active], ['phrase-001', 'phrase-003'])
                (work / 'voice-checks.json').write_text(json.dumps({
                    'chunks': [{'label': row['label']} for row in active], 'passed': True}))
            engine.validate = validate_active
            validate(engine, work, rows, found)
            matched, rate = sf.read(work / 'matched-vocals.wav', dtype='float32', always_2d=True)
            self.assertEqual(rate, SR)
            self.assertLess(float(np.max(np.abs(matched[round(1.1 * SR):round(1.9 * SR)]))), 1e-7)
            report = json.loads((work / 'voice-assembly.json').read_text())
            self.assertTrue(report['chunks'][1]['inactive_source_section'])
            self.assertEqual(report['inactive_voice_repair'], 'inactive-voice-repair/status.json')
            checks = json.loads((work / 'voice-checks.json').read_text())
            repaired = next(row for row in checks['chunks'] if row['label'] == 'phrase-002')
            self.assertTrue(repaired['inactive_source_section'])
            self.assertEqual(repaired['converted_voiced_frames'], 0)


if __name__ == '__main__':
    unittest.main()
