"""Convert retained vocal word timestamps into monotonic lyric-line cues."""
import bisect, difflib, math, re, unicodedata
from pathlib import Path
from common import load

WORD_FILES = ('matched-vocals-words.json', 'selected-vocals-words.json', 'original-transcripts.json')


def normalize_words(value):
    value = unicodedata.normalize('NFKD', value.casefold())
    return re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", value)


def timestamp_words(path):
    data = load(path)
    rows = data.get('segments', []) if isinstance(data, dict) else data
    result = []
    for row in rows if isinstance(rows, list) else []:
        words = row.get('words', []) if isinstance(row, dict) else []
        for word in words if isinstance(words, list) else []:
            token = normalize_words(str(word.get('word', '')))
            start, end = word.get('start'), word.get('end')
            if len(token) == 1 and all(isinstance(value, (int, float)) and math.isfinite(value) for value in (start, end)) and 0 <= start <= end:
                result.append({'token': token[0], 'start': float(start), 'end': float(end)})
    return sorted(result, key=lambda word: (word['start'], word['end']))


def lyric_words(text):
    return [word for line in text.splitlines() if not re.fullmatch(r'\s*\[[^]]+]\s*', line)
            for word in normalize_words(line)]


def agreement(text, words):
    expected = lyric_words(text)
    heard = [word['token'] for word in words]
    matcher = difflib.SequenceMatcher(None, expected, heard, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    return {'recall': matched / max(1, len(expected)),
            'score': 2 * matched / max(1, len(expected) + len(heard))}


def timing_sources(work, text='', duration=None):
    candidates = []
    for priority, name in enumerate(WORD_FILES[::-1]):
        path = Path(work) / name
        if path.exists():
            words = timestamp_words(path)
            if duration is not None:
                words = [{**word, 'end': min(word['end'], duration)} for word in words if word['start'] < duration]
            if words:
                candidates.append({'source': name, 'words': words, 'priority': priority,
                                   **agreement(text, words)})
    return sorted(candidates, key=lambda item: (item['score'], item['priority']), reverse=True)


def timing_source(work, text=''):
    candidates = timing_sources(work, text)
    return candidates[0]['words'] if candidates else []


def valid_cues(cues, duration):
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not math.isfinite(duration): return False
    previous = -1
    for cue in cues:
        start, end = cue.get('start'), cue.get('end')
        if (not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
                    for value in (start, end)) or not 0 <= start < end <= duration or start <= previous): return False
        previous = start
    return True


def cue_diagnostics(cues, text, words, duration):
    """Reject unsupported timings, never turn ASR guesses into rewritten lyrics."""
    lines = text.splitlines()
    rejected = []
    if not valid_cues(cues, duration):
        return [{'line': cue.get('line'), 'reason': 'invalid_bounds'} for cue in cues]
    for cue in cues:
        line = cue.get('line')
        if not isinstance(line, int) or not 0 <= line < len(lines):
            rejected.append({'line': line, 'reason': 'invalid_line'}); continue
        expected = normalize_words(lines[line])
        span = cue['end'] - cue['start']
        heard = [word['token'] for word in words
                 if word['start'] >= cue['start'] - .15 and word['end'] <= cue['end'] + .15]
        matched = sum(block.size for block in difflib.SequenceMatcher(None, expected, heard, autojunk=False).get_matching_blocks())
        reason = None
        if len(expected) >= 4 and len(expected) / span > 8: reason = 'compressed_line'
        elif span > max(18, len(expected) * 2.5): reason = 'stretched_line'
        elif matched < min(2, len(expected)) or matched / max(1, len(expected)) < .5: reason = 'weak_word_support'
        if reason: rejected.append({'line': line, 'reason': reason})
    return rejected


def cue_report(work, text, duration):
    reports = []
    for source in timing_sources(work, text, duration):
        raw = _align_cues(text, duration, source['words'])
        rejected = cue_diagnostics(raw, text, source['words'], duration)
        excluded = {item['line'] for item in rejected}
        cues = [cue for cue in raw if cue['line'] not in excluded]
        supported = sum(len(normalize_words(text.splitlines()[cue['line']])) for cue in cues)
        reports.append({**source, 'cues': cues, 'rejected': rejected, 'supported_words': supported})
    return max(reports, key=lambda item: (item['supported_words'], item['score'], item['priority']), default=None)


def spread_collisions(cues, duration):
    if len(cues) < 2: return cues
    starts = [cue['start'] for cue in cues]
    index = 0
    while index < len(starts) - 1:
        if starts[index + 1] > starts[index] + .01:
            index += 1; continue
        first, last = index, index + 1
        while last + 1 < len(starts) and starts[last + 1] <= starts[last] + .01: last += 1
        left = starts[first - 1] if first else max(0.0, starts[first] - 1.0)
        right = starts[last + 1] if last + 1 < len(starts) else float(duration)
        span = right - left
        if span > .01 * (last - first + 2):
            for offset, cue_index in enumerate(range(first, last + 1), 1):
                starts[cue_index] = left + span * offset / (last - first + 2)
        index = last + 1
    for index, cue in enumerate(cues):
        cue['start'] = round(starts[index], 2)
        limit = starts[index + 1] if index + 1 < len(starts) else float(duration)
        cue['end'] = round(min(max(cue['end'], starts[index] + .12), limit), 2)
    return cues


def make_suite_cues(parts, text, duration):
    if not 2 <= len(parts) <= 6: return []
    heard, offset = [], 0.0
    for work, part_duration in parts:
        if not isinstance(part_duration, (int, float)) or not math.isfinite(part_duration) or part_duration <= 0: return []
        for word in timing_source(work, text):
            if word['start'] < part_duration:
                heard.append({**word, 'start': word['start'] + offset,
                              'end': min(word['end'], float(part_duration)) + offset})
        offset += float(part_duration)
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or abs(offset - duration) > .1: return []
    return make_cues(None, text, duration, heard)


def make_cues(work, text, duration, heard=None):
    if heard is None:
        report = cue_report(work, text, duration)
        return report['cues'] if report else []
    cues = _align_cues(text, duration, heard)
    rejected = {item['line'] for item in cue_diagnostics(cues, text, heard, duration)}
    return [cue for cue in cues if cue['line'] not in rejected]


def _align_cues(text, duration, heard):
    lines, lyric_tokens, token_lines = text.splitlines(), [], []
    singable = []
    for line_number, line in enumerate(lines):
        words = normalize_words(line)
        if not words or re.fullmatch(r'\s*\[[^]]+]\s*', line): continue
        singable.append({'line': line_number, 'weight': max(1, len(words)), 'tokens': words})
        lyric_tokens.extend(words); token_lines.extend([line_number] * len(words))
    if isinstance(duration, (int, float)) and math.isfinite(duration):
        heard = [{**word, 'end': min(word['end'], float(duration))} for word in heard if word['start'] < duration]
    if not singable or not lyric_tokens or not heard: return []

    heard_tokens = [word['token'] for word in heard]
    matcher = difflib.SequenceMatcher(None, lyric_tokens, heard_tokens, autojunk=False)
    matches = {}
    for lyric_start, heard_start, size in matcher.get_matching_blocks():
        for offset in range(size): matches.setdefault(token_lines[lyric_start + offset], []).append(heard_start + offset)

    total = sum(line['weight'] for line in singable)
    cumulative = 0
    anchors = [(0.0, 0.0)]
    reliable = {}
    centers = []
    for line in singable:
        center = cumulative + line['weight'] / 2
        centers.append(center)
        found = matches.get(line['line'], [])
        if len(found) >= min(2, line['weight']):
            anchors.append((center, sum(found) / len(found)))
            reliable[line['line']] = (min(found), max(found))
        cumulative += line['weight']
    anchors.append((float(total), float(len(heard) - 1)))
    anchors.sort()
    # Exact anchors are monotonic, but flatten any rounding/repetition edge case.
    for index in range(1, len(anchors)):
        if anchors[index][1] < anchors[index - 1][1]: anchors[index] = (anchors[index][0], anchors[index - 1][1])

    mapped = []
    positions = [point[0] for point in anchors]
    for center in centers:
        right = min(max(1, bisect.bisect_right(positions, center)), len(anchors) - 1)
        left_point, right_point = anchors[right - 1], anchors[right]
        span = right_point[0] - left_point[0]
        ratio = 0 if span <= 0 else (center - left_point[0]) / span
        mapped.append(left_point[1] + ratio * (right_point[1] - left_point[1]))
    mapped[0], mapped[-1] = 0.0, float(len(heard) - 1)

    cues, previous_last = [], -1
    for index, line in enumerate(singable):
        first = 0 if index == 0 else math.floor((mapped[index - 1] + mapped[index]) / 2) + 1
        last = len(heard) - 1 if index == len(singable) - 1 else math.floor((mapped[index] + mapped[index + 1]) / 2)
        if line['line'] in reliable:
            matched_first, matched_last = reliable[line['line']]
            first, last = min(first, matched_first), max(last, matched_last)
        if index + 1 < len(singable) and singable[index + 1]['line'] in reliable:
            last = min(last, reliable[singable[index + 1]['line']][0] - 1)
        first = max(first, previous_last + 1)
        first, last = min(first, len(heard) - 1), min(max(first, last), len(heard) - 1)
        # Never let one highlighted line span a clear instrumental pause. Keep
        # the contiguous vocal phrase nearest this line's aligned position.
        cuts = [word_index for word_index in range(first, last) if heard[word_index + 1]['start'] - heard[word_index]['end'] > 2.5]
        if cuts:
            groups, group_start = [], first
            for cut in cuts:
                groups.append((group_start, cut)); group_start = cut + 1
            groups.append((group_start, last))
            focus = sum(reliable[line['line']]) / 2 if line['line'] in reliable else mapped[index]
            first, last = min(groups, key=lambda group: 0 if group[0] <= focus <= group[1] else min(abs(focus - group[0]), abs(focus - group[1])))
        start, end = heard[first]['start'], heard[last]['end']
        if isinstance(duration, (int, float)) and math.isfinite(duration): end = min(end, float(duration))
        if end <= start:
            end = min(start + .12, float(duration)) if isinstance(duration, (int, float)) and duration > start else start + .12
        cues.append({'line': line['line'], 'start': round(start, 2), 'end': round(end, 2)})
        previous_last = last
    return spread_collisions(cues, duration)
