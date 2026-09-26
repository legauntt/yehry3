"""Transcribe Tony's released performance, never the lyric sheet or guide singer.

Creates private evidence and a small, explicitly machine-generated public draft.
No catalog, worker configuration, production audio or written lyrics are changed.
"""
import argparse
import hashlib
import html
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

RECIPES = {'continuous': 'unprompted-continuous-v1', 'phrases': 'unprompted-tony-vocal-phrases-v2'}


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def performance_source(song, basis_root):
    """Only accept archived, converted Tony vocals for this exact released MP3."""
    if not re.fullmatch(r'[a-z0-9-]{1,120}', song['id']):
        raise ValueError('Invalid song ID')
    root = Path(basis_root).resolve()
    matches = []
    for manifest_path in (root / 'published' / song['id']).glob('*/source.json'):
        manifest = read(manifest_path)
        source = manifest.get('source', {})
        if source.get('songId') != song['id'] or source.get('url') != song['url']:
            continue
        folder = manifest_path.parent
        recording, vocals = folder / 'recording.mp3', folder / 'vocals.wav'
        for path in (manifest_path, recording, vocals):
            if not path.resolve().is_relative_to(root):
                raise ValueError('Archived performance escaped the basis directory')
        if not recording.is_file() or not vocals.is_file():
            raise ValueError('The released MP3 and converted Tony vocals are both required')
        audio_hash, vocal_hash = digest(recording), digest(vocals)
        if source.get('sha256') != audio_hash or source.get('bytes') != recording.stat().st_size:
            raise ValueError('The archived recording failed its published identity check')
        # Current release names independently pin the MP3's hash prefix.
        match = re.search(r'-([0-9a-f]{12,64})\.mp3$', song['url'])
        if not match or not audio_hash.startswith(match[1]):
            raise ValueError('This recording needs an independently pinned public audio hash')
        if manifest.get('material', {}).get('vocal_reference_sha256') != vocal_hash:
            raise ValueError('The converted Tony vocal stem failed its identity check')
        # This archive is produced by remix_sources.register from matched-vocals.wav
        # and verified final exports, not selected-vocals.wav or a source transcript.
        original = str(manifest.get('material', {}).get('vocal_reference_path', '')).replace('\\', '/')
        if original.rsplit('/', 1)[-1] != 'matched-vocals.wav':
            raise ValueError('Expected the converted Tony performance, not a guide vocal')
        matches.append({'recording': recording, 'vocals': vocals, 'manifest': manifest_path,
                        'audio_sha256': audio_hash, 'vocal_sha256': vocal_hash,
                        'manifest_sha256': digest(manifest_path)})
    if len(matches) != 1:
        raise ValueError('Exactly one verified archive of this released performance is required')
    return matches[0]


def recognize(model, audio):
    # Deliberately omit lyric prompts/hotwords: those can bias recognition back to
    # the intended words and conceal Tony's substitutions and ad-libs.
    audio_input = str(audio) if isinstance(audio, (str, Path)) else audio
    segments, info = model.transcribe(audio_input, language='en', beam_size=5,
                                     word_timestamps=True, vad_filter=False,
                                     condition_on_previous_text=False,
                                     initial_prompt=None, prefix=None, temperature=0)
    rows = []
    for segment in segments:
        rows.append({'start': segment.start, 'end': segment.end, 'text': segment.text.strip(),
                     'avg_logprob': segment.avg_logprob, 'no_speech_prob': segment.no_speech_prob,
                     'words': [{'word': word.word.strip(), 'start': word.start, 'end': word.end,
                                'probability': word.probability} for word in segment.words or []]})
    return rows, info.duration


def vocal_windows(audio, rate=16000):
    """Find energy in the verified vocal stem, without consulting words or cues.

    Padding retains quiet consonants; long gaps don't become invented speech.
    This is phrase detection for isolated vocals, not a speech-only VAD model.
    """
    import numpy as np
    frame = round(rate * .02)
    frames = np.pad(audio, (0, (-len(audio)) % frame)).reshape(-1, frame)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    if not len(rms) or float(rms.max()) < .0001:
        return []
    threshold = max(.0001, float(rms.max()) * 10 ** (-35 / 20))
    active = np.flatnonzero(rms >= threshold)
    groups = []
    start = previous = int(active[0])
    for index in active[1:]:
        if index - previous > 35:  # Join breaths within a phrase, up to .7 s.
            groups.append((start, previous + 1))
            start = int(index)
        previous = int(index)
    groups.append((start, previous + 1))
    duration, windows = len(audio) / rate, []
    for first, last in groups:
        if (last - first) * .02 < .12:
            continue
        start, end = max(0, first * .02 - .3), min(duration, last * .02 + .3)
        while end - start > 24:
            windows.append((start, start + 24))
            start += 24
        windows.append((start, end))
    return windows


def recognize_vocals(model, audio_path):
    from faster_whisper.audio import decode_audio
    audio = decode_audio(str(audio_path), sampling_rate=16000)
    windows = vocal_windows(audio)
    rows = []
    for index, (start, end) in enumerate(windows):
        print(f'Recognizing vocal phrase {index + 1}/{len(windows)} at {start:.2f}s', flush=True)
        chunk = audio[round(start * 16000):round(end * 16000)]
        # The recognizer accepts decoded audio arrays as well as file paths.
        recognized, _ = recognize(model, chunk)
        for row in recognized:
            row.update(start=start + row['start'], end=min(end, start + row['end']))
            for word in row['words']:
                word.update(start=start + word['start'], end=min(end, start + word['end']))
            rows.append(row)
    return rows, len(audio) / 16000, windows


def public_draft(song, source, rows, model_name, duration):
    if not math.isfinite(duration) or abs(duration - song['duration']) > 2:
        raise ValueError('The transcription duration differs from the released song')
    segments, previous = [], -1
    for row in rows:
        start, end = row['start'], min(row['end'], duration)
        text = row['text'].strip()
        if not text:
            continue
        if not all(math.isfinite(n) for n in (start, end)) or not 0 <= start < end or start < previous:
            raise ValueError('Invalid transcript timing')
        previous = end
        uncertain = bool(re.search(r'(.)\1{8,}', text, re.IGNORECASE)) or \
            row['avg_logprob'] < -.7 or row['no_speech_prob'] > .4 or any(
                word['probability'] < .5 for word in row['words'])
        segments.append({'start': round(start, 3), 'end': round(end, 3), 'text': text,
                         'uncertain': uncertain})
    if not segments:
        raise ValueError('No words were recognized; do not substitute the written lyrics')
    return {'version': 1, 'songId': song['id'], 'audioUrl': song['url'],
            'audioSha256': source['audio_sha256'], 'inputSha256': source['vocal_sha256'],
            'input': 'converted-tony-vocals', 'model': f'faster-whisper {model_name}',
            'review': 'machine', 'duration': duration, 'segments': segments}


def write_review(path, song, source, draft):
    """Private listening aid: each recognized phrase jumps to the actual audio."""
    esc = html.escape
    def phrase_text(row):
        if re.search(r'(.)\1{8,}', row['text'], re.IGNORECASE):
            return '<details><summary>Unclear sustained vocalization — recognizer repeated characters</summary>' + esc(row['text']) + '</details>'
        return '<span>' + esc(row['text']) + '</span>'
    rows = ''.join(
        f'<li><button data-start="{row["start"]}">{int(row["start"]) // 60}:'
        f'{int(row["start"]) % 60:02d}</button> {phrase_text(row)}'
        f'{" <small>Uncertain</small>" if row["uncertain"] else ""}</li>'
        for row in draft['segments'])
    page = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Audio lyric review</title>
<style>body{font:18px/1.6 system-ui;background:#17211d;color:#e8eddf;max-width:850px;margin:40px auto;padding:0 20px}
h1{line-height:1.2}audio{width:100%}button,select{font:inherit;background:#e8eddf;color:#17211d;border:0;border-radius:4px;padding:8px;margin:4px 12px 4px 0;cursor:pointer}
li{margin:12px 0;list-style:none;border-bottom:1px solid #526354;overflow-wrap:anywhere}ul{padding:0}small{color:#f0c36c}pre{white-space:pre-wrap}
.player{position:sticky;top:0;background:#17211d;padding:10px 0}a{color:#d7e6b5}</style>
<h1>''' + esc(song['title']) + '''</h1>
<p>Audio transcription draft. Listen to check the words, repetitions and omissions.
Uncertainty labels are model estimates; every line still needs listening review.</p>
<div class="player"><label>Listen to <select id="source"><option value="mix">Released recording</option>
<option value="vocals">Tony’s isolated vocals</option></select></label><audio id="audio" controls preload="metadata" src="''' + esc(source['recording'].resolve().as_uri()) + '''"></audio></div>
<p>''' + esc(draft['model']) + ''' · No written lyrics supplied to recognition.</p><ul>''' + rows + '''</ul>
<details><summary>Written lyrics for comparison</summary><pre>''' + esc(song.get('lyrics', {}).get('text', '')) + '''</pre></details>
<p><a href="public-draft.json">Transcription JSON</a> · Private review; nothing on this page publishes changes.</p>
<script>
const audio=document.querySelector('audio');
const sources=''' + json.dumps({'mix': source['recording'].resolve().as_uri(),
                               'vocals': source['vocals'].resolve().as_uri()}).replace('<', '\\u003c') + ''';
document.querySelectorAll('[data-start]').forEach(button=>button.onclick=()=>{audio.currentTime=Number(button.dataset.start);audio.play().catch(()=>{});});
document.querySelector('select').onchange=event=>{const at=audio.currentTime,playing=!audio.paused;audio.src=sources[event.target.value];audio.addEventListener('loadedmetadata',()=>{audio.currentTime=at;if(playing)audio.play().catch(()=>{});},{once:true});};
</script></html>'''
    Path(path).write_text(page, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', required=True, type=Path)
    parser.add_argument('--song', required=True)
    parser.add_argument('--basis-root', required=True, type=Path)
    parser.add_argument('--speech-root', required=True, type=Path)
    parser.add_argument('--cache', required=True, type=Path, help='Private evidence outside the public repo')
    parser.add_argument('--model', default='large-v3-turbo', help='An already downloaded faster-whisper model')
    parser.add_argument('--segmentation', choices=RECIPES, default='continuous',
                        help='Continuous audio by default; energy-based phrase windows are an alternative experiment')
    parser.add_argument('--download-model', action='store_true', help='Allow downloading the requested model')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    if args.cache.resolve().is_relative_to(repo):
        parser.error('Keep private evidence outside the public repository')
    song = next(song for song in read(args.catalog)['songs'] if song['id'] == args.song)
    source = performance_source(song, args.basis_root)
    model_key = re.sub(r'[^a-zA-Z0-9_.-]', '-', args.model).strip('.')
    if not model_key:
        parser.error('Invalid model name')
    recipe = RECIPES[args.segmentation]
    cache = args.cache / song['id'] / source['audio_sha256'] / model_key / recipe
    evidence_path = cache / 'evidence.json'
    signature = {'audio_sha256': source['audio_sha256'], 'vocal_sha256': source['vocal_sha256'],
                 'manifest_sha256': source['manifest_sha256'], 'model': args.model,
                 'recipe': recipe}
    if evidence_path.exists():
        evidence = read(evidence_path)
        if any(evidence['signature'].get(key) != value for key, value in signature.items()):
            raise ValueError('Cached evidence belongs to different audio or settings')
        if digest(cache / 'words.json') != evidence['words_sha256']:
            raise ValueError('Cached recognized words changed')
        rows, duration = read(cache / 'words.json'), evidence['duration']
        print('Reusing verified audio recognition', flush=True)
    else:
        if sys.platform == 'win32':
            import ctypes
            ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
        sys.path[:0] = [str(args.speech_root / 'audio-tools'), str(args.speech_root / 'speech-tools')]
        from faster_whisper import WhisperModel
        model = WhisperModel(args.model, device='cpu', compute_type='int8', cpu_threads=4,
                             download_root=str(args.speech_root / 'speech-models'),
                             local_files_only=not args.download_model)
        print(f"Recognizing converted Tony vocals for {song['title']} ({args.model}, CPU)", flush=True)
        if args.segmentation == 'phrases':
            rows, duration, windows = recognize_vocals(model, source['vocals'])
        else:
            rows, duration = recognize(model, source['vocals'])
            windows = None
        if digest(source['vocals']) != source['vocal_sha256']:
            raise ValueError('Audio changed during recognition')
        write(cache / 'words.json', rows)
        write(evidence_path, {'signature': signature, 'input_file': str(source['vocals']),
                             'recording_file': str(source['recording']), 'duration': duration,
                             'vocal_windows': windows,
                             'words_sha256': digest(cache / 'words.json'),
                             'created_at': datetime.now(timezone.utc).isoformat(), 'listening_review': False})
    draft = public_draft(song, source, rows, args.model, duration)
    write(cache / 'public-draft.json', draft)
    write_review(cache / 'review.html', song, source, draft)
    print(json.dumps({'draft': str(cache / 'public-draft.json'), 'segments': len(draft['segments']),
                      'uncertain_segments': sum(s['uncertain'] for s in draft['segments'])}), flush=True)


if __name__ == '__main__':
    main()
