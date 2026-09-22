"""Sing prepared barbershop-quartet chunks with the Tony V9 RVC model, following each one's saved
harmony pitch curve rather than Applio's own pitch tracker. Runs in Applio's own Python, started by
quartet_rvc.py's diffuse stage while the renderer already holds the studio GPU lock.

Reads conversion/<base>.wav (a role's guide content, from quartet.py's shared chunks stage) and
conversion/<target>-f0.npy (the target pitch curve for that specific role); writes
conversion/<target>-converted.wav (44.1 kHz mono float, the exact name quartet.py's assemble stage
already expects). Adapted from tony-v9-rvc/runtime-profile/rvc_sing.py's single-voice pitch-override
technique for four independently pitched parts sharing at most three content sources per chunk.
"""
import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np

SR = 44100
# Same retrieval/consonant-protection settings as the single-voice V9 pipeline (rvc_sing.py).
INDEX_RATE, PROTECT = .5, .33
GUIDE_ROLES = {'lead': 'lead', 'tenor': 'upper', 'baritone': 'upper', 'bass': 'bass'}


def padded(contour, pad, frames):
    """The saved contour on Applio's grid: it reflects `pad` frames of audio onto both ends before converting."""
    contour = np.pad(np.asarray(contour, dtype=np.float64), (pad, pad), mode='reflect')
    return np.pad(contour, (0, max(0, frames - len(contour))))[:frames]


def normalized(wave):
    wave = np.asarray(wave, dtype=np.float32)
    return wave * min(10 ** (-20 / 20) / (np.sqrt(np.mean(wave * wave)) + 1e-10), .89 / (np.max(np.abs(wave)) + 1e-10))


def targets_by_base(work):
    plan = json.loads((work / 'conversion-plan.json').read_text('utf-8'))
    result = {}
    for row in plan['chunks']:
        for role, base_name in GUIDE_ROLES.items():
            result[f"{role}-{row['index'] + 1:02}-voice"] = row['labels'][base_name]
    return result


def main():
    parser = argparse.ArgumentParser()
    for name in ('--work', '--applio', '--model', '--index'):
        parser.add_argument(name, type=Path, required=True)
    parser.add_argument('--labels', nargs='+', required=True)
    args = parser.parse_args()
    out = args.work / 'conversion'
    base_of = targets_by_base(args.work)

    os.chdir(args.applio); sys.path.insert(0, str(args.applio))
    import soundfile as sf
    import torch
    from scipy.signal import resample_poly
    import core
    from rvc.infer.pipeline import Pipeline
    current = {}

    def saved_contour(self, x, p_len, f0_method='rmvpe', pitch=0, f0_autotune=False, f0_autotune_strength=1., proposed_pitch=False,
                       proposed_pitch_threshold=155.):
        """Applio tracks pitch here. This target sings the quartet's own arranged curve, not the guide's."""
        assert pitch == 0 and not f0_autotune and not proposed_pitch, 'Any transposition belongs to the quartet arrangement'
        f0 = padded(current['f0'], self.t_pad // self.window, p_len)
        mel = 1127 * np.log(1 + f0 / 700)
        mel[mel > 0] = (mel[mel > 0] - self.f0_mel_min) * 254 / (self.f0_mel_max - self.f0_mel_min) + 1
        mel[mel <= 1] = 1; mel[mel > 255] = 255
        current['used'] = True
        return np.rint(mel).astype(int), f0
    Pipeline.get_f0 = saved_contour

    for index, target in enumerate(args.labels):
        base = base_of[target]
        source = out / (base + '.wav')
        raw = out / (target + '-rvc-48k.wav')
        raw.unlink(missing_ok=True)
        current.update(f0=np.load(out / (target + '-f0.npy')), used=False)
        torch.manual_seed(9500 + index)
        core.run_infer_script(pitch=0, index_rate=INDEX_RATE, volume_envelope=1, protect=PROTECT, f0_method='rmvpe',
            input_path=str(source), output_path=str(raw), pth_path=str(args.model), index_path=str(args.index), split_audio=False,
            f0_autotune=False, f0_autotune_strength=1., proposed_pitch=False, proposed_pitch_threshold=155., clean_audio=False,
            clean_strength=.5, export_format='WAV', embedder_model='contentvec')
        # Applio reports a failed conversion in its log and returns normally; the file and the monkeypatch flag are the evidence.
        assert raw.exists() and current['used'], f'Applio did not convert {target}'
        wave, rate = sf.read(raw, dtype='float32', always_2d=True)
        assert rate == 48000 and np.isfinite(wave).all() and len(wave), (target, rate)
        wave = resample_poly(wave.mean(axis=1), 147, 160)
        frames = sf.info(source).frames
        wave = normalized(np.pad(wave, (0, max(0, frames - len(wave))))[:frames])
        target_path = out / (target + '-converted.wav')
        partial = target_path.with_name(target_path.name + '.partial')
        sf.write(partial, wave, SR, subtype='FLOAT', format='WAV')
        os.replace(partial, target_path); raw.unlink()
        print(f'Converted {index + 1}/{len(args.labels)} ({target})', flush=True)


if __name__ == '__main__':
    main()
