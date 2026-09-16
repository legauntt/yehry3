"""Stable length variety for fresh plans; explicit requests take priority."""
import random
from common import fingerprint

VERSION = 1


def choose(brief_hash):
    rng = random.Random(int(fingerprint({'version': VERSION, 'brief': brief_hash}), 16))
    draw = rng.random()
    if draw < .67: band, target = 'baseline', rng.triangular(180, 300, 240)
    elif draw < .82: band, target = 'short', rng.uniform(120, 180)
    elif draw < .99: band, target = 'extended', rng.uniform(300, 480)
    elif draw < .999: band, target = 'rare_long', rng.uniform(540, 600)
    else: band, target = 'exceptional_suite', 1140
    return {'version': VERSION, 'briefHash': brief_hash, 'band': band,
            'target_seconds': round(target / 5) * 5,
            'weights': {'baseline': .67, 'short': .15, 'extended': .17, 'rare_long': .009, 'exceptional_suite': .001},
            'explicit_user_length_overrides': True}


def join_lyrics(movements):
    return '\n\n'.join(f'[Movement {i + 1}]\n' + '\n'.join(
        line for line in part['lyrics'].strip().splitlines() if line.strip() != '[End]')
        for i, part in enumerate(movements)) + '\n[End]'


def validate_movements(plan):
    movements = plan.get('movements', [])
    if not isinstance(movements, list): raise ValueError('Movements must be a list')
    if plan['recipe'] not in ('new', 'reinterpretation') or plan['duration'] <= 600:
        if movements: raise ValueError('Use movements only for original/reinterpreted songs longer than ten minutes')
        return
    if not 3 <= len(movements) <= 6: raise ValueError('Long songs need 3–6 deliberately connected movements')
    for part in movements:
        if not isinstance(part, dict) or set(part) != {'duration', 'lyrics', 'arrangement'}:
            raise ValueError('Each movement needs duration, complete lyrics and arrangement')
        if type(part['duration']) is not int or not 120 <= part['duration'] <= 300:
            raise ValueError('Each movement must be 120–300 whole seconds')
        if not isinstance(part['lyrics'], str) or not 80 <= len(part['lyrics']) <= 6000 or not part['lyrics'].strip().endswith('[End]'):
            raise ValueError('Each movement needs complete lyrics ending with [End]')
        if not isinstance(part['arrangement'], str) or not 80 <= len(part['arrangement']) <= 5000:
            raise ValueError('Each movement needs a complete arrangement')
    if sum(part['duration'] for part in movements) != plan['duration']:
        raise ValueError('Movement durations must add up to the full song duration')
    if plan['lyrics'] != join_lyrics(movements): raise ValueError('Full lyrics must match the saved movement lyrics')
