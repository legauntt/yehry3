"""Trusted adapters around the existing Troofs renderer; submitted text stays in JSON."""
import argparse, importlib.util, json, os, shutil, subprocess, sys, time, uuid
from pathlib import Path
from common import load, save, sha, fingerprint, inside
from planner import validate
from source_material import source_material
from voice_models import reference_profile, resolve


def with_quality(result):
    path = Path(result['work_path']) / 'mix-results.json'
    if not path.exists(): return result
    report = load(path)
    if report.get('qualityIssues'): result['qualityIssues'] = report['qualityIssues']
    return result


def execution_manifest(manifest, instrumental_break_warnings=False, vocal_dropout_warnings=False):
    if manifest['kind'] != 'new': return manifest
    # Adapt the command in memory. Frozen scripts, inputs, hashes and the saved
    # stage journal remain authoritative and are never rewritten by this policy.
    tasks = []
    for task in manifest['tasks']:
        if task['name'] == 'configure' and manifest.get('style') != 'opera' and instrumental_break_warnings:
            command = task['command']
            task = {**task, 'command': [command[0], str(Path(__file__).with_name('quality_configure.py')),
                    '--work', str(Path(command[1]).parent), '--source-sha256', manifest['workers']['configure_song.py']]}
        if task['name'] == 'finish':
            command = task['command']
            task = {**task, 'command': [command[0], str(Path(__file__).with_name('quality_finish.py')),
                    '--work', str(Path(command[1]).parent), '--source-sha256', manifest['workers']['finish_song.py']]}
            if vocal_dropout_warnings: task['command'].append('--allow-vocal-dropout-warning')
        tasks.append(task)
    return {**manifest, 'tasks': tasks}


def failure_detail(request, error):
    stage = 'Rendering'
    progress = Path(request['directory']) / 'progress.json'
    try:
        if progress.exists(): stage = load(progress).get('stage', stage)
    except (OSError, ValueError): pass
    lines = [line.strip() for line in str(error).splitlines() if line.strip()]
    detail = next((line for line in reversed(lines) if line.startswith(('AssertionError:', 'ValueError:', 'RuntimeError:'))), None)
    if not detail: detail = lines[0] if lines else type(error).__name__
    return {'stage': stage, 'message': f'{stage} failed: {detail[:700]} Saved work is retained; Retry resumes completed stages.'}

def module_at(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


def write_progress(path, values):
    try:
        save(path, {'stage': values.get('stage', 'Rendering'), 'percent': round(100 * values.get('progress', 0), 1)})
    except OSError:
        # Telemetry must never kill the owned audio process. The durable engine
        # stage journal records success/failure separately.
        pass

def ending_repair(request, work):
    """Permit one new composition attempt after a measured cutoff, never a fade over it."""
    plan = request['plan']
    if plan['recipe'] not in ['new', 'reinterpretation'] or plan['duration'] > 268: return None
    state_file, evidence_file = work / 'desktop-status.json', work / 'arrangement-checks.json'
    if not state_file.exists() or not evidence_file.exists(): return None
    state, evidence = load(state_file), load(evidence_file)
    if state.get('status') != 'failed' or state.get('stage') != 'configure': return None
    if 'Ending needs completion before fade' not in str(state.get('error', '')): return None
    if evidence['duration'] - evidence['last_detected_voice'] > 1.2 or evidence['last_second_mix_dbfs'] < -43: return None
    return {'version': 1, 'reason': 'Generated performance reaches the end before its final phrase and chord can finish',
            'inputs_hash': fingerprint({'plan': plan, 'basis': request['basis']}),
            'original_work': str(work), 'original_manifest_sha256': sha(work / 'desktop-job.json'),
            'duration': plan['duration'] + 32, 'extra_seconds': 32,
            'original_evidence': evidence, 'attempt_limit': 1, 'original_audio_retained': True}


def vocal_recovery(request, repair=None, pending_only=False):
    # Versioned profiles have their own adapters and banks. Never cross them through V6 repair.
    if request.get('voice_model', 'v6') != 'v6': return False
    if not request['config'].get('automatic_vocal_repair', False) or request.get('verify_existing'): return False
    identifier = str(uuid.uuid5(uuid.NAMESPACE_URL, request['prompt_id'] + (':ending-v1' if repair else '')))
    work = Path(request['config']['settings']['studio_dir']).parent / ('troofs-desktop-' + identifier)
    marker = work / 'vocal-repair/status.json'
    recovery = load(marker) if marker.exists() else None
    if recovery and recovery['status'] in ('failed', 'applied'): return False
    if pending_only and not recovery: return False
    state_file = work / 'desktop-status.json'
    if not state_file.exists(): return False
    state = load(state_file)
    if not recovery and (state.get('status') != 'failed' or state.get('stage') != 'finish' or 'Missing vocal phrase' not in state.get('error', '')): return False
    write_progress(Path(request['directory']) / 'progress.json', {'stage':'Repairing a short vocal dropout', 'progress':.84})
    try:
        with (Path(request['directory']) / 'vocal-recovery.log').open('a', encoding='utf-8') as log:
            subprocess.run([request['config']['settings']['voice_python'], str(Path(__file__).with_name('vocal_repair.py')),
                '--work', str(work), '--engine-resources', request['config']['engine_resources']],
                cwd=work, stdout=log, stderr=subprocess.STDOUT, check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except subprocess.CalledProcessError:
        detail = load(marker).get('error', 'See the saved vocal recovery log') if marker.exists() else 'See the saved vocal recovery log'
        raise RuntimeError('Missing vocal phrase: automatic repair could not validate the passage. ' + detail[:500]) from None
    return True


def allow_vocal_warning(request, repair=None):
    if not request['config'].get('vocal_dropout_warnings', False) or request.get('verify_existing'): return False
    identifier = str(uuid.uuid5(uuid.NAMESPACE_URL, request['prompt_id'] + (':ending-v1' if repair else '')))
    work = Path(request['config']['settings']['studio_dir']).parent / ('troofs-desktop-' + identifier)
    state_file = work / 'desktop-status.json'
    if not state_file.exists(): return False
    state = load(state_file)
    if state.get('status') != 'failed' or state.get('stage') != 'finish' or 'Missing vocal phrase' not in state.get('error', ''): return False
    policy = work / 'vocal-quality-policy.json'
    if policy.exists(): return False
    save(policy, {'version': 1, 'after_bounded_repair': True,
        'reason': 'Publish the best retained performance with a visible vocal issue after recovery cannot resolve it.',
        'inputs_sha256': {name: sha(work / name) for name in ('selected-vocals.wav', 'selected-backing.wav', 'matched-vocals.wav')},
        'audio_changed': False, 'other_integrity_checks_retained': True})
    return True


def render(request):
    repair_file = Path(request['directory']) / 'ending-repair.json'
    repair = load(repair_file) if repair_file.exists() else None
    if repair:
        expected = fingerprint({'plan': request['plan'], 'basis': request['basis']})
        if repair.get('version') != 1 or repair.get('inputs_hash') != expected or repair.get('duration') != request['plan']['duration'] + 32:
            raise ValueError('Saved ending-repair inputs changed')
        original = inside(repair['original_work'], Path(request['config']['settings']['studio_dir']).parent)
        if sha(original / 'desktop-job.json') != repair['original_manifest_sha256']:
            raise ValueError('The original render manifest changed after ending repair was planned')
    try: vocal_recovery(request, repair, pending_only=True)
    except RuntimeError:
        if not allow_vocal_warning(request, repair): raise
    for attempt in range(3):
        try:
            return render_attempt(request, repair)
        except RuntimeError:
            if request.get('verify_existing'): raise
            try:
                if vocal_recovery(request, repair): continue
            except RuntimeError:
                if allow_vocal_warning(request, repair): continue
                raise
            if allow_vocal_warning(request, repair): continue
            if repair: raise
            identifier = str(uuid.uuid5(uuid.NAMESPACE_URL, request['prompt_id']))
            work = Path(request['config']['settings']['studio_dir']).parent / ('troofs-desktop-' + identifier)
            repair = ending_repair(request, work)
            if not repair: raise
            save(repair_file, repair)
    raise RuntimeError('The bounded recovery attempts are exhausted; saved work is retained.')


def render_attempt(request, repair=None):
    config, plan, basis = request['config'], request['plan'], request['basis']
    validate(plan, basis)
    settings = config['settings']; engine_root = Path(config['engine_resources'])
    voice_model = request.get('voice_model', 'v6')
    voice_profile = resolve(config, voice_model)
    os.environ['TROOFS_WORKER_RESOURCES'] = str(engine_root)
    engine = module_at('distonyc_engine', engine_root / 'engine_tasks.py')
    engine.save = save
    progress_file = Path(request['directory']) / 'progress.json'
    original_emit = engine.emit
    def emit(kind, **values):
        if kind == 'progress':
            write_progress(progress_file, values)
        original_emit(kind, **values)
    engine.emit = emit
    if request.get('verify_existing'):
        # This option is set only by the local operator CLI, never by a submitted prompt.
        work = inside(request['verify_existing'], Path(settings['studio_dir']).parent)
        return with_quality(engine.verify_work(work, settings['output_dir']))
    if plan['recipe'] == 'barbershop':
        if voice_model != 'v6': raise ValueError(f'Tony {voice_model.upper()} is not available for the specialized four-voice quartet recipe; choose Tony V6')
        return render_quartet(request, engine)
    if plan['recipe'] == 'needs_attention': raise ValueError(plan['explanation'])
    identifier = str(uuid.uuid5(uuid.NAMESPACE_URL, request['prompt_id'] + (':ending-v1' if repair else '')))
    title = plan['title'] + ' - D' + identifier[:8]
    material = None
    if plan['recipe'] == 'reinterpretation':
        material = source_material(config, basis)
        saved_material = Path(request['directory']) / 'source-material.json'
        if not material or not saved_material.exists() or load(saved_material) != material:
            raise ValueError('Saved source lyrics or vocal references changed; refusing changed production inputs')
    spec = {'kind': 'new' if material else plan['recipe'], 'title': title, 'style': plan['style'], 'duration': plan['duration'],
            'bpm': plan['bpm'], 'keyscale': plan['keyscale'], 'seed': int(identifier.replace('-', '')[:7], 16),
            'lyrics': plan['lyrics'], 'arrangement': plan['arrangement'], 'basis': basis,
            'preserve_generated_backing': plan['preserve_generated_backing']}
    if material: spec['source_material'] = material
    if repair:
        spec['duration'] = repair['duration']
        spec['arrangement'] += (f" Ending repair: allow {repair['duration']} seconds for this complete performance. "
            'Any earlier timestamps describe section order only. Finish every supplied lyric, including the whole final verse, '
            'at least twelve seconds before the end. Resolve the final tonic chord, let it decay completely, and stop. '
            'Do not add a new verse, restart the song, or sing over the final instrumental decay.')
        spec['ending_repair'] = repair
    if spec['kind'] != 'new': spec['source_path'] = basis[0]['path']
    desktop_request = {'version': 1, 'job_id': identifier, 'settings': settings, 'spec': spec}
    with engine.gpu_lock(settings['studio_dir']):
        engine.doctor(settings)
        work, manifest = engine.prepare_job(desktop_request)
        if not (work / 'distonyc-configured.json').exists():
            if load(work / 'desktop-status.json')['completed']: raise ValueError('Refusing to modify an already-started render')
            track = load(work / 'track.json')
            if spec['kind'] == 'new':
                if basis:
                    engine.materialize('generate_opera.py' if plan['style'] == 'opera' else 'generate_song.py', work / 'generate_base.py', settings)
                    shutil.copy2(Path(__file__).with_name('basis_references.py'), work / 'basis_references.py')
                    (work / 'generate_song.py').write_text('import generate_base as base\nfrom basis_references import build_references\nbase.references=lambda:build_references(base)\nbase.main()\n', encoding='utf-8')
                    track['basis_sources'] = basis
                    if material:
                        track['basis_sources'] = [{**basis[0], 'reference_path': material['vocal_reference_path'],
                            'reference_sha256': material['vocal_reference_sha256'],
                            'reference_intervals': material['reference_intervals']}]
                        track['lyric_provenance'] = 'Adapted source hooks and motifs with new genre-specific lyrics and phrasing; source transcript is an unverified draft.'
                        save(work / 'source-material.json', material)
                if plan['preserve_generated_backing']:
                    manifest['tasks'] = [task for task in manifest['tasks'] if task['name'] != 'backing']
                    track['backing_adapter'] = None
                    track['backing_decision'] = f'Retain the requested genre instrumentation from composition; Tony {voice_model.upper()} is applied to the lead voice.'
            if voice_model != 'v6':
                if spec['kind'] != 'new':
                    raise ValueError(f'Tony {voice_model.upper()} currently supports new compositions and reinterpretations, not faithful source reconstructions')
                shutil.copy2(work / 'convert_song.py', work / 'engine_voice.py')
                track.update(voice_model=voice_model, voice_checkpoint=voice_profile['files']['adapter'],
                    voice_model_sha256=voice_profile['sha256']['adapter'], v6_control_sha256=track['model_sha256'],
                    experiment=voice_profile['root'], reference_profile=reference_profile(voice_profile, plan['style']),
                    saved_favorites_used=False, version_name=voice_profile['label'], production_promoted=False,
                    listening_accepted=False)
                finish = (work / 'finish_song.py').read_text('utf-8')
                finish = finish.replace('AI music experiment; local Tony C V6 catalog voice model.',
                    'AI music experiment; isolated versioned Tony C fresh-catalog voice model.')
                finish = finish.replace("'voice_adapter':str(AI/'catalog-expansion-v6/tony-catalog-adapter.pt')",
                    "'voice_adapter':track['voice_checkpoint']")
                finish = finish.replace("'phonetic_priority':'Listener-preferred +50 creative target, with varied lyric-derived expression and no stock chants'",
                    "'phonetic_priority':'Fresh catalog selection; saved favorite passages and labels excluded'")
                compile(finish, 'finish_versioned.py', 'exec')
                (work / 'finish_versioned.py').write_text(finish, encoding='utf-8')
                analysis = (work / 'analyze_result.py').read_text('utf-8').replace(
                    "glob('new-song-*-f0.npy')", "glob('phrase-*-f0.npy')")
                compile(analysis, 'analyze_versioned.py', 'exec')
                (work / 'analyze_versioned.py').write_text(analysis, encoding='utf-8')
                for task in manifest['tasks']:
                    if task['name'] in ['prepare', 'features', 'pitch', 'diffuse', 'vocode', 'assemble', 'validate']:
                        task['command'] = [settings['voice_python'], voice_profile['files']['runtime'], str(work), task['name']]
                    elif task['name'] == 'finish':
                        task['command'] = [settings['voice_python'], str(work / 'finish_versioned.py'), '--work', str(work)]
                    elif task['name'] == 'analysis':
                        task['command'] = [settings['voice_python'], str(work / 'analyze_versioned.py'), '--work', str(work)]
                save(work / 'voice-profile.json', voice_profile)
            save(work / 'track.json', track)
            manifest['track_sha256'] = sha(work / 'track.json')
            manifest['workers'] = {path.name: sha(path) for path in work.glob('*.py')}
            save(work / 'desktop-job.json', manifest)
            save(work / 'distonyc-configured.json', {'prompt_id': request['prompt_id'], 'plan_hash': fingerprint(plan),
                'basis': basis, 'voice_model': voice_model, 'voice_profile_fingerprint': voice_profile['fingerprint']})
        else:
            configured = load(work / 'distonyc-configured.json')
            if (configured['plan_hash'] != fingerprint(plan) or configured['basis'] != basis or
                    configured.get('voice_model', 'v6') != voice_model or
                    configured.get('voice_profile_fingerprint', 'v6-established') != voice_profile['fingerprint']):
                raise ValueError('Saved production inputs changed')
        engine.validate_saved(work, manifest)
        if load(work / 'desktop-status.json')['status'] == 'completed': result = with_quality(engine.verify_work(work, settings['output_dir']))
        else: result = with_quality(engine.execute_stages(work, execution_manifest(manifest, config.get('instrumental_break_warnings', False), config.get('vocal_dropout_warnings', False))))
        result['voice_model'] = voice_model
        return result

def render_quartet(request, engine):
    settings, basis, plan = request['config']['settings'], request['basis'], request['plan']
    ai = Path(settings['studio_dir']).parent
    original = ai / 'troofs-barbershop-three-v6/quartet.py'
    ident = 'distonyc-' + uuid.uuid5(uuid.NAMESPACE_URL, request['prompt_id']).hex[:24]
    work = ai / ('troofs-' + ident)
    with engine.gpu_lock(settings['studio_dir']):
        engine.doctor(settings)
        work.mkdir(exist_ok=True)
        snapshot = work / 'quartet.py'
        if not snapshot.exists():
            shutil.copy2(original, snapshot)
            calibration = original.with_name('cuda-feature-calibration.json')
            if calibration.exists(): shutil.copy2(calibration, work / calibration.name)
        frozen = work / 'distonyc-quartet.json'
        inputs = {'plan': plan, 'basis': basis, 'recipe_sha256': sha(snapshot)}
        if frozen.exists() and load(frozen) != inputs: raise ValueError('Saved quartet inputs changed')
        save(frozen, inputs)
        quartet = module_at('distonyc_quartet', snapshot)
        recording = {'dvdp/05_nchain.m4a': '05-nchain', 'dvdp/08_road.m4a': '08-road', 'dvdp/11_medusa.m4a': '11-medusa'}[basis[0]['relativePath']]
        cfg = next(dict(item) for item in quartet.CONFIGS if item['recording'] == recording)
        cfg.update(id=ident, title=plan['title'] + ' - D' + ident[-8:])
        quartet.prepare(work, cfg)
        status = work / 'quartet-status.json'; state = load(status) if status.exists() else {'completed': []}
        stages = ['analyze', 'arrange', 'chunks', 'features', 'pitch', 'diffuse', 'vocode', 'assemble', 'validate', 'master']
        for index, stage in enumerate(stages):
            if stage in state['completed']: continue
            state.update(status='running', stage=stage); save(status, state)
            engine.emit('progress', stage=f'Quartet: {stage}', progress=index / len(stages))
            with (work / (stage + '.log')).open('a', encoding='utf-8') as log:
                subprocess.run([settings['voice_python'], str(snapshot), stage, str(work)], cwd=work, stdout=log, stderr=subprocess.STDOUT, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
            state['completed'].append(stage); save(status, state)
        quartet.verify(work)
        result = engine.verify_work(work, settings['output_dir'])
        state.update(status='completed', stage='completed'); save(status, state)
        return result

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--request', type=Path, required=True); parser.add_argument('--gate', type=Path, required=True)
    args = parser.parse_args(); deadline = time.monotonic() + 20
    while not args.gate.exists():
        if time.monotonic() > deadline: raise TimeoutError('Worker process-tree isolation was not established')
        time.sleep(.05)
    request = load(args.request)
    error_file = Path(request['directory']) / 'renderer-error.json'
    error_file.unlink(missing_ok=True)
    try: result = render(request)
    except Exception as error:
        save(error_file, failure_detail(request, error))
        raise
    save(Path(request['directory']) / 'render-result.json', result)

if __name__ == '__main__': main()
