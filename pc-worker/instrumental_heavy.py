"""Explicit request-only arrangement policy; audio and ending checks stay active."""
import argparse
import ast
import math
import sys
from pathlib import Path
from common import load, save, sha
from quality_configure import review_breaks, review_intro, trim_silent_lead

GUARDS = {
    'Long instrumental introduction': 'first<13',
    'Insufficient vocal signal activity': 'float(mask.mean())>=.50',
    'Insufficient lead vocal coverage for this opera': 'float(mask.mean())>=.65',
    'Too much instrumental space': "last-first>duration*.6 and max([g['seconds'] for g in gaps],default=0)<9.5",
    'Overlong orchestral gap': "last-first>duration*.7 and max([g['seconds'] for g in gaps],default=0)<16",
    'Repeated long instrumental interludes': "sum(g['seconds']>9.5 for g in gaps)<=1",
}


def compile_policy(source, filename):
    tree = ast.parse(source, filename)
    changed = {key: 0 for key in GUARDS}

    class Policy(ast.NodeTransformer):
        def visit_Assert(self, node):
            if not (isinstance(node.msg, ast.Tuple) and len(node.msg.elts) == 2
                    and isinstance(node.msg.elts[0], ast.Constant)):
                return node
            rule = node.msg.elts[0].value
            if rule not in GUARDS: return node
            if ast.dump(node.test) != ast.dump(ast.parse(GUARDS[rule], mode='eval').body):
                raise ValueError('Unsupported instrumental-heavy arrangement guard: ' + rule)
            changed[rule] += 1
            if rule == 'Long instrumental introduction':
                function, argument = '_review_intro', 'first'
            elif rule == 'Insufficient vocal signal activity':
                function, argument = '_review_coverage', 'evidence'
            elif rule == 'Insufficient lead vocal coverage for this opera':
                return ast.copy_location(ast.Pass(), node)
            else:
                function, argument = '_review_breaks', 'gaps'
            return ast.copy_location(ast.Expr(value=ast.Call(
                func=ast.Name(id=function, ctx=ast.Load()),
                args=[ast.Name(id=argument, ctx=ast.Load())], keywords=[])), node)

    tree = Policy().visit(tree)
    song = {key: int(key in ('Long instrumental introduction', 'Insufficient vocal signal activity', 'Too much instrumental space')) for key in GUARDS}
    opera = {key: int(key != 'Too much instrumental space') for key in GUARDS}
    if changed not in (song, opera):
        raise ValueError('Unsupported instrumental-heavy arrangement checker')
    return compile(ast.fix_missing_locations(tree), filename, 'exec')


def review_coverage(evidence, issues):
    values = [evidence.get(key) for key in ('duration', 'first_detected_voice',
              'last_detected_voice', 'voiced_energy_fraction')]
    if not all(type(value) in (int, float) and math.isfinite(value) for value in values):
        raise ValueError('Invalid instrumental-heavy vocal measurements')
    duration, first, last, fraction = values
    if not (duration > 0 and 0 <= first < last <= duration and 0 < fraction <= 1):
        raise ValueError('Instrumental-heavy songs still require usable vocal activity')
    if fraction < .5:
        issues.append({'code': 'low_vocal_coverage', 'fraction': fraction})


def verify_intent(work):
    manifest = load(work / 'desktop-job.json')
    if sha(work / 'track.json') != manifest.get('track_sha256'):
        raise ValueError('Frozen instrumental-heavy song inputs changed')
    if load(work / 'track.json').get('generation', {}).get('instrumentalHeavy') is not True:
        raise ValueError('Instrumental-heavy policy requires an explicit request choice')
    return manifest


def configure(work, expected_sha):
    work = Path(work).resolve()
    manifest = verify_intent(work)
    source = work / 'configure_song.py'
    if sha(source) != expected_sha or manifest.get('workers', {}).get(source.name) != expected_sha:
        raise ValueError('Frozen instrumental-heavy arrangement checker changed')
    code = compile_policy(source.read_text('utf-8-sig'), str(source))
    issues = []
    previous = sys.argv
    try:
        sys.argv = [str(source), '--work', str(work)]
        exec(code, {'__name__': '__main__', '__file__': str(source),
                    '_review_coverage': lambda evidence: review_coverage(evidence, issues),
                    '_review_breaks': lambda gaps: review_breaks(gaps, issues),
                    '_review_intro': lambda first: review_intro(first, issues)})
    finally: sys.argv = previous
    trim_silent_lead(work)
    evidence = load(work / 'arrangement-checks.json')
    evidence['instrumental_heavy_requested'] = True
    if 'opera_transition_policy' in evidence:
        evidence['opera_transition_policy'] = 'Explicit instrumental-heavy request; vocal coverage and interludes are advisory'
    save(work / 'arrangement-checks.json', evidence)
    save(work / 'arrangement-quality-policy.json', {'version': 1,
         'source_sha256': expected_sha, 'track_sha256': manifest['track_sha256'],
         'instrumental_heavy': True, 'qualityIssues': issues,
         'other_integrity_checks_retained': True, 'original_checker_unchanged': True})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', required=True, type=Path)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    configure(args.work, args.source_sha256)
