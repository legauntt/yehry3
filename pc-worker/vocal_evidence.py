"""Conservative evidence for separator bleed, without changing any vocal audio."""
import math
import sys
from pathlib import Path
from common import load, save, sha

VERSION = 1
SR = 44100
WINDOW = 8820


def longest_run(windows):
    longest = run = 0
    previous = None
    for tick in sorted({round(t * 5) for t in windows}):
        run = run + 1 if previous is not None and tick == previous + 1 else 1
        longest = max(longest, run)
        previous = tick
    return longest / 5


def spectral_evidence(source, backing, a, b):
    import numpy as np
    from scipy.signal import butter, find_peaks, sosfiltfilt, welch
    def rms(x): return float(np.sqrt(np.mean(x * x) + 1e-14))
    def correlation(x, y):
        value = float(np.corrcoef(x, y)[0, 1])
        return value if math.isfinite(value) else None
    x = source[a:b]
    mid = x.mean(axis=1)
    f, p = welch(mid, fs=SR, nperseg=2048)
    low_fraction = float(p[f < 400].sum() / max(float(p.sum()), 1e-30))
    high = sosfiltfilt(butter(4, 500, fs=SR, btype='highpass', output='sos'), mid)
    result = {'low_frequency_fraction': low_fraction,
              'upper_band_dbfs': 20 * math.log10(rms(high)),
              'stereo_correlation': correlation(x[:, 0], x[:, 1])}
    # Pitch alone cannot distinguish a consonant from a gap. Broadband and
    # center-dominant sound always stays subject to the original dropout check.
    if (low_fraction < .98 or result['upper_band_dbfs'] >= -45 or
            result['stereo_correlation'] is None or result['stereo_correlation'] >= .8):
        return result
    f, p = welch(mid, fs=SR, nperseg=len(mid))
    peak = float(f[int(np.argmax(p))])
    result['dominant_frequency_hz'] = peak
    if not 120 <= peak < 400:
        return result
    bf, bp = welch(backing[a:b].mean(axis=1), fs=SR, nperseg=len(mid))
    peaks, _ = find_peaks(bp)
    peaks = peaks[(bf[peaks] >= 120) & (bf[peaks] < 400)]
    strongest = peaks[np.argsort(bp[peaks])[-3:]]
    result['matching_backing_peak'] = bool(any(abs(float(bf[i]) - peak) <= 5 for i in strongest))
    if not result['matching_backing_peak']:
        return result
    sos = butter(4, [peak - 15, peak + 15], fs=SR, btype='bandpass', output='sos')
    narrow_source = sosfiltfilt(sos, source, axis=0)[a:b]
    narrow_backing = sosfiltfilt(sos, backing, axis=0)[a:b]
    result['backing_channel_correlations'] = [correlation(narrow_source[:, i], narrow_backing[:, i]) for i in (0, 1)]
    result['spectral_candidate'] = all(value is not None and value >= .95 for value in result['backing_channel_correlations'])
    return result


def confirmed_bleed(evidence):
    return (evidence.get('spectral_candidate') is True and
            evidence.get('source_voiced_frames') == [0, 0, 0])


def source_pitch(work, source):
    import numpy as np
    import torch
    from scipy.signal import resample_poly
    sys.path.insert(0, str(work.parent / 'voice-lab' / 'seed-vc'))
    from modules.rmvpe import RMVPE
    torch.backends.mkldnn.enabled = False
    torch.set_num_threads(2)
    model = RMVPE(str(work.parent / 'voice-lab/models/rmvpe.pt'), is_half=False, device='cpu')
    contours = []
    for x in (source[:, 0], source[:, 1], source.mean(axis=1)):
        rms = float(np.sqrt(np.mean(x * x) + 1e-14))
        gain = min(.1 / rms, .89 / max(float(np.max(np.abs(x))), 1e-9))
        wave = resample_poly(x * gain, 160, 441).astype('float32')
        with torch.inference_mode():
            contours.append(model.infer_from_audio(torch.from_numpy(wave), thred=.03))
    return contours


def review(work, weak, raw_longest):
    """Fail closed unless multiple independent checks identify a shared backing tone."""
    work = Path(work).resolve()
    if raw_longest <= .4:
        return weak, raw_longest
    report = {'version': VERSION, 'status': 'unavailable', 'raw_weak_windows': weak,
              'raw_longest_missing_vocal_run_seconds': raw_longest, 'windows': [],
              'excluded_backing_bleed_windows': [], 'audio_changed': False,
              'listening_review': False, 'dropout_thresholds_unchanged': True}
    try:
        import numpy as np
        import soundfile as sf
        ticks = sorted({round(t * 5) for t in weak})
        groups = []
        for tick in ticks:
            if groups and tick == groups[-1][-1] + 1: groups[-1].append(tick)
            else: groups.append([tick])
        if len(groups) > 3 or len(ticks) > 20:
            raise ValueError('Vocal evidence review is limited to three passages / four seconds')
        inputs = {name: sha(work / name) for name in ('selected-vocals.wav', 'selected-backing.wav', 'matched-vocals.wav')}
        inputs['policy'] = sha(Path(__file__))
        inputs['pitch_model'] = sha(work.parent / 'voice-lab/models/rmvpe.pt')
        report['inputs_sha256'] = inputs
        path = work / 'vocal-evidence.json'
        if path.exists():
            cached = load(path)
            if (cached.get('version') == VERSION and cached.get('status') == 'reviewed' and
                    cached.get('inputs_sha256') == inputs and cached.get('raw_weak_windows') == weak):
                return cached['remaining_weak_windows'], cached['longest_missing_vocal_run_seconds']
        duration = sf.info(work / 'selected-vocals.wav').duration
        for group in groups:
            start = max(0, min(math.floor(group[0] / 5) - 4, duration - 10))
            end = min(duration, max(start + 10, group[-1] / 5 + 1))
            source, sr = sf.read(work / 'selected-vocals.wav', start=round(start * SR), stop=round(end * SR), dtype='float32', always_2d=True)
            backing, br = sf.read(work / 'selected-backing.wav', start=round(start * SR), stop=round(end * SR), dtype='float32', always_2d=True)
            if sr != SR or br != SR or source.shape != backing.shape or source.shape[1] != 2 or not np.isfinite(source).all() or not np.isfinite(backing).all():
                raise ValueError('Invalid stereo evidence inputs')
            rows = []
            for tick in group:
                t = tick / 5
                a = round((t - start) * SR)
                evidence = spectral_evidence(source, backing, a, a + WINDOW)
                rows.append({'start': t, 'context': [start, end], **evidence})
            if any(row.get('spectral_candidate') for row in rows):
                contours = source_pitch(work, source)
                for row in rows:
                    if not row.get('spectral_candidate'): continue
                    a, b = round((row['start'] - start) * 100), round((row['start'] + .2 - start) * 100)
                    if any(len(f0) < b for f0 in contours): raise ValueError('Incomplete source pitch evidence')
                    row['source_voiced_frames'] = [int((f0[a:b] > 1).sum()) for f0 in contours]
            report['windows'].extend(rows)
        excluded = [row['start'] for row in report['windows'] if confirmed_bleed(row)]
        remaining = [t for t in weak if round(t * 5) not in {round(x * 5) for x in excluded}]
        report.update(status='reviewed', excluded_backing_bleed_windows=excluded,
                      remaining_weak_windows=remaining, longest_missing_vocal_run_seconds=longest_run(remaining))
        save(path, report)
        return remaining, report['longest_missing_vocal_run_seconds']
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'[:1000]
        try: save(work / 'vocal-evidence.json', report)
        except OSError: pass
        return weak, raw_longest
