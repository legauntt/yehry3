"""Audit saved performance evidence; apply reviewed cue-only repairs with revision checks.

Reports contain local production paths and stay outside the public repository/build.
ASR agreement is evidence, not a listening review or permission to rewrite words.
"""
import argparse
import copy
import json
import hashlib
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import Counter
from pathlib import Path

from backfill_lyric_cues import OVERRIDES, candidate, choose, published_hash, sync_cues
from common import load, save, utc, sha
from lyric_timing import cue_diagnostics, cue_report, normalize_words


def audit_song(song, candidates, identities=None):
    row = {'id': song['id'], 'title': song['title'], 'url': song['url'],
           'duration': song['duration'], 'before': copy.deepcopy(song['lyrics'])}
    digest = published_hash(song) or (identities or {}).get(song['url'], {}).get('sha256', '')
    # Never substitute another render merely because the title/lyrics match.
    exact = [item for item in candidates if item.get('song_id', song['id']) == song['id'] and
             digest and any(value.startswith(digest) for value in item['hashes'])]
    if digest and not exact:
        return {**row, 'status': 'unverified', 'reason': 'No retained production with the published audio hash'}
    if not digest and song['id'] not in OVERRIDES:
        return {**row, 'status': 'unverified', 'reason': 'Legacy URL needs an independently verified audio identity'}
    if len(exact) == 1:
        item, reason = exact[0], f'published audio sha256={digest}'
    else:
        item, reason = choose(song, exact if digest else candidates, digest)
    if not item:
        return {**row, 'status': 'unverified', 'reason': reason}
    report = cue_report(item['directory'], song['lyrics']['text'], song['duration'])
    if not report:
        return {**row, 'status': 'unverified', 'reason': 'No retained word timestamps'}
    text = song['lyrics']['text']
    old_cues = song['lyrics'].get('cues', [])
    old_rejected = cue_diagnostics(old_cues, text, report['words'], song['duration'])
    rejected_lines = {cue['line'] for cue in old_rejected}
    old_supported = [cue for cue in old_cues if cue['line'] not in rejected_lines]
    lines = text.splitlines()
    support = lambda cues: sum(len(normalize_words(lines[cue['line']])) for cue in cues)
    # Keep the existing timeline when its supported coverage is as good. A new
    # machine transcript is not a reason to churn already corroborated timing.
    cues = old_supported if support(old_supported) >= support(report['cues']) else report['cues']
    after = {**song['lyrics'], 'cues': cues}
    last_end = max((cue['end'] for cue in cues), default=0)
    extra = [word for word in report['words'] if word['start'] > last_end + 1]
    singable = sum(bool(line.strip()) and not (line.strip().startswith('[') and line.strip().endswith(']'))
                   for line in text.splitlines())
    return {**row, 'status': 'audited', 'production': str(item['directory']), 'identity': reason,
            'source': report['source'], 'ordered_word_recall': round(report['recall'], 3),
            'agreement_score': round(report['score'], 3), 'singable_lines': singable,
            'old_cues': len(old_cues), 'supported_cues': len(cues),
            'old_rejected': old_rejected, 'new_rejected': report['rejected'],
            'trailing_transcript': ' '.join(word['token'] for word in extra),
            'trailing_words': len(extra), 'after': after,
            'changed': old_cues != cues,
            'needs_listening': report['recall'] < .8 or len(cues) < singable * .8 or len(extra) >= 8}


def apply_report(catalog, report):
    """Validate the complete batch before mutating, allowing an idempotent retry."""
    songs = {song['id']: song for song in catalog['songs']}
    changes = []
    for row in report['songs']:
        if not row.get('changed'): continue
        song = songs.get(row['id'])
        if not song or song['url'] != row['url'] or song['duration'] != row['duration']:
            raise ValueError(f"Published recording changed: {row['id']}")
        if song['lyrics'] not in (row['before'], row['after']):
            raise ValueError(f"Published lyrics/cues changed: {row['id']}")
        if {k: v for k, v in row['before'].items() if k != 'cues'} != {k: v for k, v in row['after'].items() if k != 'cues'}:
            raise ValueError('An audit repair may only change cues')
        changes.append((song, row['after']))
    for song, lyrics in changes: song['lyrics'] = copy.deepcopy(lyrics)
    return [song for song, _ in changes]


def fetch_identity(url):
    address = 'https://yehry3.app' + url if url.startswith('/') else url
    if not address.startswith(('https://github.com/legauntt/', 'https://yehry3.app/')):
        raise ValueError('Only existing public song hosts may be audited')
    digest, size = hashlib.sha256(), 0
    with urllib.request.urlopen(address, timeout=40) as response:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > 128 * 1024 * 1024: raise ValueError('Unexpectedly large recording')
            digest.update(chunk)
    return {'sha256': digest.hexdigest(), 'bytes': size, 'verified_at': utc()}


def verify_report(base, report, static=False):
    def verify(row):
        url = base.rstrip('/') + '/songs/' + row['id'] + ('.json' if static else '')
        with urllib.request.urlopen(url, timeout=30) as response: data = json.load(response)
        song = data.get('song', data)
        if song.get('url') != row['url'] or song.get('duration') != row['duration'] or song.get('lyrics') != row['after']:
            raise ValueError(f"Published lyric repair differs: {row['id']}")
    rows = [row for row in report['songs'] if row.get('changed')]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(verify, rows))
    return len(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', required=True, type=Path)
    parser.add_argument('--studio-root', type=Path)
    parser.add_argument('--report', type=Path)
    parser.add_argument('--song', action='append')
    parser.add_argument('--apply', type=Path, help='Apply this reviewed report instead of auditing')
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--sync-config', type=Path)
    parser.add_argument('--identities', type=Path, help='Retained SHA-256 evidence for legacy public URLs')
    parser.add_argument('--fetch-identities', action='store_true', help='Stream and hash legacy public MP3s; never modify audio')
    parser.add_argument('--evidence-cache', type=Path, help='Verified transcripts recreated by restore_lyric_evidence.py')
    parser.add_argument('--verify-base', help='Read back every changed song from this API/site; requires --apply and never writes')
    parser.add_argument('--static', action='store_true', help='Verify static /songs/<id>.json instead of API /songs/<id>')
    args = parser.parse_args()
    catalog = load(args.catalog)
    if args.apply:
        report = load(args.apply)
        if args.verify_base:
            if args.write or args.sync_config: parser.error('Verification cannot write or sync')
            print(json.dumps({'verified': verify_report(args.verify_base, report, args.static)})); return
        rows = apply_report(catalog, report)
        if args.sync_config: sync_cues(args.sync_config, rows)
        if args.write: save(args.catalog, catalog)
        print(json.dumps({'repairs': len(rows), 'written': args.write, 'synced': bool(args.sync_config)}))
        return
    if args.write or args.sync_config: parser.error('--write/--sync-config require a reviewed --apply report')
    if not args.studio_root or not args.report: parser.error('audit requires --studio-root and --report')
    identities = load(args.identities) if args.identities and args.identities.exists() else {}
    if args.fetch_identities:
        if not args.identities: parser.error('--fetch-identities requires --identities')
        urls = {song['url'] for song in catalog['songs'] if not published_hash(song) and song['url'] not in identities}
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(fetch_identity, url): url for url in sorted(urls)}
            for future in as_completed(futures):
                url = futures[future]
                try:
                    identities[url] = future.result()
                    save(args.identities, identities)
                    print(f'HASHED {url}', flush=True)
                except Exception as error: print(f'HASH FAILED {url}: {type(error).__name__}', flush=True)
    candidates = [item for item in (candidate(path) for path in sorted(args.studio_root.glob('troofs-*')) if path.is_dir()) if item]
    if args.evidence_cache:
        from backfill_lyric_cues import key, transcript
        for path in sorted(args.evidence_cache.glob('*/evidence.json')):
            evidence = load(path)
            words = path.parent / 'matched-vocals-words.json'
            if sha(words) != evidence['words_sha256']: raise ValueError('Audit transcript changed')
            candidates.append({'directory': path.parent, 'title': evidence['title'], 'song_id': evidence['id'],
                               'keys': [key(transcript(words))], 'hashes': {evidence['audio_sha256']}})
    selected = set(args.song or [])
    if selected - {song['id'] for song in catalog['songs']}: parser.error('Unknown song ID')
    rows = []
    for song in catalog['songs']:
        if not song.get('lyrics') or selected and song['id'] not in selected: continue
        row = audit_song(song, candidates, identities)
        rows.append(row)
        print(f"{row['status'].upper()} {song['id']}: {song['title']} "
              f"{row.get('old_cues', '?')} -> {row.get('supported_cues', '?')} supported lines; "
              f"recall={row.get('ordered_word_recall', '?')}", flush=True)
    summary = dict(Counter(row['status'] for row in rows))
    summary.update(changed=sum(row.get('changed', False) for row in rows),
                   needs_listening=sum(row.get('needs_listening', False) for row in rows),
                   old_unsupported_songs=sum(bool(row.get('old_rejected')) for row in rows),
                   cleared=sum(row.get('changed', False) and not row['after']['cues'] for row in rows))
    save(args.report, {'version': 1, 'at': utc(), 'automatic_transcript': True, 'listening_review': False,
                       'summary': summary, 'songs': rows})
    notes = ['# Lyric timing audit', '',
             'Automatic comparison with saved or recreated vocal transcripts. This is not a listening review.',
             'The local speech model is English-only; low agreement can reflect singing, other languages, phonetics, or recognition errors.',
             'Written lyric text and recordings are preserved. Only supported cue corrections are proposed.', '',
             'Summary: ' + json.dumps(summary), '',
             '| Song | Supported lines (before → after) | Ordered word agreement | Listening follow-up |',
             '| --- | --- | --- | --- |']
    for row in rows:
        title = row['title'].replace('|', '\\|')
        if row['status'] == 'audited':
            notes.append(f"| {title} | {row['old_cues']} → {row['supported_cues']} | {row['ordered_word_recall']:.1%} | {'Yes' if row['needs_listening'] else ''} |")
        else: notes.append(f"| {title} | Unverified | — | {row['reason']} |")
    args.report.with_suffix('.md').write_text('\n'.join(notes) + '\n', encoding='utf-8')
    print(json.dumps(summary))


if __name__ == '__main__': main()
