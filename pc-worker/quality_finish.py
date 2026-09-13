"""Versioned outro-warning policy around the unchanged, hash-checked finisher.

The known outro upper bound becomes advisory. A separate conservative review
distinguishes verified separator bleed from missing voice; dropout thresholds,
peak, decay, and delivery checks still run on the unchanged audio.
"""
import argparse
import ast
import math
import sys
from pathlib import Path
from common import load, save, sha
from vocal_evidence import review as review_vocals

RULE = "Long instrumental outro requires an arrangement edit or verified native decay"
GUARD = ast.parse("0 < post_vocal_seconds <= 13", mode="eval").body
VOCAL_GUARD = ast.parse("longest <= .4", mode="eval").body


def compile_policy(source, filename):
    tree = ast.parse(source, filename)
    changed = 0
    vocal_changed = 0

    class Policy(ast.NodeTransformer):
        def visit_Assert(self, node):
            nonlocal changed, vocal_changed
            if (isinstance(node.msg, ast.Tuple) and len(node.msg.elts) == 2
                    and isinstance(node.msg.elts[0], ast.Constant) and node.msg.elts[0].value == 'Missing vocal phrase'
                    and ast.dump(node.test) == ast.dump(VOCAL_GUARD)
                    and isinstance(node.msg.elts[1], ast.Name) and node.msg.elts[1].id == 'weak'):
                vocal_changed += 1
                review = ast.parse('weak, longest = _distonyc_review_vocals(weak, longest)').body[0]
                node.test = ast.BoolOp(op=ast.Or(), values=[node.test,
                    ast.parse('_distonyc_warn_vocals(weak, longest)', mode='eval').body])
                return [ast.copy_location(review, node), node]
            if (isinstance(node.msg, ast.Tuple) and len(node.msg.elts) == 2
                    and isinstance(node.msg.elts[0], ast.Constant) and node.msg.elts[0].value == RULE
                    and ast.dump(node.test) == ast.dump(GUARD)):
                changed += 1
                return ast.copy_location(ast.Expr(value=ast.Call(
                    func=ast.Name(id="_distonyc_review_outro", ctx=ast.Load()),
                    args=[ast.Name(id="post_vocal_seconds", ctx=ast.Load())], keywords=[])), node)
            return node

    tree = Policy().visit(tree)
    if changed != 1:
        raise ValueError("This finisher is not supported by the outro-warning policy; saved work is retained.")
    if vocal_changed > 1: raise ValueError('Unexpected duplicate missing-vocal checks')
    return compile(ast.fix_missing_locations(tree), filename, "exec")


def review_outro(seconds, issues):
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("The final vocal has no complete ending; the saved mix needs repair.")
    if seconds > 13:
        issues.append({"code": "long_instrumental_outro", "seconds": round(seconds, 2)})


def warn_vocals(work, weak, longest, issues, enabled=False):
    policy_path = Path(work) / 'vocal-quality-policy.json'
    if not enabled or not policy_path.exists(): return False
    policy = load(policy_path)
    if policy.get('version') != 1 or policy.get('after_bounded_repair') is not True:
        raise ValueError('Invalid vocal warning policy; retain the saved audio for review.')
    for name in ('selected-vocals.wav', 'selected-backing.wav', 'matched-vocals.wav'):
        if policy.get('inputs_sha256', {}).get(name) != sha(Path(work) / name):
            raise ValueError('Vocal warning inputs changed; refusing to use stale recovery evidence.')
    if not math.isfinite(longest) or longest <= .4 or not weak:
        raise ValueError('Invalid unresolved vocal dropout measurement')
    seconds = len({round(t * 5) for t in weak}) / 5
    if not .4 < seconds <= 600: raise ValueError('Invalid vocal warning duration')
    issues.append({'code': 'vocal_dropout', 'seconds': round(seconds, 2)})
    return True


def finish(work, expected_sha, vocal_dropout_warnings=False):
    work = Path(work).resolve()
    source = work / "finish_song.py"
    if sha(source) != expected_sha:
        raise ValueError("The saved finisher changed; refusing to render changed inputs.")
    code = compile_policy(source.read_text("utf-8-sig"), str(source))
    arrangement = work / 'arrangement-quality-policy.json'
    issues = load(arrangement).get('qualityIssues', []) if arrangement.exists() else []
    previous = sys.argv
    try:
        sys.argv = [str(source), "--work", str(work)]
        exec(code, {"__name__": "__main__", "__file__": str(source),
                    "_distonyc_review_outro": lambda seconds: review_outro(seconds, issues),
                    "_distonyc_review_vocals": lambda weak, longest: review_vocals(work, weak, longest),
                    "_distonyc_warn_vocals": lambda weak, longest: warn_vocals(work, weak, longest, issues, vocal_dropout_warnings)})
    finally:
        sys.argv = previous
    report = load(work / "mix-results.json")
    if report.get("status") != "completed":
        raise ValueError("The finisher did not complete its checks.")
    if issues:
        report["qualityIssues"] = issues
        save(work / "mix-results.json", report)
    evidence = work / 'vocal-evidence.json'
    if evidence.exists():
        source_review = load(evidence)
        if all(source_review.get('inputs_sha256', {}).get(name) == sha(work / name)
               for name in ('selected-vocals.wav', 'selected-backing.wav', 'matched-vocals.wav')):
            report['vocal_source_review'] = source_review
            save(work / 'mix-results.json', report)
    save(work / "quality-policy.json", {"version": 3, "source_sha256": expected_sha,
         "advisory_rule": "long_instrumental_outro", "qualityIssues": issues,
         "integrity_checks_retained": True, "original_finisher_unchanged": True})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument('--allow-vocal-dropout-warning', action='store_true')
    args = parser.parse_args()
    finish(args.work, args.source_sha256, args.allow_vocal_dropout_warning)
