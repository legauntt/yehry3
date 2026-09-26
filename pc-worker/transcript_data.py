"""Allowlisted public transcript contract shared by batch and scheduled publication."""
import math
import re
from transcript_sources import released_address


def public_transcript(value, song):
    released_address(song)
    if not isinstance(value, dict):
        raise ValueError('Invalid transcript document')
    if value.get('version') != 1 or value.get('songId') != song['id'] or value.get('audioUrl') != song['url']:
        raise ValueError('Transcript belongs to another recording')
    for field in ('audioSha256', 'inputSha256'):
        if not re.fullmatch(r'[a-f0-9]{64}', value.get(field, '')):
            raise ValueError('Invalid transcript audio identity')
    pin = re.search(r'-([a-f0-9]{12,64})\.mp3$', song['url'])
    if pin and not value['audioSha256'].startswith(pin[1]):
        raise ValueError('Transcript differs from the pinned recording')
    if value.get('input') not in ('converted-tony-vocals', 'released-recording') or value.get('review') != 'machine':
        raise ValueError('Invalid transcription attribution')
    if value['input'] == 'released-recording' and value['inputSha256'] != value['audioSha256']:
        raise ValueError('Released audio input must match the recorded hash')
    if not re.fullmatch(r'faster-whisper [a-zA-Z0-9_.-]+', value.get('model', '')):
        raise ValueError('Unrecognized transcription model')
    duration = value.get('duration')
    if type(duration) not in (int, float) or not math.isfinite(duration) or duration <= 0 or abs(duration - song['duration']) > 2:
        raise ValueError('Transcript duration differs from the recording')
    rows = value.get('segments')
    empty = value.get('outcome') == 'no-words-recognized'
    if not isinstance(rows, list) or len(rows) > 2000 or (not rows and not empty) or (rows and empty):
        raise ValueError('Invalid transcript outcome')
    segments, previous = [], 0
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Invalid transcript segment')
        start, end, text = row.get('start'), row.get('end'), row.get('text')
        if not all(isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n) for n in (start, end)) or not previous <= start < end <= duration + .01:
            raise ValueError('Invalid transcript timing')
        if not isinstance(text, str) or not text.strip() or len(text) > 2000 or '\n' in text or '\r' in text or not isinstance(row.get('uncertain'), bool):
            raise ValueError('Invalid transcript text')
        segments.append({key: row[key] for key in ('start', 'end', 'text', 'uncertain')})
        previous = end
    fields = ('version', 'songId', 'audioUrl', 'audioSha256', 'inputSha256', 'input', 'model', 'review', 'duration')
    return {**{key: value[key] for key in fields}, 'segments': segments,
            **({'outcome': 'no-words-recognized'} if empty else {})}
