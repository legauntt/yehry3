"""Resumable audio-only Whisper backfill. No generation, lyric prompts or public writes."""
import argparse
import contextlib
import ctypes
import importlib.util
import json
import os
import sys
import time
from pathlib import Path
from transcribe_performance import digest, public_draft, read, recognize, write
from transcript_sources import resolve_source
from common import singleton
from transcript_data import public_transcript

RECIPE = 'unprompted-multilingual-v2'


def transcribe_song(song, source, cache, model, model_name='large-v3-turbo'):
    folder = Path(cache) / song['id'] / source['audio_sha256'] / model_name / RECIPE
    # A trimmed final export can require the mix instead of its longer stem.
    # Retain both pieces of private evidence under their own input identity.
    if (folder / 'evidence.json').exists() and read(folder / 'evidence.json').get('signature', {}).get('vocal_sha256') != source['vocal_sha256']:
        folder /= source['vocal_sha256']
    evidence_path = folder / 'evidence.json'
    signature = {key: source[key] for key in ('audio_sha256', 'vocal_sha256', 'manifest_sha256')}
    signature.update(model=model_name, recipe=RECIPE)
    if evidence_path.exists():
        evidence = read(evidence_path)
        if evidence.get('signature') != signature or evidence.get('words_sha256') != digest(folder / 'words.json'):
            raise ValueError('Cached audio transcription identity changed')
        rows, duration = read(folder / 'words.json'), evidence['duration']
    else:
        started = time.monotonic()
        rows, duration = recognize(model, source['vocals'], language=None)
        if digest(source['vocals']) != source['vocal_sha256']:
            raise ValueError('Recognition input changed')
        write(folder / 'words.json', rows)
        write(evidence_path, {'signature': signature, 'duration': duration,
                             'input_file': str(source['vocals']), 'recording_file': str(source['recording']),
                             'words_sha256': digest(folder / 'words.json'),
                             'elapsed_seconds': time.monotonic() - started,
                             'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                             'listening_review': False})
    draft = public_draft(song, source, rows, model_name, duration, allow_empty=True)
    write(folder / 'public-draft.json', draft)
    return draft


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--basis-root', type=Path, required=True)
    parser.add_argument('--speech-root', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='Local public draft directory; does not deploy')
    parser.add_argument('--progress', type=Path, help='Private progress file for this batch')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--song', action='append')
    parser.add_argument('--threads', type=int, default=4, choices=range(1, 9))
    parser.add_argument('--device', choices=('cpu', 'cuda'), default='cpu')
    parser.add_argument('--studio-dir', type=Path)
    parser.add_argument('--engine-root', type=Path)
    parser.add_argument('--cuda-root', type=Path)
    parser.add_argument('--gpu-child', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    for name in ('catalog', 'basis_root', 'speech_root', 'cache', 'output', 'progress', 'studio_dir', 'engine_root', 'cuda_root'):
        if getattr(args, name) is not None:
            setattr(args, name, getattr(args, name).resolve())
    if args.cache.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        parser.error('Private cache must be outside the repository')
    progress = args.progress or args.cache / 'catalog-progress.json'
    if progress.is_relative_to(Path(__file__).resolve().parents[1]):
        parser.error('Private progress must be outside the repository')
    if os.name == 'nt':
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    sys.path[:0] = [str(args.speech_root / 'audio-tools'), str(args.speech_root / 'speech-tools')]
    model = None
    results = []
    songs = read(args.catalog)['songs']
    if args.song:
        songs = [song for song in songs if song['id'] in args.song]
    if args.limit:
        songs = songs[:args.limit]
    for index, song in enumerate(songs):
        target = args.output / (song['id'] + '.whisper.json')
        row = {'songId': song['id'], 'title': song['title']}
        started = time.monotonic()
        try:
            if target.exists() and read(target).get('audioUrl') == song['url']:
                public_transcript(read(target), song)
                row['status'] = 'existing'
            else:
                print(f"START {index + 1}/{len(songs)} {song['title']}", flush=True)
                if args.device == 'cuda' and not args.gpu_child:
                    if not all((args.studio_dir, args.engine_root, args.cuda_root)):
                        raise ValueError('CUDA requires the shared studio lock, engine and private DLL directories')
                    # A fresh child releases all CUDA memory before another song
                    # or the production renderer acquires the existing GPU lock.
                    command = [sys.executable, str(Path(__file__).resolve()), '--catalog', str(args.catalog),
                               '--basis-root', str(args.basis_root), '--speech-root', str(args.speech_root),
                               '--cache', str(args.cache), '--output', str(args.output), '--song', song['id'],
                               '--device', 'cuda', '--gpu-child', '--studio-dir', str(args.studio_dir),
                               '--engine-root', str(args.engine_root), '--cuda-root', str(args.cuda_root)]
                    from winprocess import run_owned
                    run_owned(command, Path(__file__).parent, args.cache / 'gpu-child.log', timeout=3600)
                    draft = read(target)
                    row.update(status='transcribed', segments=len(draft['segments']), input=draft['input'])
                    time.sleep(2.5) # Let the renderer's two-second GPU waiter go first.
                else:
                    with singleton(args.cache / 'locks' / (song['id'] + '.lock')) as owned:
                        if not owned:
                            row['status'] = 'busy'
                        else:
                            source = resolve_source(song, args.basis_root, args.cache)
                            lock = contextlib.nullcontext()
                            dlls = []
                            if args.device == 'cuda':
                                spec = importlib.util.spec_from_file_location('transcript_gpu_engine', args.engine_root / 'engine_tasks.py')
                                engine = importlib.util.module_from_spec(spec)
                                spec.loader.exec_module(engine)
                                lock = engine.gpu_lock(args.studio_dir)
                                dll_dir = str(args.cuda_root / 'bin')
                                os.environ['PATH'] = dll_dir + os.pathsep + os.environ['PATH']
                                dlls.append(os.add_dll_directory(dll_dir))
                            with lock:
                                if model is None:
                                    from faster_whisper import WhisperModel
                                    model = WhisperModel('large-v3-turbo', device=args.device,
                                                         compute_type='int8_float16' if args.device == 'cuda' else 'int8',
                                                         cpu_threads=args.threads, download_root=str(args.speech_root / 'speech-models'),
                                                         local_files_only=True)
                                draft = transcribe_song(song, source, args.cache, model)
                                write(target, public_transcript(draft, song))
                                row.update(status='transcribed', segments=len(draft['segments']), input=draft['input'])
                                if args.device == 'cuda':
                                    model.model.unload_model()
        except Exception as error:
            row.update(status='error', error=f'{type(error).__name__}: {error}')
        row['seconds'] = round(time.monotonic() - started, 1)
        results.append(row)
        if not args.gpu_child:
            write(progress, {'total': len(songs), 'finished': len(results), 'songs': results})
        print(json.dumps(row, ensure_ascii=False), flush=True)
    return int(any(row['status'] == 'error' for row in results))


if __name__ == '__main__':
    raise SystemExit(main())
