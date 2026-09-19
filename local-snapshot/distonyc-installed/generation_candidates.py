"""Bounded sequential composition previews, before expensive voice conversion."""
import base64
import subprocess
import uuid
from pathlib import Path
from common import load, save, sha, fingerprint
from composition_ending import CompositionReady, identifier
from generation_flow import candidate_request, frozen
from frozen_request import reuse_or_save


def verify(directory):
    report = load(Path(directory) / 'composition-candidates.json')
    for row in report['candidates']:
        for filename, digest in row['files'].items():
            if sha(Path(row['work']) / filename) != digest: raise ValueError('A saved candidate changed')
        for clip in row['clips']:
            if sha(clip['path']) != clip['sha256']: raise ValueError('A saved preview changed')
    return report


def prepare(request, render_attempt):
    directory = Path(request['directory'])
    identity = fingerprint(request)
    count = request['plan']['generation']['candidates']
    if type(count) is not int or not 2 <= count <= 3: raise ValueError('Choose two or three compositions')
    journal_file = directory / 'composition-budget.json'
    journal = load(journal_file) if journal_file.exists() else {'version': 1, 'inputs_hash': identity, 'limit': count, 'started': []}
    if journal['inputs_hash'] != identity or journal['limit'] != count or journal['started'] != list(range(len(journal['started']))) or len(journal['started']) > count:
        raise ValueError('Saved composition budget changed')
    if (directory / 'composition-candidates.json').exists():
        report = verify(directory)
        if report['inputs_hash'] != identity: raise ValueError('Candidate inputs changed')
    else:
        rows = []
        for index in range(count):
            child = candidate_request(request, index)
            child_dir = Path(child['directory']); child_dir.mkdir(parents=True, exist_ok=True)
            child = reuse_or_save(child_dir / 'render-request.json', child)
            material = directory / 'source-material.json'
            if material.exists(): frozen(child_dir / material.name, load(material))
            if child['plan']['duration'] < 120:
                for name in ('planning-input.json', 'plan.json'):
                    frozen(child_dir / name, load(directory / name))
            if index not in journal['started']:
                journal['started'].append(index); save(journal_file, journal)
            try: render_attempt(child, preflight=True)
            except CompositionReady as ready: work = ready.work
            else: raise ValueError('A candidate already passed the composition/voice boundary')
            expected = Path(request['config']['settings']['studio_dir']).parent / ('troofs-desktop-' + identifier(child))
            if work.resolve() != expected.resolve(): raise ValueError('Unexpected candidate directory')
            track = load(work / 'track.json')
            duration = load(work / 'arrangement-checks.json')['duration']
            from lyrical_ending import review
            review(work)
            clips = []
            for name, start, length in [('Hook', min(30, duration / 3), 15), ('Ending', max(0, duration - 30), 30)]:
                path = child_dir / (name.lower() + '.mp3')
                length = min(length, duration - start)
                if not path.exists():
                    subprocess.run([request['config']['settings'].get('ffmpeg', r'C:\utilz\ffmpeg-custom\bin\ffmpeg.exe'), '-v', 'error', '-y',
                        '-ss', str(start), '-i', str(work / 'selected-mix.wav'), '-t', str(length), '-vn', '-c:a', 'libmp3lame', '-b:a', '96k', str(path)],
                        check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                clips.append({'label': name, 'start': start, 'duration': length, 'path': str(path), 'sha256': sha(path)})
            rows.append({'index': index, 'duration': duration, 'work': str(work), 'clips': clips,
                         'files': {name: sha(work / name) for name in ('track.json', 'desktop-job.json', 'selected-mix.wav', 'selected-vocals.wav', 'selected-backing.wav')}})
        report = {'version': 1, 'inputs_hash': identity, 'candidates': rows}
        frozen(directory / 'composition-candidates.json', report)
    payload = {'candidates': [{'index': r['index'], 'duration': r['duration'], 'clips': [
        {k: c[k] for k in ('label', 'start', 'duration')} | {'audio': base64.b64encode(Path(c['path']).read_bytes()).decode('ascii')} for c in r['clips']]} for r in report['candidates']]}
    frozen(directory / 'composition-review-offer.json', {'reviewId': str(uuid.uuid5(uuid.NAMESPACE_URL, request['prompt_id'] + ':composition-v1')), 'kind': 'composition', 'payload': payload})


def selected(request, render):
    directory = Path(request['directory'])
    choice = load(directory / 'composition-selection.json')
    if choice.get('inputs_hash') != fingerprint(request): raise ValueError('Composition choice inputs changed')
    report = verify(directory)
    if report['inputs_hash'] != fingerprint(request): raise ValueError('Composition candidates changed')
    index = choice['index']
    if type(index) is not int or not 0 <= index < len(report['candidates']): raise ValueError('Invalid composition choice')
    child = candidate_request(request, index)
    child = reuse_or_save(Path(child['directory']) / 'render-request.json', child)
    return render(child)
