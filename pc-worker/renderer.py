"""Trusted adapters around the existing Troofs renderer; submitted text stays in JSON."""
import argparse, importlib.util, json, os, shutil, subprocess, sys, time, uuid
from pathlib import Path
from common import load, save, sha, fingerprint, inside
from planner import validate

def module_at(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

def render(request):
    config, plan, basis = request['config'], request['plan'], request['basis']
    validate(plan, basis)
    settings = config['settings']; engine_root = Path(config['engine_resources'])
    os.environ['TROOFS_WORKER_RESOURCES'] = str(engine_root)
    engine = module_at('distonyc_engine', engine_root / 'engine_tasks.py')
    progress_file = Path(request['directory']) / 'progress.json'
    original_emit = engine.emit
    def emit(kind, **values):
        if kind == 'progress': save(progress_file, {'stage': values.get('stage', 'Rendering'), 'percent': round(100 * values.get('progress', 0), 1)})
        original_emit(kind, **values)
    engine.emit = emit
    if request.get('verify_existing'):
        # This option is set only by the local operator CLI, never by a submitted prompt.
        work = inside(request['verify_existing'], Path(settings['studio_dir']).parent)
        return engine.verify_work(work, settings['output_dir'])
    if plan['recipe'] == 'barbershop': return render_quartet(request, engine)
    if plan['recipe'] == 'needs_attention': raise ValueError(plan['explanation'])
    identifier = str(uuid.uuid5(uuid.NAMESPACE_URL, request['prompt_id']))
    title = plan['title'] + ' - D' + identifier[:8]
    spec = {'kind': plan['recipe'], 'title': title, 'style': plan['style'], 'duration': plan['duration'],
            'bpm': plan['bpm'], 'keyscale': plan['keyscale'], 'seed': int(identifier.replace('-', '')[:7], 16),
            'lyrics': plan['lyrics'], 'arrangement': plan['arrangement'], 'basis': basis,
            'preserve_generated_backing': plan['preserve_generated_backing']}
    if plan['recipe'] != 'new': spec['source_path'] = basis[0]['path']
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
                if plan['preserve_generated_backing']:
                    manifest['tasks'] = [task for task in manifest['tasks'] if task['name'] != 'backing']
                    track['backing_adapter'] = None
                    track['backing_decision'] = 'Retain the requested genre instrumentation from composition; Tony V6 is applied to the lead voice.'
            save(work / 'track.json', track)
            manifest['track_sha256'] = sha(work / 'track.json')
            manifest['workers'] = {path.name: sha(path) for path in work.glob('*.py')}
            save(work / 'desktop-job.json', manifest)
            save(work / 'distonyc-configured.json', {'prompt_id': request['prompt_id'], 'plan_hash': fingerprint(plan), 'basis': basis})
        else:
            configured = load(work / 'distonyc-configured.json')
            if configured['plan_hash'] != fingerprint(plan) or configured['basis'] != basis: raise ValueError('Saved production inputs changed')
        engine.validate_saved(work, manifest)
        if load(work / 'desktop-status.json')['status'] == 'completed': return engine.verify_work(work, settings['output_dir'])
        return engine.execute_stages(work, manifest)

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
    request = load(args.request); result = render(request)
    save(Path(request['directory']) / 'render-result.json', result)

if __name__ == '__main__': main()
