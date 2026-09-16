"""Frozen per-song reference conditioning for a brief planned vocal accent."""
import hashlib
import json


def install(base):
    original = base.references

    def references():
        original()
        np, sf, work = base.np, base.sf, base.HERE
        reference = base.CONFIG['vocal_accent_reference']
        path = work / 'vocal-accent-reference.wav'
        if hashlib.sha256(path.read_bytes()).hexdigest() != reference['sha256']:
            raise ValueError('Frozen vocal-accent reference changed')
        existing, sr = sf.read(work / 'catalog-reference.wav', dtype='float32', always_2d=True)
        accent, reference_sr = sf.read(path, dtype='float32', always_2d=True)
        if sr != 44100 or reference_sr != sr or len(accent) != round(9.5 * sr):
            raise ValueError('Invalid first-half vocal reference format')
        if existing.shape[1] != 2 or accent.shape[1] != 2 or not np.isfinite(accent).all():
            raise ValueError('Invalid vocal reference audio')
        energy = float(np.sqrt(np.mean(accent * accent)))
        if energy < .00001:
            raise ValueError('Vocal technique reference is silent')
        accent *= min(.09 / energy, .8 / max(float(np.max(np.abs(accent))), .00001))
        edge = 882
        accent[:edge] *= np.linspace(0, 1, edge)[:, None]
        accent[-edge:] *= np.linspace(1, 0, edge)[:, None]
        sf.write(work / 'catalog-reference.wav', np.concatenate([existing, accent]), sr, subtype='PCM_24')
        manifest_path = work / 'reference-manifest.json'
        manifest = json.loads(manifest_path.read_text('utf-8'))
        manifest.setdefault('clips', []).append({'profile': reference['profile'], 'reference_sha256': reference['sha256'],
            'interval': [0, 9.5], 'duration': 9.5, 'role': 'User-preferred first-half vocal technique; only the planned brief accent',
            'lyric_source': 'The current song words, not the reference recording'})
        if 'reference_seconds' in manifest:
            manifest['reference_seconds'] += 9.5
        manifest.update(vocal_accent_reference_used=True, audio_copied_into_final_mix=False,
                        external_audio_upload=False, new_training=False)
        manifest_path.write_text(json.dumps(manifest, indent=2), 'utf-8')

    base.references = references
