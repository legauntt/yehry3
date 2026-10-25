"""Public numeric review evidence, without private exception text or paths."""
import ast
import math
import re
from pathlib import Path
from common import load


def measurements(work):
    work = Path(work)
    issues = []
    path = work / 'arrangement-checks.json'
    if path.exists():
        fraction = load(path).get('voiced_energy_fraction')
        if isinstance(fraction, (int, float)) and math.isfinite(fraction) and 0 <= fraction <= 1:
            issues.append({'code': 'vocal_activity_check', 'fraction': fraction,
                           'requiredFraction': .5, 'minimumFraction': .05})
    path = work / 'desktop-status.json'
    detail = load(path).get('error', '') if path.exists() else ''
    match = re.search(r"Insufficient mutually voiced frames in pitched source', (\{[^\r\n]+?\})", detail)
    if match:
        try:
            row = ast.literal_eval(match.group(1))
            counts = [row.get(key) for key in ('source_voiced_frames', 'converted_voiced_frames', 'analyzed_frames')]
            if re.fullmatch(r'phrase-\d{3,4}', row.get('label', '')) and all(type(n) is int and 0 <= n <= 1000000 for n in counts) and counts[2] > 0 and max(counts[:2]) <= counts[2]:
                issues.append({'code': 'voice_pitch_check', 'phrase': row['label'],
                               'sourceFrames': counts[0], 'convertedFrames': counts[1],
                               'analyzedFrames': counts[2], 'minimumMutualFrames': 11})
        except (ValueError, SyntaxError, TypeError):
            pass
    return issues


def with_measurements(issues, work):
    measured = measurements(work)
    codes = {issue['code'] for issue in measured}
    return [issue for issue in issues if issue['code'] not in codes] + measured


def backfill(config, api, song_id, url, work):
    """Pin an existing recording and synchronize its numeric notes and fallback."""
    import base64
    import json
    from publish import gh_json, catalog_content, REPO, BRANCH
    rows = measurements(work)
    if not rows:
        raise ValueError('No saved review measurements')
    result = api.call(f'/songs/{song_id}/review-measurements', {'url': url, 'measurements': rows})
    for attempt in range(4):
        current = gh_json(config, ['api', f'repos/{REPO}/contents/catalog.json?ref={BRANCH}'])
        catalog = catalog_content(config, current)
        song = next((row for row in catalog['songs'] if row['id'] == song_id), None)
        if not song or song['url'] != url:
            raise ValueError('Published recording changed before review backfill')
        if song.get('qualityIssues') == result['qualityIssues']:
            return result
        song['qualityIssues'] = result['qualityIssues']
        content = (json.dumps(catalog, ensure_ascii=False, indent=2) + '\n').encode()
        try:
            gh_json(config, ['api', f'repos/{REPO}/contents/catalog.json', '--method', 'PUT'], {
                'message': f'Add review measurements for {song_id}', 'branch': BRANCH,
                'sha': current['sha'], 'content': base64.b64encode(content).decode()})
            return result
        except RuntimeError as error:
            if attempt == 3 or not any(code in str(error) for code in ('409', '422')):
                raise
    raise RuntimeError('Catalog changed repeatedly during review backfill')
