"""Canonical planner output contract; legacy spelling is normalized before validation."""
from vocal_accents import SCHEMA as VOCAL_ACCENTS_SCHEMA

KEYS = [f'{note}{accidental} {mode}' for note in 'ABCDEFG'
        for accidental in ('', '#', 'b') for mode in ('major', 'minor')]
STYLES = ['rock', 'acoustic', 'opera']
DURATION_MIN, DURATION_MAX = 120, 1140
BPM_MIN, BPM_MAX = 45, 220

FIELDS = {
    'recipe': {'type': 'string', 'enum': ['new', 'reinterpretation', 'remix', 'acoustic', 'barbershop', 'needs_attention']},
    'title': {'type': 'string', 'minLength': 1, 'maxLength': 80},
    'style': {'type': 'string', 'enum': STYLES,
              'description': 'Vocal reference family. Put requested genres such as R&B in arrangement.'},
    'duration': {'type': 'integer', 'minimum': DURATION_MIN, 'maximum': DURATION_MAX},
    'bpm': {'type': 'integer', 'minimum': BPM_MIN, 'maximum': BPM_MAX},
    'keyscale': {'type': 'string', 'enum': KEYS,
                 'description': 'Canonical musical key, for example C# minor or Bb major.'},
    'lyrics': {'type': 'string', 'maxLength': 16000},
    'arrangement': {'type': 'string', 'maxLength': 5000},
    'preserve_generated_backing': {'type': 'boolean'},
    'explanation': {'type': 'string'},
    'vocal_accents': VOCAL_ACCENTS_SCHEMA,
    'fear_hunger': {'type': 'boolean'},
    'allow_long_instrumental_outro': {'type': 'boolean',
        'description': 'True only when the user explicitly requests a long instrumental ending or extended closing solo.'},
    'movements': {'type': 'array', 'maxItems': 6, 'items': {'type': 'object',
        'properties': {'duration': {'type': 'integer', 'minimum': 120, 'maximum': 300},
                       'lyrics': {'type': 'string', 'minLength': 80, 'maxLength': 6000},
                       'arrangement': {'type': 'string', 'minLength': 80, 'maxLength': 5000}},
        'required': ['duration', 'lyrics', 'arrangement'], 'additionalProperties': False},
        'description': 'Empty up to ten minutes. Longer songs use 3–6 connected movements with complete lyrics and durations summing to the full duration.'},
}
SCHEMA = {'type': 'object', 'properties': FIELDS, 'required': list(FIELDS), 'additionalProperties': False}
