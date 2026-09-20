"""Resolve and freeze per-request Tony voice profiles without mixing model assets."""
from pathlib import Path
import re
from common import fingerprint, sha

PROFILE_FILES = {
    'adapter': 'candidates/c/adapter.pt',
    'runtime': 'voice_runtime.py',
    'common': 'common.py',
    'bank': 'features.json',
    'style': 'features/tony-fresh-style.npy',
}
# An RVC v2 model sung through a pinned Applio checkout. `adapter` stays the key the renderer freezes into the track;
# the runtime keeps the same seven stage names, so the engine, B sides and checks treat it like any versioned voice.
RVC_FILES = {
    'adapter': 'model/tony-v9.pth',
    'index': 'model/tony-v9.index',
    'runtime': 'voice_runtime.py',
    'common': 'common.py',
    'singer': 'rvc_sing.py',
    'applio': 'applio.json',
}
RUNTIME_FILES = {'fresh-catalog-v1': PROFILE_FILES, 'rvc-v1': RVC_FILES}
REFERENCE_PROFILES = {
    'rock': {'median_hz': 175, 'voiced_fraction': .65, 'energy_stratum': 'middle'},
    'acoustic': {'median_hz': 160, 'voiced_fraction': .72, 'energy_stratum': 'low'},
    'opera': {'median_hz': 220, 'voiced_fraction': .85, 'energy_stratum': 'high'},
}


def selected(prompt):
    value = (prompt.get('details') or {}).get('voiceModel', 'v6')
    if not isinstance(value, str) or not re.fullmatch(r'v[1-9][0-9]*', value):
        raise ValueError('The request has an unsupported Tony voice model')
    return value


def resolve(config, name):
    if name == 'v6':
        return {'name': 'v6', 'label': 'Tony V6', 'fingerprint': 'v6-established'}
    configured = (config.get('voice_models') or {}).get(name)
    if not isinstance(configured, dict):
        raise ValueError(f'Tony {name.upper()} is selected, but its isolated voice profile is not installed')
    runtime_kind = configured.get('runtime_kind', 'fresh-catalog-v1')
    if runtime_kind not in RUNTIME_FILES:
        raise ValueError(f'Tony {name.upper()} uses an unsupported voice runtime')
    expected = RUNTIME_FILES[runtime_kind]
    root = Path(configured.get('root', '')).resolve()
    pins = configured.get('sha256') or {}
    if not root.is_dir() or set(pins) != set(expected):
        raise ValueError(f'The installed Tony {name.upper()} profile is incomplete')
    files = {key: (root / relative).resolve() for key, relative in expected.items()}
    if any(not path.is_relative_to(root) or not path.is_file() for path in files.values()):
        raise ValueError(f'An installed Tony {name.upper()} profile asset is missing')
    actual = {key: sha(path) for key, path in files.items()}
    if actual != pins:
        raise ValueError(f'An installed Tony {name.upper()} profile asset changed')
    profiles = configured.get('reference_profiles', REFERENCE_PROFILES)
    if not isinstance(profiles, dict): raise ValueError('The installed voice reference profiles are invalid')
    frozen = {'name': name, 'label': configured.get('label', f'Tony {name.upper()}'), 'runtime_kind': runtime_kind,
              'root': str(root), 'files': {key: str(path) for key, path in files.items()}, 'sha256': actual,
              'reference_profiles': profiles}
    frozen['fingerprint'] = fingerprint(frozen)
    return frozen


def reference_profile(profile, style):
    profiles = profile.get('reference_profiles', REFERENCE_PROFILES)
    if style not in profiles:
        raise ValueError(f"Tony {profile['name'].upper()} does not support this voice style")
    result = profiles[style]
    if (not isinstance(result, dict) or not isinstance(result.get('median_hz'), (int, float)) or
            not isinstance(result.get('voiced_fraction'), (int, float)) or
            result.get('energy_stratum') not in ('low', 'middle', 'high')):
        raise ValueError('The installed voice reference profile is invalid')
    return dict(result)


def capabilities(config):
    models, result = config.get('voice_models') or {}, []
    if config.get('generation_v8') and 'v8' in models:
        resolve(config, 'v8')
        result.append('voice-v8-v1')
    if 'v9' in models:
        resolve(config, 'v9')
        result.append('voice-v9-v1')
    return result


def validate_generation_fork(voice_model, generation_profile, plan):
    if voice_model == 'v8' and (generation_profile != 'v8' or not plan.get('generation')):
        raise ValueError('A Tony V8 request requires its saved V8 generation profile; refusing a legacy fallback')
