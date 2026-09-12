"""One native scheduled run. Empty queues never invoke a model or acquire the GPU."""
import argparse, json, os, secrets, sys, threading, time, traceback, uuid
from pathlib import Path
from common import API, APIError, inside, load, save, sha, singleton, utc
from winprocess import Stopped, run_owned
from planner import make_plan
from publish import upload, update_catalog

TERMINAL = {'published', 'failed', 'canceled'}

def basis_files(config, prompt):
    songs = {item['id']: item for item in load(config['basis_catalog'])['songs']}
    identifiers = prompt['details'].get('basisSongIds', [])
    if len(identifiers) > 5 or len(set(identifiers)) != len(identifiers): raise ValueError('Invalid basis selection')
    result = []
    for identifier in identifiers:
        if identifier not in songs: raise ValueError('A selected basis song is missing from this PC catalog')
        song = songs[identifier]; path = inside(Path(config['basis_root']) / song['relativePath'], config['basis_root'])
        if not path.is_file(): raise ValueError('A selected basis recording is missing on this PC')
        result.append({**song, 'path': str(path), 'sha256': sha(path)})
    return result

class Heartbeat:
    def __init__(self, api, prompt, lease, directory, health):
        self.api, self.prompt, self.lease, self.directory, self.health = api, prompt, lease, Path(directory), health
        self.last_ok = time.monotonic(); self.reason = None; self.done = threading.Event(); self.stage = 'Planning the song'
        self.thread = threading.Thread(target=self.loop, daemon=True)
    def beat(self):
        progress = {'stage': self.stage, 'percent': 0}
        try:
            if self.stage == 'Rendering' and (self.directory / 'progress.json').exists(): progress = load(self.directory / 'progress.json')
        except (OSError, ValueError): pass
        response = self.api.call(f"/prompts/{self.prompt['id']}/heartbeat", {'leaseToken': self.lease, **progress})
        self.prompt = response['prompt']; self.last_ok = time.monotonic()
        save(self.health, {'at': utc(), 'status': self.prompt['status'], 'promptId': self.prompt['id'], **progress})
        if self.prompt['status'] == 'cancel_requested': self.reason = 'cancel'
    def loop(self):
        while not self.done.wait(25):
            try: self.beat()
            except APIError as error:
                if error.status in [401, 403, 404, 409]: self.reason = 'lease'
            except (OSError, ValueError): pass
            if self.stopped(): return
    def stopped(self):
        if not self.reason and time.monotonic() - self.last_ok > 90: self.reason = 'offline'
        return bool(self.reason)
    def start(self): self.beat(); self.thread.start(); return self
    def close(self):
        self.done.set()
        if self.thread.is_alive(): self.thread.join(timeout=30)

def metadata(config, plan, result):
    if result.get('status') != 'verified' or result.get('new_training') is not False: raise ValueError('The renderer did not verify the saved Tony V6 mix')
    files = result.get('files', [])
    if {Path(item['path']).suffix.lower() for item in files} != {'.mp3', '.wav'}: raise ValueError('Both verified MP3 and WAV are required')
    for item in files:
        path = inside(item['path'], Path(config['settings']['output_dir']) / (Path(item['path']).suffix[1:] + 's'))
        if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']: raise ValueError('A rendered file changed')
    mp3 = next(item for item in files if Path(item['path']).suffix.lower() == '.mp3')
    return mp3['path'], {'title': plan['title'], 'duration': result['duration'], 'bytes': mp3['bytes'], 'sha256': mp3['sha256']}

def new_claim(path):
    claim = {'claimId': str(uuid.uuid4()), 'leaseToken': secrets.token_urlsafe(40)}
    save(path, claim); return claim

def run_once(config, api, verify_existing=None):
    state = Path(config['state_dir']); state.mkdir(parents=True, exist_ok=True)
    journal = state / 'claim.json'; health = state / 'health.json'
    claim = load(journal) if journal.exists() else new_claim(journal)
    if claim.get('promptId'):
        previous = api.call('/prompts/' + claim['promptId'])['prompt']
        if previous['status'] in TERMINAL:
            if previous['status'] == 'published': update_catalog(config, previous)
            journal.unlink(); save(health, {'at': utc(), 'status': previous['status'], 'promptId': previous['id']}); return
    try: prompt = api.call('/claim', claim)['prompt']
    except APIError as error:
        if error.status != 410: raise
        claim = new_claim(journal); prompt = api.call('/claim', claim)['prompt']
    if not prompt:
        journal.unlink(); save(health, {'at': utc(), 'status': 'idle'}); return
    claim['promptId'] = prompt['id']; save(journal, claim)
    directory = inside(state / 'jobs' / prompt['id'], state / 'jobs'); directory.mkdir(parents=True, exist_ok=True)
    save(directory / 'prompt.json', prompt)
    if prompt['status'] in TERMINAL:
        if prompt['status'] == 'published': update_catalog(config, prompt)
        journal.unlink(); return
    heartbeat = Heartbeat(api, prompt, claim['leaseToken'], directory, health)
    def action(name, **body):
        return api.call(f"/prompts/{prompt['id']}/{name}", {'leaseToken': claim['leaseToken'], **body}, timeout=150 if name == 'publish' else 25)['prompt']
    try:
        heartbeat.start()
        if heartbeat.stopped(): raise Stopped('Cancellation requested')
        result_file = directory / 'render-result.json'
        if prompt['status'] == 'processing':
            basis = basis_files(config, prompt)
            # The model receives creative metadata; local paths remain in the trusted renderer input.
            plan = make_plan(config, prompt, directory, [{k: v for k, v in song.items() if k not in ['path', 'sha256']} for song in basis], heartbeat.stopped)
            if plan['recipe'] == 'needs_attention': raise ValueError(plan['explanation'])
            if not result_file.exists():
                request = {'config': config, 'prompt_id': prompt['id'], 'plan': plan, 'basis': basis, 'directory': str(directory)}
                if verify_existing: request['verify_existing'] = str(Path(verify_existing).resolve())
                save(directory / 'render-request.json', request)
                heartbeat.stage = 'Rendering'
                run_owned([config['settings']['python'], str(Path(__file__).with_name('renderer.py')), '--request', str(directory / 'render-request.json'), '--gate', str(directory / 'start.gate')],
                    directory, directory / 'renderer.log', heartbeat.stopped, gate=directory / 'start.gate')
            mp3, completed = metadata(config, plan, load(result_file))
            prompt = action('complete', result=completed)
        else:
            if not result_file.exists(): raise ValueError('This PC is missing the completed mix. Restore its saved job folder before publishing.')
            plan = load(directory / 'plan.json')['plan']
            mp3, completed = metadata(config, plan, load(result_file))
            if completed != prompt['result']: raise ValueError('The saved mix differs from the server result')
        if heartbeat.stopped(): raise Stopped('Cancellation or lease loss')
        if prompt['status'] == 'completed': prompt = action('publishing')
        heartbeat.stage = 'Publishing the verified MP3'
        upload(config, prompt, mp3, directory, heartbeat.stopped)
        if heartbeat.stopped(): raise Stopped('Lease lost during publication')
        prompt = action('publish')
        heartbeat.close()
        update_catalog(config, prompt)
        save(health, {'at': utc(), 'status': 'published', 'promptId': prompt['id'], 'url': prompt['releaseUrl']})
        journal.unlink()
    except Stopped:
        heartbeat.close()
        if heartbeat.reason == 'cancel':
            action('cancel'); journal.unlink(); save(health, {'at': utc(), 'status': 'canceled', 'promptId': prompt['id']})
        else: raise
    except (ValueError, RuntimeError) as error:
        heartbeat.close()
        # Publication is a durable finalization step: never rerender a completed mix after an upload outage.
        if prompt['status'] in ['processing', 'completed'] and not heartbeat.stopped():
            try:
                action('fail', error=str(error)[:1000]); journal.unlink()
            except APIError: pass
        raise
    finally: heartbeat.close()

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--verify-existing', type=Path, help='Operator-only delivery test; verifies an already completed Troofs work folder')
    args = parser.parse_args(); config = load(args.config)
    token = os.environ.pop('DISTONYC_WORKER_TOKEN', '')
    if len(token) < 32: raise ValueError('The DPAPI-protected worker credential was not loaded')
    state = Path(config['state_dir'])
    with singleton(state / 'worker.lock') as acquired:
        if not acquired: return
        try: run_once(config, API(config['api'], config['worker_id'], token), args.verify_existing)
        except Exception as error:
            save(state / 'health.json', {'at': utc(), 'status': 'needs_attention', 'error': str(error)[:1000]})
            traceback.print_exc(); raise SystemExit(1)

if __name__ == '__main__': main()
