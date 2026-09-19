"""Durable owner reviews. Pauses release the worker and never hold the GPU."""
import copy
import uuid
from pathlib import Path
from common import load, save, fingerprint
from generation_controls import normalize, constraints
from planner import validate
from public_plan import public_plan
from request_materials import validate_materials, minimum_duration


def frozen(path, value):
    path = Path(path)
    if path.exists():
        if load(path) != value: raise ValueError('Saved generation review inputs changed')
    else: save(path, value)
    return value


def approved_plan(plan, prompt, directory, basis, api):
    settings = normalize(prompt.get('details', {}).get('generation'))
    if not settings or not settings['reviewLyrics']: return plan, None
    review = api.call(f"/prompts/{prompt['id']}/generation-review/lyrics")['review']
    offer = {'reviewId': str(uuid.uuid5(uuid.NAMESPACE_URL, prompt['id'] + ':lyrics-v1')),
             'kind': 'lyrics', 'payload': public_plan(plan)}
    frozen(Path(directory) / 'lyric-review-offer.json', offer)
    if not review or review['state'] == 'pending': return None, offer
    if (review['id'] != offer['reviewId'] or review['kind'] != 'lyrics' or review['payload'] != offer['payload']
            or review['state'] != 'approved' or review['decision'].get('action') != 'approve'):
        raise ValueError('Saved lyric approval does not match the original plan')
    candidate = {**plan, 'lyrics': review['decision']['lyrics']}
    candidate = constraints(validate_materials(validate(candidate, basis, minimum_duration(prompt)), prompt), prompt)
    frozen(Path(directory) / 'approved-plan.json', {'original_plan_hash': fingerprint(plan), 'review': review, 'plan': candidate})
    return candidate, None


def candidate_request(request, index):
    value = copy.deepcopy(request)
    value['prompt_id'] += f':composition-v8-{index}'
    value['directory'] = str(Path(request['directory']) / f'candidate-{index}')
    value['parent_progress'] = str(Path(request['directory']) / 'progress.json')
    value['candidate_part'] = True
    value['config']['automatic_outro_retry'] = False
    settings = value['plan']['generation']
    seed = settings.get('seed', int(fingerprint(request['prompt_id'])[:7], 16))
    settings['seed'] = (seed + index * 1009) % 2147481648
    return value


def composition_choice(request, prompt, api):
    settings = normalize(request['plan'].get('generation'))
    if not settings or settings['candidates'] < 2: return None
    directory = Path(request['directory'])
    offer = load(directory / 'composition-review-offer.json')
    review = api.call(f"/prompts/{prompt['id']}/generation-review/composition")['review']
    if not review or review['state'] == 'pending': return offer
    if (review['id'] != offer['reviewId'] or review['payload'] != offer['payload'] or review['state'] != 'approved'
            or review['decision'].get('action') != 'approve'):
        raise ValueError('Saved composition approval changed')
    index = review['decision'].get('candidate')
    if type(index) is not int or not 0 <= index < settings['candidates']: raise ValueError('Invalid saved composition choice')
    frozen(directory / 'composition-selection.json', {'version': 1, 'inputs_hash': fingerprint(request), 'index': index, 'review_id': review['id']})
    return None
