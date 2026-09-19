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
import numpy as np
from common import load, save, sha
from vocal_evidence import review as review_vocals

RULE = "Long instrumental outro requires an arrangement edit or verified native decay"
GUARD = ast.parse("0 < post_vocal_seconds <= 13", mode="eval").body
VOCAL_GUARD = ast.parse("longest <= .4", mode="eval").body
DELIVERY_GUARD = ast.parse(
    "np.isfinite(decoded).all() and abs(len(decoded)-len(mix)) <= 2 "
    "and encoded_peak < 10 ** (-.5 / 20)", mode="eval").body
ENDING_BOUNDARY_GUARD = ast.parse(
    "end/SR >= effective_last_voice+2", mode="eval").body


def compile_policy(source, filename):
    tree = ast.parse(source, filename)
    changed = 0
    vocal_changed = 0
    delivery_changed = 0
    ending_boundary_changed = 0

    class Policy(ast.NodeTransformer):
        def visit_Assert(self, node):
            nonlocal changed, vocal_changed, delivery_changed, ending_boundary_changed
            if node.msg is None and ast.dump(node.test) == ast.dump(ENDING_BOUNDARY_GUARD):
                ending_boundary_changed += 1
                node.test = ast.parse(
                    'end/SR + 1e-9 >= effective_last_voice+2', mode='eval').body
                return node
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
            if node.msg is None and ast.dump(node.test) == ast.dump(DELIVERY_GUARD):
                delivery_changed += 1
                return ast.copy_location(ast.Assert(test=ast.Call(
                    func=ast.Name(id="_distonyc_validate_mp3_delivery", ctx=ast.Load()),
                    args=[ast.Name(id=name, ctx=ast.Load())
                          for name in ("decoded", "mix", "encoded_peak", "SR")],
                    keywords=[]), msg=None), node)
            return node

    tree = Policy().visit(tree)
    if changed != 1:
        raise ValueError("This finisher is not supported by the outro-warning policy; saved work is retained.")
    if vocal_changed > 1: raise ValueError('Unexpected duplicate missing-vocal checks')
    if delivery_changed > 1: raise ValueError('Unexpected duplicate MP3 delivery checks')
    if ending_boundary_changed > 1: raise ValueError('Unexpected duplicate ending boundary checks')
    return compile(ast.fix_missing_locations(tree), filename, "exec")


def review_outro(seconds, issues):
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError("The final vocal has no complete ending; the saved mix needs repair.")
    if seconds > 13:
        issues.append({"code": "long_instrumental_outro", "seconds": round(seconds, 2)})


def validate_mp3_delivery(decoded, mix, encoded_peak, sample_rate):
    """Accept at most one silent MP3 frame beyond the exact source duration."""
    if sample_rate != 44100 or not np.isfinite(decoded).all() or not math.isfinite(encoded_peak):
        return False
    difference = len(decoded) - len(mix)
    if abs(difference) > 2:
        if not 2 < difference <= 1152:
            return False
        padding = decoded[len(mix):]
        if not len(padding) or float(np.max(np.abs(padding))) > 1e-6:
            return False
    return encoded_peak < 10 ** (-.5 / 20)


def warn_vocals(work, weak, longest, issues, enabled=False):
    policy_path = Path(work) / 'vocal-quality-policy.json'
    if not enabled or not policy_path.exists(): return False
    policy = load(policy_path)
    legacy = policy.get('version') == 1 and policy.get('after_bounded_repair') is True
    current = (policy.get('version') == 2 and policy.get('recovery_disposition') in
               ('bounded_repair_exhausted', 'not_supported_for_voice_model'))
    if not (legacy or current):
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


def finish(work, expected_sha, vocal_dropout_warnings=False, source_name='finish_song.py'):
    work = Path(work).resolve()
    if Path(source_name).name != source_name or not source_name.endswith('.py'):
        raise ValueError('Invalid saved finisher name.')
    source = work / source_name
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
                    "_distonyc_warn_vocals": lambda weak, longest: warn_vocals(work, weak, longest, issues, vocal_dropout_warnings),
                    "_distonyc_validate_mp3_delivery": validate_mp3_delivery})
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
    save(work / "quality-policy.json", {"version": 4, "source_sha256": expected_sha,
         "source_name": source_name,
         "advisory_rule": "long_instrumental_outro", "qualityIssues": issues,
         "mp3_padding_policy": "at_most_one_silent_frame",
         "integrity_checks_retained": True, "original_finisher_unchanged": True})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", required=True, type=Path)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument('--source-name', default='finish_song.py')
    parser.add_argument('--allow-vocal-dropout-warning', action='store_true')
    args = parser.parse_args()
    finish(args.work, args.source_sha256, args.allow_vocal_dropout_warning, args.source_name)
