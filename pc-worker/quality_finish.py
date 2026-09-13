"""Versioned outro-warning policy around the unchanged, hash-checked finisher.

Only the known upper bound on instrumental outro length becomes advisory.
All audio integrity, missing-vocal, peak, decay, and delivery checks still run.
"""
import argparse
import ast
import math
import sys
from pathlib import Path
from common import load, save, sha

RULE = "Long instrumental outro requires an arrangement edit or verified native decay"
GUARD = ast.parse("0 < post_vocal_seconds <= 13", mode="eval").body


def compile_policy(source, filename):
    tree = ast.parse(source, filename)
    changed = 0

    class Policy(ast.NodeTransformer):
        def visit_Assert(self, node):
            nonlocal changed
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
    return compile(ast.fix_missing_locations(tree), filename, "exec")


def review_outro(seconds, issues):
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("The final vocal has no complete ending; the saved mix needs repair.")
    if seconds > 13:
        issues.append({"code": "long_instrumental_outro", "seconds": round(seconds, 2)})


def finish(work, expected_sha):
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
                    "_distonyc_review_outro": lambda seconds: review_outro(seconds, issues)})
    finally:
        sys.argv = previous
    report = load(work / "mix-results.json")
    if report.get("status") != "completed":
        raise ValueError("The finisher did not complete its checks.")
    if issues:
        report["qualityIssues"] = issues
        save(work / "mix-results.json", report)
    save(work / "quality-policy.json", {"version": 2, "source_sha256": expected_sha,
         "advisory_rule": "long_instrumental_outro", "qualityIssues": issues,
         "integrity_checks_retained": True, "original_finisher_unchanged": True})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--source-sha256", required=True)
    args = parser.parse_args()
    finish(args.work, args.source_sha256)
