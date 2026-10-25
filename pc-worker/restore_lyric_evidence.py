"""Recreate missing lyric audit evidence from hash-verified retained vocal stems.

CPU only, one model with bounded background workers. Writes only the separate audit
cache, never a production directory, public lyrics, or audio. Resume is idempotent.
"""
import argparse
import os
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from common import load, save, sha, inside


def retained_source(song, basis_root):
    for path in sorted((basis_root / 'published' / song['id']).glob('*/source.json')):
        manifest = load(path)
        source = manifest.get('source', {})
        if source.get('url') != song['url']: continue
        vocals = path.parent / 'vocals.wav'
        expected = manifest.get('material', {}).get('vocal_reference_sha256')
        if not vocals.is_file() or not expected: continue
        if sha(vocals) != expected: raise ValueError(f"Retained vocal hash changed: {song['id']}")
        return path, manifest, vocals
    return None


def restore_song(song, args, model):
    target = inside(args.cache / song['id'], args.cache)
    identity = target / 'evidence.json'
    if identity.exists() and (target / 'matched-vocals-words.json').exists():
        old = load(identity)
        if old['url'] == song['url'] and sha(target / 'matched-vocals-words.json') == old['words_sha256']:
            return f"CACHED {song['id']}"
        raise ValueError('Audit cache belongs to another recording or was modified')
    retained = retained_source(song, args.basis_root)
    if not retained: return f"MISSING {song['id']}: no verified retained vocal stem"
    path, manifest, vocals = retained
    started = time.monotonic()
    segments, _ = model.transcribe(str(vocals), language='en', beam_size=5,
                                  word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
    rows = [{'start': s.start, 'end': s.end, 'text': s.text,
             'words': [{'word': w.word, 'start': w.start, 'end': w.end, 'probability': w.probability}
                       for w in s.words]} for s in segments]
    save(target / 'matched-vocals-words.json', rows)
    save(identity, {'id': song['id'], 'title': song['title'], 'url': song['url'],
                    'audio_sha256': manifest['source']['sha256'], 'source_manifest_sha256': sha(path),
                    'vocal_sha256': manifest['material']['vocal_reference_sha256'],
                    'words_sha256': sha(target / 'matched-vocals-words.json'),
                    'model': 'faster-whisper base.en CPU int8', 'listening_review': False})
    return f"TRANSCRIBED {song['id']}: {song['title']} ({time.monotonic() - started:.1f}s)"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--basis-root', type=Path, required=True)
    parser.add_argument('--speech-root', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=1)
    args = parser.parse_args()
    if os.name == 'nt':
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    sys.path[:0] = [str(args.speech_root / 'audio-tools'), str(args.speech_root / 'speech-tools')]
    from faster_whisper import WhisperModel
    model = WhisperModel('base.en', device='cpu', compute_type='int8', cpu_threads=2,
                         num_workers=args.workers, download_root=str(args.speech_root / 'speech-models'), local_files_only=True)
    songs = [song for song in load(args.report)['songs'] if song['status'] == 'unverified']
    if args.limit: songs = songs[:args.limit]
    errors = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(restore_song, song, args, model): song['id'] for song in songs}
        for future in as_completed(futures):
            try: print(future.result(), flush=True)
            except Exception as error:
                errors.append({'id': futures[future], 'error': str(error)})
                print(f"FAILED {futures[future]}: {type(error).__name__}: {error}", flush=True)
    save(args.cache / 'errors.json', errors)
    if errors: raise SystemExit(1)


if __name__ == '__main__': main()
