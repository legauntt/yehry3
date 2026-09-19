"""Build a local conditioning reference from the chosen public recordings."""
import hashlib, json, subprocess
from pathlib import Path

def build_references(base):
    np, sf, work = base.np, base.sf, base.HERE
    pieces, clips = [], []
    for row in base.CONFIG['basis_sources']:
        path = Path(row.get('reference_path', row['path']))
        with path.open('rb') as handle: actual = hashlib.file_digest(handle, 'sha256').hexdigest()
        if actual != row.get('reference_sha256', row['sha256']): raise ValueError('A basis recording changed after planning')
        length = min(8., row['duration']); start = min(row['duration'] - length, row['duration'] * .25)
        intervals = row.get('reference_intervals') or [[max(0., start), max(0., start) + length]]
        for start, end in intervals:
            if not 0 <= start < end <= row['duration']: raise ValueError('Invalid basis reference interval')
            length = end - start
            raw = subprocess.check_output([base.FF, '-v', 'error', '-ss', str(start), '-i', str(path),
            '-t', str(length), '-ar', '44100', '-ac', '2', '-f', 'f32le', 'pipe:1'], creationflags=subprocess.CREATE_NO_WINDOW)
            audio = np.frombuffer(raw, dtype='<f4').reshape(-1, 2).copy()
            if len(audio) < 4410 or not np.isfinite(audio).all(): raise ValueError('Invalid basis audio')
            energy = float(np.sqrt(np.mean(audio * audio)))
            if energy < .00001: raise ValueError('Basis reference is silent; choose another recording')
            audio *= min(.13 / energy, .85 / max(float(np.max(np.abs(audio))), .00001))
            edge = min(882, len(audio) // 2)
            audio[:edge] *= np.linspace(0, 1, edge)[:, None]; audio[-edge:] *= np.linspace(1, 0, edge)[:, None]
            pieces.append(audio)
            clips.append({'title': row['title'], 'basis_id': row['id'], 'source_sha256': row['sha256'], 'reference_sha256': actual,
                      'interval': [start, start + length], 'role': 'Arrangement and timbre conditioning; not a melody-preservation guarantee'})
    sf.write(work / 'catalog-reference.wav', np.concatenate(pieces), 44100, subtype='PCM_24')
    (work / 'reference-manifest.json').write_text(json.dumps({'clips': clips, 'recordings': len(clips),
        'audio_copied_into_final_mix': False, 'external_audio_upload': False, 'voice': 'Saved full-catalog Tony V6'}), encoding='utf-8')
