"""Publish saved lyric text without another model call or audio render."""
from pathlib import Path
from common import inside, load
from lyric_timing import make_cues, make_suite_cues


def make_sheet(config, plan, result):
    text = ''; kind = 'written'
    if result.get('work_path'):
        work = inside(result['work_path'], Path(config['settings']['studio_dir']).parent)
        spec_file = work / 'spec.json'
        spec = load(spec_file) if spec_file.exists() else {}
        if spec.get('kind') == 'new': text = spec.get('lyrics', '')
        else:
            # Faithful remakes retain source lyrics. These are existing local ASR drafts.
            for name in ['original-transcripts.json', 'matched-vocals-words.json', 'selected-vocals-words.json']:
                file = work / name
                if not file.exists(): continue
                data = load(file)
                segments = data.get('segments', []) if isinstance(data, dict) else data
                text = '\n'.join(row.get('text', '').strip() for row in segments)
                if text.strip():
                    kind = 'transcribed'; break
    elif plan['recipe'] in ['new', 'reinterpretation']:
        text = plan['lyrics']
    text = '\n'.join(line.rstrip() for line in text.replace('\r\n', '\n').split('\n') if line.strip() != '[End]').strip()
    if not 1 <= len(text.encode('utf-16-le')) // 2 <= 32000: raise ValueError('A saved lyrics sheet is required before publication; inspect the completed job.')
    sheet = {'text': text, 'kind': kind}
    if result.get('work_path'):
        journal_file = work / 'suite-job.json'
        if journal_file.exists():
            journal = load(journal_file)
            rows = [part.get('result', {}) for part in journal.get('parts', [])]
            if not rows or any(row.get('status') != 'verified' for row in rows):
                raise ValueError('A complete verified suite is required before lyric cues')
            root = Path(config['settings']['studio_dir']).parent
            parts = [(inside(row['work_path'], root), row['duration']) for row in rows]
            cues = make_suite_cues(parts, text, result.get('duration'))
        else:
            cues = make_cues(work, text, result.get('duration'))
        if cues: sheet['cues'] = cues
    return sheet


def export_sheet(config, mp3, title, sheet):
    destination = inside(Path(config['settings']['output_dir']) / 'lyrics' / (Path(mp3).stem + '.txt'), config['settings']['output_dir'])
    destination.parent.mkdir(parents=True, exist_ok=True)
    note = 'Lyrics supplied for this recording.' if sheet['kind'] == 'written' else 'Source transcription; some words may be inaccurate.'
    content = f"{title}\n{note}\n\n{sheet['text']}\n"
    if destination.exists() and destination.read_text('utf-8-sig') != content:
        raise ValueError('An existing lyrics export differs; refusing to overwrite it.')
    if not destination.exists(): destination.write_text(content, encoding='utf-8')
    return destination
