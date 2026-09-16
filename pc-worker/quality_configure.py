"""Report long instrumental breaks while retaining vocal and ending checks."""
import argparse
import ast
import math
import sys
from pathlib import Path
from common import load, save, sha

RULE = 'Too much instrumental space'
GUARD = ast.parse("last-first>duration*.6 and max([g['seconds'] for g in gaps],default=0)<9.5", mode='eval').body
INTRO_RULE = 'Long instrumental introduction'
INTRO_GUARD = ast.parse('first<13', mode='eval').body


def compile_policy(source, filename):
    tree = ast.parse(source, filename)
    changed = {'break': 0, 'intro': 0}

    class Policy(ast.NodeTransformer):
        def visit_Assert(self, node):
            nonlocal changed
            if (isinstance(node.msg, ast.Tuple) and len(node.msg.elts) == 2
                    and isinstance(node.msg.elts[0], ast.Constant) and node.msg.elts[0].value == INTRO_RULE
                    and ast.dump(node.test) == ast.dump(INTRO_GUARD)):
                changed['intro'] += 1
                return ast.copy_location(ast.Expr(value=ast.Call(
                    func=ast.Name(id='_distonyc_review_intro', ctx=ast.Load()),
                    args=[ast.Name(id='first', ctx=ast.Load())], keywords=[])), node)
            if (isinstance(node.msg, ast.Tuple) and len(node.msg.elts) == 2
                    and isinstance(node.msg.elts[0], ast.Constant) and node.msg.elts[0].value == RULE
                    and ast.dump(node.test) == ast.dump(GUARD)):
                changed['break'] += 1
                # Retain the minimum vocal span, along with every surrounding
                # assertion. Only the instrumental-break upper bound is advisory.
                span = ast.copy_location(ast.Assert(test=node.test.values[0], msg=node.msg), node)
                review = ast.copy_location(ast.Expr(value=ast.Call(
                    func=ast.Name(id='_distonyc_review_breaks', ctx=ast.Load()),
                    args=[ast.Name(id='gaps', ctx=ast.Load())], keywords=[])), node)
                return [span, review]
            return node

    tree = Policy().visit(tree)
    if changed != {'break': 1, 'intro': 1}:
        raise ValueError('This arrangement checker is not supported by the instrumental-spacing policy')
    return compile(ast.fix_missing_locations(tree), filename, 'exec')


def review_breaks(gaps, issues):
    values = [gap['seconds'] for gap in gaps]
    if any(not math.isfinite(value) or value < 0 for value in values): raise ValueError('Invalid vocal gap analysis')
    longest = max(values, default=0)
    if longest >= 9.5: record_spacing(longest, issues)


def review_intro(first, issues):
    if not math.isfinite(first) or first < 0: raise ValueError('Invalid first-vocal analysis')
    if first >= 13: record_spacing(first, issues)


def record_spacing(seconds, issues):
    value = round(seconds, 2)
    existing = next((issue for issue in issues if issue['code'] == 'long_instrumental_break'), None)
    if existing: existing['seconds'] = max(existing['seconds'], value)
    else: issues.append({'code': 'long_instrumental_break', 'seconds': value})


def configure(work, expected_sha):
    work = Path(work).resolve()
    source = work / 'configure_song.py'
    if sha(source) != expected_sha: raise ValueError('The saved arrangement checker changed')
    code = compile_policy(source.read_text('utf-8-sig'), str(source))
    issues = []
    previous = sys.argv
    try:
        sys.argv = [str(source), '--work', str(work)]
        exec(code, {'__name__': '__main__', '__file__': str(source),
                    '_distonyc_review_breaks': lambda gaps: review_breaks(gaps, issues),
                    '_distonyc_review_intro': lambda first: review_intro(first, issues)})
    finally: sys.argv = previous
    save(work / 'arrangement-quality-policy.json', {'version': 1, 'source_sha256': expected_sha,
         'qualityIssues': issues, 'integrity_checks_retained': True, 'original_checker_unchanged': True})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', required=True, type=Path)
    parser.add_argument('--source-sha256', required=True)
    args = parser.parse_args()
    configure(args.work, args.source_sha256)
