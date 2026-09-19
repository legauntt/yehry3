"""Bind a contextual repair to the voice and recipe frozen in the failed job."""
from pathlib import Path
from common import load, save, sha


def supported(request):
    voice = request.get('voice_model', 'v6')
    enabled = request.get('config', {}).get('automatic_versioned_vocal_repair', False)
    selected = enabled is True or (isinstance(enabled, list) and voice in enabled)
    return voice == 'v6' or (voice in ('v7', 'v8') and selected)


def resolve(work, manifest):
    work = Path(work)
    track = load(work / 'track.json')
    voice = track.get('voice_model', 'v6')
    if voice not in ('v6', 'v7', 'v8'):
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


def reserve_stage(status, path, name):
    """Persist costly work before invocation; an uncertain prior call cannot repeat."""
    if not name.endswith((":diffuse", ":vocode")): return
    invocations = status.setdefault("invocations", {})
    if name in invocations:
        raise ValueError("A voice repair invocation was already started; retain its outputs for inspection: " + name)
    invocations[name] = {"attempts": 1, "status": "started"}
    save(path, status)
