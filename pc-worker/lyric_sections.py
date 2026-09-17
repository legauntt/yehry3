"""Shared, conservative recognition of standalone lyric section headings."""
import re


NAMES = {name.casefold(): name for name in (
    'Verse', 'Chorus', 'Bridge', 'Intro', 'Outro', 'Pre-Chorus', 'Post-Chorus',
    'Refrain', 'Hook', 'Instrumental', 'Spoken Intro', 'Spoken Verse', 'Breakdown',
    'Solo', 'Interlude', 'Movement', 'Section', 'Tag', 'Coda', 'End',
)}
ALIASES = {
    'turn': 'Bridge', 'final chorus': 'Chorus', 'last chorus': 'Chorus',
    'chorus reprise': 'Chorus', 'final verse': 'Verse', 'last verse': 'Verse',
    'final refrain': 'Refrain', 'final hook': 'Hook', 'final tag': 'Tag',
    'pre chorus': 'Pre-Chorus', 'prechorus': 'Pre-Chorus',
    'post chorus': 'Post-Chorus', 'postchorus': 'Post-Chorus',
}
# Compatibility for callers that already normalize before matching.
SECTION = re.compile(r'^\[(?:' + '|'.join(re.escape(name) for name in NAMES) + r')(?:\s+\d+)?\]$', re.I)

STRUCTURE_GUIDANCE = """Song form follows the brief. A chorus or recurring refrain is optional.
Honor requests for no chorus, verse-only songs, or continuous development without repeated sections.
These explicit form requests take priority over default preferences and writing-workflow presets.
Section headings are optional structural cues, never sung words; no verse or chorus heading is required.
Use standalone labels such as [Verse 1], [Section 1], [Bridge], [Interlude] or [Outro] when helpful.
Keep delivery directions in the arrangement. Preserve the supplied order and do not invent repeats.
"""


def section_label(line):
    """Return a canonical heading, or None for literal/unknown/inline text."""
    match = re.fullmatch(r'\s*\[([^\[\]\r\n]+)\]\s*', line)
    if not match:
        return None
    name = ' '.join(match[1].split()).casefold()
    name = re.sub('[‐‑–−]', '-', name)
    name = re.sub(r'\s*-\s*', '-', name)
    match = re.fullmatch(r'(.+?)(?: (\d+))?', name)
    if not match:
        return None
    base, number = match.groups()
    canonical = ALIASES.get(base) or NAMES.get(base)
    if canonical is None:
        return None
    return '[' + canonical + (' ' + number if number else '') + ']'


def normalize_section_labels(text):
    """Normalize known headings only, preserving every other character and line ending."""
    lines = []
    for line in text.splitlines(keepends=True):
        content = line.rstrip('\r\n\v\f\x1c\x1d\x1e\x85\u2028\u2029')
        label = section_label(content)
        lines.append(label + line[len(content):] if label else line)
    return ''.join(lines)


def sung_lines(text):
    """Unknown brackets and inline labels remain literal lyric content."""
    return [line for line in text.splitlines() if section_label(line) is None]


def composition_caption(text):
    """Remove legacy default form assumptions only when freezing a fresh composition.

    Keep the legacy request/spec text intact: the engine uses it to verify resume
    fingerprints. Its actual caption can use neutral cues before audio starts.
    """
    replacements = {
        'Strongly sung rock melodies, sustained notes and clear verse-to-chorus contrast. ':
            'Strongly sung rock melodies, sustained notes and clear section contrasts. ',
        'Connected melodic acoustic roots singing with intimate verses and ringing choruses. ':
            'Connected melodic acoustic roots singing with intimate and ringing phrases. ',
        'Pace the supplied verses and final chorus across the whole song to reach that window. ':
            'Pace the supplied sections across the whole song to reach that window. ',
        'Spread the final verse and chorus later, sustain the final lyric in the requested ending window, ':
            'Spread the closing sections later, sustain the final lyric in the requested ending window, ',
        'Finish every supplied lyric, including the whole final verse, ':
            'Finish every supplied lyric, including the whole final section, ',
        'Begin the first supplied verse within eight seconds. ':
            'Begin the first supplied vocal line within eight seconds. ',
        'distributing the verses and choruses across the ':
            'distributing the supplied sections across the ',
        'instrumental solos or empty verses. ':
            'instrumental solos or empty vocal sections. ',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text + (' Follow the written section order. A chorus or refrain is optional; '
                   'do not add repeated sections absent from the lyrics. ')
