"""Advisory lexical ending evidence; never infer words from vocal energy or cue interpolation."""
import difflib
import math
import re
from pathlib import Path

from common import fingerprint, load, save, sha
from lyric_timing import normalize_words, timestamp_words

REPORT = 'lyrical-ending-review.json'


def match_phrase(expected, words):
    if len(expected) < 4 or len(set(expected)) < 3: return None
    tokens = [w['token'] for w in words]
    found = []
    for start in range(len(tokens)):
        for length in range(max(3, len(expected) - 3), len(expected) + 4):
            end = start + length
            if end > len(tokens): break
            if words[end - 1]['end'] - words[start]['start'] > max(18, len(expected) * 1.8): continue
            matcher = difflib.SequenceMatcher(None, expected, tokens[start:end], autojunk=False)
            blocks = matcher.get_matching_blocks()
            matched = sum(block.size for block in blocks)
            score = 2 * matched / (len(expected) + length)
            if matched >= max(4, math.ceil(len(expected) * .75)) and score >= .78:
                last = max(start + block.b + block.size - 1 for block in blocks if block.size)
                found.append({'start': words[start]['start'], 'end': words[last]['end'],
                              'matched_words': matched, 'expected_words': len(expected), 'score': round(score, 3)})
    # Chorus repetitions are common. Use the last sufficiently supported occurrence.
    return max(found, key=lambda r: (r['end'], r['score'])) if found else None


def analyze(lyrics, words, duration, allow_long=False):
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise ValueError('Invalid duration for lyrical ending review')
    lines = [normalize_words(line) for line in lyrics.splitlines()
             if line.strip() and not re.fullmatch(r'\s*\[[^]]+]\s*', line)]
    lines = [line for line in lines if line]
    words = [word for word in words if 0 <= word['start'] < word['end'] <= duration + .5]
    base = {'version': 1, 'status': 'unavailable', 'duration': duration, 'qualityIssues': [],
            'automatic_transcript': True, 'listening_review': False,
            'caveat': 'Transcript support is not proof of audible words, intelligibility or Tony likeness.'}
    if not lines or len(words) < 12:
        return {**base, 'reason': 'Insufficient lyric or timestamp evidence; no inferred last-word time.'}
    expected = [token for line in lines for token in line]
    recognized = [word['token'] for word in words]
    matched = sum(b.size for b in difflib.SequenceMatcher(None, expected, recognized, autojunk=False).get_matching_blocks())
    coverage = matched / max(len(expected), 1)
    ending = []
    for line in reversed(lines):
        ending = line + ending
        if len(ending) >= 8: break
    ending = ending[-24:]
    final = match_phrase(ending, words)
    result = {**base, 'whole_sheet_ordered_recall': round(coverage, 3), 'ending_tokens': ending,
              'final_phrase': final, 'allow_long_instrumental_outro': allow_long}
    if final:
        tail = max(0, duration - final['end'])
        result.update(status='supported', post_lyric_seconds=round(tail, 2))
        if tail > 20 and not allow_long:
            result['qualityIssues'].append({'code': 'early_lyric_ending', 'seconds': round(tail, 2)})
    elif coverage >= .55:
        result.update(status='closing_words_unconfirmed',
                      reason='The draft supports much of the sheet, but not its intended closing passage; omissions or repetitions need listening review.')
        result['qualityIssues'].append({'code': 'unconfirmed_lyric_ending'})
    else:
        result.update(status='uncertain', reason='Low transcript agreement; do not treat ASR substitutions as missing lyrics.')
    return result


def review(work):
    work = Path(work)
    track = load(work / 'track.json')
    if track.get('vocal_mode') == 'nonverbal':
        result = {'version': 1, 'status': 'not_applicable', 'vocal_mode': 'nonverbal',
                  'qualityIssues': [], 'listening_review': False,
                  'reason': 'An intentional phonetic score has no lexical ending to match; audio ending and file-integrity checks still apply.'}
        save(work / REPORT, result)
        return result
    path = work / 'selected-vocals-words.json'
    if not path.exists(): return {'version': 1, 'status': 'unavailable', 'qualityIssues': [], 'listening_review': False}
    duration = load(work / 'arrangement-checks.json')['duration'] if (work / 'arrangement-checks.json').exists() else track['duration']
    cfg = load(work / 'mix-config.json') if (work / 'mix-config.json').exists() else {}
    if cfg.get('quiet_tail_trim') == 'quiet-tail-trim.json':
        duration = load(work / 'quiet-tail-trim.json')['output_duration']
    identity = fingerprint({'lyrics': track.get('lyrics', ''), 'duration': duration,
                            'words_sha256': sha(path), 'allow_long': track.get('allow_long_instrumental_outro', False)})
    report_path = work / REPORT
    if report_path.exists():
        saved = load(report_path)
        if saved.get('inputs_hash') != identity: raise ValueError('Saved lexical ending evidence changed')
        return saved
    result = analyze(track.get('lyrics', ''), timestamp_words(path), duration, track.get('allow_long_instrumental_outro', False))
    result['inputs_hash'] = identity
    save(report_path, result)
    return result
