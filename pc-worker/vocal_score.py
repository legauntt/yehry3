"""Explicit wordless scores use vocal sounds, not a requirement for lexical lyrics."""
import re

from lyric_sections import section_label

PLANNING_GUIDANCE = '''
NONVERBAL VOCALS ARE SUPPORTED by the new-composition recipe, including Eleven Music.
Set vocal_mode=nonverbal only when the brief requests an entirely wordless performance,
gibberish/jibberish, or vocal sounds without real words. Otherwise use vocal_mode=lyrics;
non-English lyrics in a real language are still lyrics, not automatically nonverbal.
For nonverbal mode, lyrics is a complete phonetic vocal score: use standard section
headings and only invented syllables, humming and vowel/consonant sounds on performed
lines. Put instructions for breaths, grunts, laughter, slurring and spoken-like delivery
in arrangement, never as words to perform. Do not add English words or translate the
sounds into another language. Keep the voice present and varied across the full requested
duration. End the score with [End]. A resolved final vocal gesture is a complete ending;
it does not need a meaningful word, story, catchable lyric, or minimum word rate.
This explicit request overrides default meaningful-lyric, melodic-singing, word-count,
short-ad-lib and no-gibberish preferences. Never select needs_attention solely because
the requested vocal material has no words. Retain the selected voice, backend and length.
Match the requested musical energy: wordless does not mean a slow drone or a repeated chant.
For scat or a voice-as-saxophone request, write pitched melodic improvisation with varied
syllables, syncopated attacks, flowing runs, register changes and call-and-response.
Develop distinct sections and evolving motifs across the full duration; do not stretch
a handful of repeated syllables into a long performance. Breaths and grunts are optional
expressive gestures, not a substitute for melodic scat when the brief asks for it.
'''

NONVERBAL_DELIVERY = (
    'Entirely nonverbal solo male vocal performance: only the written invented phonetic '
    'sounds, humming, breaths, grunts and laughter as directed by the arrangement. '
    'Slurred, incomprehensible, spoken-like vocal gestures when requested. '
    'No English or other real-language words, no intelligible lyrics or narration. '
    'Complete the final vocal gesture naturally and let the final sound decay. '
)


def ending_guidance(mode='lyrics'):
    if mode == 'nonverbal': return NONVERBAL_DELIVERY
    return ('Complete the written final section; keep closing words meaningful. '
            'Unless explicitly requested in the arrangement, do not fill the ending '
            'with screamed syllables or a repeated earlier verse. ')


def normalize_sections(score, arrangement):
    """Keep fresh wordless section directions out of performed phonetic lines."""
    if not isinstance(score, str) or not isinstance(arrangement, str):
        return score, arrangement
    used = {section_label(line) for line in score.splitlines()}
    lines, directions, number = [], [], 1
    for line in score.splitlines():
        heading = re.fullmatch(r'\s*\[([^\[\]\r\n]+)\]\s*', line)
        if heading and section_label(line) is None:
            while f'[Section {number}]' in used: number += 1
            label = f'[Section {number}]'
            used.add(label)
            directions.append(f'{label}: {heading[1].strip()}')
            lines.append(label)
        else:
            lines.append(line)
    if not directions: return score, arrangement
    arrangement += '\nWordless section directions (not sung): ' + '; '.join(directions) + '.'
    if len(arrangement) > 5000:
        raise ValueError('Wordless section directions exceed the arrangement limit; shorten the arrangement.')
    return '\n'.join(lines), arrangement


def composition_styles(plan, chunks):
    """Replace lexical delivery defaults only for an explicitly planned wordless score."""
    if plan.get('vocal_mode') != 'nonverbal': return
    for chunk in chunks:
        # Preserve the arrangement, timing/key and per-section instrumental cues.
        chunk['positive_styles'] = [plan['arrangement'], NONVERBAL_DELIVERY,
            f"{plan['bpm']} BPM, {plan['keyscale']}"] + chunk['positive_styles'][4:]
        chunk['negative_styles'] = list(chunk['negative_styles']) + [
            'English words', 'intelligible real-language lyrics', 'spoken narration']
