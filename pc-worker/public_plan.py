"""The musical part of a saved plan, suitable for the public song page."""


def public_plan(plan):
    result = {'version': 1, **{key: plan[key] for key in (
        'title', 'recipe', 'style', 'keyscale', 'arrangement', 'lyrics', 'duration', 'bpm')}}
    if 'musicalSettings' in plan:
        from musical_settings import public_settings
        result['musicalSettings'] = public_settings(plan['musicalSettings'])
    if plan.get('movements'):
        result['movements'] = [{key: movement[key] for key in ('duration', 'arrangement', 'lyrics')}
                               for movement in plan['movements']]
    return result
