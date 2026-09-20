"""An optional B side: the finished song sung again from its saved phrases with another pitch setting.

Best effort by design. The A side is already verified when this runs, its work folder is only read, and
any failure here is journaled so the song publishes without a B side. Only the guide pitch contour
differs between the two: the phrases, content features, reference clips, adapter, seeds and mix are shared."""
import argparse, os, shutil, time
from pathlib import Path
from common import load, save, sha, inside

MODES = ('wild', 'haunted', 'clean')
STAGES = ('pitch', 'diffuse', 'vocode', 'assemble', 'validate', 'finish')
# Everything those stages write, plus large files none of them read. Reference choices are kept.
LEAVE = ('generated.wav', '*.vae', 'catalog-reference.wav', 'selected-mix.wav', 'matched-*', 'voice-assembly.json',
         'voice-checks.json', 'pitch-repair.json', 'pitch-advisory.json', 'mix-results.json', 'delivery-*',
         'desktop-delivery.json', 'desktop-status.json', 'desktop-logs', 'diffusion-status.json',
         'performance-comparison.json', 'lyrical-ending-review.json', 'quality-policy.json', '__pycache__',
         '*-f0.npy', '*-f0-raw.npy', 'pitch-inputs.json', '*-converted-mel.npy', '*-converted.wav', '*-generation.json')
JOURNAL = 'pitch-alternate.json'


def requested(plan):
    mode = (plan.get('generation') or {}).get('pitchCompare')
    return mode if mode in MODES else None


def sung_with(work):
    """The setting the voice runtime actually used, from its own journal."""
    path = Path(work) / 'pitch-repair.json'
    mode = load(path).get('mode') if path.exists() else None
    return mode if mode in MODES else None


def title(name, mode):
    return f'{name} - {mode.capitalize()} pitch'


def prepare(work, mode):
    """Copy the A side's inputs into a sibling folder whose only difference is the pitch setting."""
    work = Path(work); variant = work.with_name(f'{work.name}-pitch-{mode}')
    if variant.exists(): return variant, load(variant / 'desktop-job.json')
    manifest, track = load(work / 'desktop-job.json'), load(work / 'track.json')
    if manifest.get('kind') != 'new' or not (work / 'conversion-plan.json').exists() or track.get('voice_model', 'v6') == 'v6':
        raise ValueError('A B side needs one versioned-voice song folder')
    if sung_with(work) in (None, mode): raise ValueError('The A side was not sung with a different journaled pitch setting')
    temporary = work.with_name(f'{variant.name}.preparing')
    if temporary.exists(): shutil.rmtree(temporary)
    shutil.copytree(work, temporary, ignore=shutil.ignore_patterns(*LEAVE))
    save(temporary / 'track.json', {**track, 'pitch_repair': mode, 'title': title(track['title'], mode), 'pitch_alternate_of': str(work)})
    tasks = [{**task, 'command': [str(variant) if item == str(work) else item.replace(str(work) + os.sep, str(variant) + os.sep)
                                  if isinstance(item, str) else item for item in task['command']]}
             for task in manifest['tasks'] if task['name'] in STAGES]
    if [task['name'] for task in tasks] != list(STAGES): raise ValueError('Unexpected stages in the saved job')
    # Every stage must address the new folder: a stage left pointing at the A side would overwrite a finished song.
    if any(str(variant) not in (str(item) for item in task['command']) and not any(str(item).startswith(str(variant) + os.sep) for item in task['command'])
           or any(str(work) == str(item) or str(item).startswith(str(work) + os.sep) for item in task['command']) for task in tasks):
        raise ValueError('A saved stage does not address this job folder')
    manifest = {**manifest, 'job_id': f"{manifest['job_id']}-pitch-{mode}", 'tasks': tasks, 'created_at': time.time(),
                'track_sha256': sha(temporary / 'track.json'), 'workers': {path.name: sha(path) for path in temporary.glob('*.py')}}
    save(temporary / 'desktop-job.json', manifest)
    save(temporary / 'desktop-status.json', {'status': 'ready', 'completed': []})
    temporary.rename(variant)
    return variant, manifest


def render(config, result, mode, progress=None):
    import renderer  # The installed sibling: the B side is finished and verified by the same adapted engine as the A side.
    settings = config['settings']; engine_root = Path(config['engine_resources'])
    work = inside(result['work_path'], Path(settings['studio_dir']).parent)
    os.environ['TROOFS_WORKER_RESOURCES'] = str(engine_root)
    engine = renderer.module_at('distonyc_engine_alternate', engine_root / 'engine_tasks.py')
    engine.save = save
    renderer.adapt_quality_verification(engine)
    if progress:
        emit = engine.emit
        def report(kind, **values):
            if kind == 'progress': renderer.write_progress(progress, {**values, 'stage': 'B side · ' + str(values.get('stage', 'Rendering'))})
            emit(kind, **values)
        engine.emit = report
    variant, manifest = prepare(work, mode)
    if load(variant / 'track.json').get('pitch_repair') != mode: raise ValueError('The saved B side has a different setting')
    engine.validate_saved(variant, manifest)
    with engine.gpu_lock(settings['studio_dir']):
        if load(variant / 'desktop-status.json')['status'] == 'completed': verified = engine.verify_work(variant, settings['output_dir'])
        else: verified = engine.execute_stages(variant, renderer.execution_manifest(manifest,
            config.get('instrumental_break_warnings', False), config.get('vocal_dropout_warnings', False)))
    if sung_with(variant) != mode: raise ValueError('The voice runtime did not sing the B side with the requested setting')
    mp3 = next(item for item in verified['files'] if Path(item['path']).suffix.lower() == '.mp3')
    return {'pitchRepair': mode, 'mp3': mp3['path'], 'bytes': mp3['bytes'], 'sha256': mp3['sha256'],
            'duration': verified['duration'], 'work_path': str(variant)}


def saved(directory, config=None):
    """The journaled B side for this job, re-verified against the delivered file; None when absent or failed."""
    path = Path(directory) / JOURNAL
    if not path.exists(): return None
    record = load(path)
    if record.get('status') != 'completed': return None
    item = record['alternate']; mp3 = Path(item['mp3'])
    if config: mp3 = inside(mp3, Path(config['settings']['output_dir']) / 'mp3s')
    if mp3.stat().st_size != item['bytes'] or sha(mp3) != item['sha256']: raise ValueError('The saved B side changed')
    return item


def public(item):
    return {key: item[key] for key in ('pitchRepair', 'sha256', 'bytes', 'duration')}


def b_side(config, plan, directory, heartbeat, run_owned, stopped):
    """Sing the requested B side, at most twice per job; every failure leaves the verified A side to publish alone."""
    mode = requested(plan); directory = Path(directory); journal = directory / JOURNAL
    if not mode: return None
    record = load(journal) if journal.exists() else {}
    if record.get('status') not in ('completed', 'failed') and record.get('attempts', 0) < 2:
        save(journal, {'version': 1, 'status': 'started', 'mode': mode, 'attempts': record.get('attempts', 0) + 1, 'at': time.time()})
        heartbeat.stage = 'Singing the B side'
        try:
            run_owned([config['settings']['python'], str(Path(__file__).resolve()), '--request', str(directory / 'render-request.json'),
                       '--gate', str(directory / 'alternate.gate'), '--mode', mode],
                      directory, directory / 'pitch-alternate.log', heartbeat.stopped, gate=directory / 'alternate.gate')
        except stopped: raise
        except Exception: pass  # The child journals its own failure; the song goes on without a B side.
    try: return saved(directory, config)
    except (OSError, ValueError, KeyError): return None


def fields(result, alternate):
    """What the published song says about its pitch: the A side's journaled setting, and a verified B side if one exists."""
    mode = sung_with(result['work_path']) if result.get('work_path') else None
    if not mode: return {}
    return {'pitchRepair': mode, **({'alternates': [public(alternate)]} if alternate and alternate['pitchRepair'] != mode else {})}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--gate', type=Path, required=True); parser.add_argument('--mode', choices=MODES, required=True)
    args = parser.parse_args(); deadline = time.monotonic() + 20
    while not args.gate.exists():
        if time.monotonic() > deadline: raise TimeoutError('Worker process-tree isolation was not established')
        time.sleep(.05)
    request = load(args.request); directory = Path(request['directory']); journal = directory / JOURNAL
    record = load(journal) if journal.exists() else {'version': 1, 'attempts': 1}
    if record.get('status') in ('completed', 'failed'): return
    try:
        item = render(request['config'], load(directory / 'render-result.json'), args.mode, directory / 'progress.json')
    except Exception as error:
        save(journal, {**record, 'status': 'failed', 'mode': args.mode, 'at': time.time(), 'type': type(error).__name__, 'message': str(error)[-4000:]})
        raise
    save(journal, {**record, 'status': 'completed', 'mode': args.mode, 'at': time.time(), 'alternate': item})


if __name__ == '__main__': main()
