"""Bind a contextual repair to the voice and recipe frozen in the failed job."""
import subprocess
import sys
from pathlib import Path
from common import fingerprint, load, save, sha

VERSIONED = ('v7', 'v8', 'v9')


def supported(request):
    voice = request.get('voice_model', 'v6')
    enabled = request.get('config', {}).get('automatic_versioned_vocal_repair', False)
    selected = enabled is True or (isinstance(enabled, list) and voice in enabled)
    return voice == 'v6' or (voice in VERSIONED and selected)


def rvc_profile(work):
    """The voice profile frozen into an RVC job, or None: such a voice is sung by its own pinned runtime, not by the saved recipe."""
    saved = Path(work) / 'voice-profile.json'
    frozen = load(saved) if saved.exists() else {}
    return frozen if frozen.get('runtime_kind') == 'rvc-v1' else None


def resolve(work, manifest):
    work = Path(work)
    track = load(work / 'track.json')
    voice = track.get('voice_model', 'v6')
    if voice not in ('v6', *VERSIONED):
        raise ValueError('This saved voice has no compatible contextual repair')
    recipe = work / ('convert_song.py' if voice == 'v6' else 'engine_voice.py')
    if recipe.name not in manifest['workers'] or sha(recipe) != manifest['workers'][recipe.name]:
        raise ValueError('The frozen voice repair recipe changed')
    if voice == 'v6':
        checkpoint = work.parent / 'catalog-expansion-v6/tony-catalog-adapter.pt'
        expected = track['model_sha256']
    else:
        checkpoint = Path(track['voice_checkpoint']).resolve()
        expected = track['voice_model_sha256']
        plan = load(work / 'conversion-plan.json')
        if Path(plan['adapter']).resolve() != checkpoint:
            raise ValueError('Conversion plan and frozen voice checkpoint disagree')
    if not checkpoint.is_file() or sha(checkpoint) != expected:
        raise ValueError('The frozen voice checkpoint changed')
    frozen = rvc_profile(work)
    if frozen:
        body = {key: value for key, value in frozen.items() if key != 'fingerprint'}
        if (fingerprint(body) != frozen['fingerprint'] or
                load(work / 'distonyc-configured.json').get('voice_profile_fingerprint') != frozen['fingerprint']):
            raise ValueError('The saved voice profile changed')
        if Path(frozen['files']['adapter']).resolve() != checkpoint:
            raise ValueError('Saved voice profile and frozen voice checkpoint disagree')
        changed = sorted(key for key, path in frozen['files'].items() if not Path(path).is_file() or sha(path) != frozen['sha256'][key])
        if changed:
            raise ValueError('The frozen voice runtime changed: ' + ', '.join(changed))
        return {'voice_model': voice, 'runtime_kind': 'rvc-v1', 'checkpoint': str(checkpoint), 'checkpoint_sha256': expected,
                'recipe': str(recipe), 'recipe_sha256': sha(recipe), 'runtime': frozen['files']['runtime'],
                'runtime_sha256': frozen['sha256']}
    style = work / 'conversion/tony-multiple-songs-style.npy'
    return {'voice_model': voice, 'checkpoint': str(checkpoint), 'checkpoint_sha256': expected,
            'recipe': str(recipe), 'recipe_sha256': sha(recipe), 'style_sha256': sha(style)}


def install(engine, model, checkpoint, profile):
    if profile['voice_model'] == 'v6':
        modules = engine.install(model)
    else:
        rank, layers = checkpoint['rank'], checkpoint['attention_layers']
        if type(rank) is not int or rank < 1 or not isinstance(layers, (list, tuple)) or not layers:
            raise ValueError('Invalid frozen voice adapter architecture')
        modules = engine.install(model, rank=rank, layers=layers)
    engine.restore(modules, checkpoint['adapter'], checkpoint['recommended_strength'])
    return modules


def sing_rvc(profile, folder):
    """Sing a repair passage laid out as a one-phrase job. The pinned runtime checks its own model and converter before singing."""
    subprocess.run([sys.executable, profile['runtime'], str(folder), 'diffuse'], cwd=folder, check=True,
                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))


def reserve_stage(status, path, name):
    """Persist costly work before invocation; an uncertain prior call cannot repeat."""
    if not name.endswith((":diffuse", ":vocode")): return
    invocations = status.setdefault("invocations", {})
    if name in invocations:
        raise ValueError("A voice repair invocation was already started; retain its outputs for inspection: " + name)
    invocations[name] = {"attempts": 1, "status": "started"}
    save(path, status)
