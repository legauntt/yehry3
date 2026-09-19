"""Reuse a job's frozen render configuration across unrelated worker upgrades."""
from pathlib import Path
from common import load, save


def reuse_or_save(path, candidate):
    path = Path(path)
    if not path.exists():
        save(path, candidate)
        return candidate
    saved = load(path)
    if ({key: value for key, value in candidate.items() if key != 'config'} !=
            {key: value for key, value in saved.items() if key != 'config'}):
        raise ValueError('Frozen rendering identity, plan, basis or voice changed')
    if not isinstance(saved.get('config'), dict):
        raise ValueError('Missing frozen rendering configuration')
    # Current configuration still controls queue credentials and publication.
    # The saved renderer retains the settings under which its audio was made.
    # In particular, a newly enabled queue capability cannot rewrite its hash.
    return saved
