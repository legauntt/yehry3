"""Public musical choices summarized by the existing planner, never render overrides."""

TEXT_LIMITS = {'genre': 120, 'meter': 40, 'structure': 600,
               'performance': 300, 'energy': 300, 'lyricWorkflow': 300}
FIELDS = {key: {'type': 'string', 'maxLength': limit} for key, limit in TEXT_LIMITS.items()}
FIELDS['instruments'] = {'type': 'array', 'maxItems': 12,
                         'items': {'type': 'string', 'minLength': 1, 'maxLength': 60}}
GUIDANCE = """Fill musicalSettings with the resolved musical choices in this plan, including choices
you make when the request leaves Advanced fields on Auto. Summarize the actual genre,
featured instruments, meter, section order, vocal delivery, energy arc and lyric-writing
approach. Use concise listener-facing descriptions, not "auto" or implementation details.
These are public descriptions of arrangement and lyrics, not additional generation controls.
Make the arrangement carry the same choices and honor explicit requested settings.
Only name instruments intended for the final accompaniment; do not describe discarded
generated backing as the final band. Use an empty string/list only when a choice is unknown
or inapplicable (for example an unavailable source arrangement). For unaccompanied singing,
use genre/arrangement to say a cappella and leave instruments empty. Do not infer an audio
measurement, claim to have listened, or include notes, explanations, paths or other private data.
"""
SCHEMA = {'type': 'object', 'properties': FIELDS, 'required': list(FIELDS),
          'additionalProperties': False, 'description': GUIDANCE}


def public_settings(value):
    """Validate and copy the bounded musical allowlist without changing saved inputs."""
    if not isinstance(value, dict):
        raise ValueError('Invalid musicalSettings: expected an object')
    result = {}
    for key, limit in TEXT_LIMITS.items():
        text = value.get(key)
        if not isinstance(text, str) or len(text.encode('utf-16-le')) // 2 > limit:
            raise ValueError(f'Invalid musicalSettings.{key}: use up to {limit} characters')
        result[key] = text
    instruments = value.get('instruments')
    if not isinstance(instruments, list) or len(instruments) > 12 or any(
            not isinstance(item, str) or not item.strip() or len(item.encode('utf-16-le')) // 2 > 60
            for item in instruments):
        raise ValueError('Invalid musicalSettings.instruments: use up to 12 instrument names of 60 characters')
    result['instruments'] = list(instruments)
    return result
