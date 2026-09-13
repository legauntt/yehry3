"""Read the saved catalog's actual words and vocal references for genre versions."""
from pathlib import Path
from common import inside, load, sha


def source_material(config, basis):
    if len(basis) != 1: return None
    selected = basis[0]
    catalog = Path(config['settings']['studio_dir']).parent / 'catalog-expansion-v6'
    rows = load(catalog / 'sources.json')
    row = next((row for row in rows if row.get('source_sha256', row.get('sha256')) == selected['sha256']), None)
    if not row: return None
    recording = row['recording']
    transcript = inside(catalog / 'transcripts' / (recording + '.json'), catalog)
    if not transcript.is_file(): return None
    data = load(transcript)
    segments = data.get('segments', []) if isinstance(data, dict) else data
    text = '\n'.join(segment.get('text', '').strip() for segment in segments).strip()
    if not text: return None
    # Catalog recordings without a cached separation legitimately store null.
    # They can still condition an inspired original from the public recording.
    cached_stems = row.get('cached_stems') or {}
    vocals = cached_stems.get('vocals') if isinstance(cached_stems, dict) else None
    if not vocals or not Path(vocals).is_file():
        # New catalog separations are journaled separately; cached_stems only
        # describes stems reused from earlier catalog generations.
        separation = inside(catalog / 'separation-status' / (recording + '.json'), catalog)
        if separation.is_file():
            saved = load(separation)
            if (saved.get('status') == 'completed' and saved.get('recording') == recording
                    and saved.get('source_sha256') == selected['sha256']):
                paths = saved.get('paths') or {}
                candidate = paths.get('vocals') if isinstance(paths, dict) else None
                if candidate: vocals = str(inside(candidate, catalog / 'source-stems'))
    if not vocals or not Path(vocals).is_file(): return None
    vocals = inside(vocals, catalog.parent)
    phonetics = catalog / 'phonetics' / (recording + '.json')
    return {'basis_id': selected['id'], 'title': selected['title'], 'recording': recording,
            'source_sha256': selected['sha256'], 'lyrics_draft': text[:16000], 'lyrics_verified': False,
            'transcript_sha256': sha(transcript), 'vocal_reference_path': str(vocals),
            'vocal_reference_sha256': sha(vocals),
            'phonetics_sha256': sha(phonetics) if phonetics.is_file() else None,
            'reference_intervals': [[9.4, 16.4], [54., 61.], [179.8, 186.8]] if recording == '03-dabez' else None}
