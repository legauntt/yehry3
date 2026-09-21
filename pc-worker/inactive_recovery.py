"""Recover an assembly stopped by a silent voice section in the same attempt that hit it.

The audited repair (`inactive_voice_repair.py`) replaces genuinely silent sections with pinned silence and reassembles
from the saved conversions. It used to run only when a failed request was retried, so a first-attempt failure fell
straight through to the needs-review export and published the generated singer instead of Tony.
"""
import subprocess
from pathlib import Path

from common import load

ASSEMBLER_ASSERTION = 'assert active.any()'


def needed(work, voice_model):
    """The saved journal shows the assembler rejecting a silent phrase of a voice-model job."""
    if voice_model == 'v6': return False
    path = Path(work) / 'desktop-status.json'
    if not path.is_file(): return False
    state = load(path)
    return (state.get('status') == 'failed' and state.get('stage') == 'assemble'
            and ASSEMBLER_ASSERTION in (state.get('error') or ''))


def recover(work, settings):
    """Run the bounded repair once; False leaves the journal for the ordinary review classification."""
    work = Path(work)
    with (work / 'inactive-voice-repair.log').open('a', encoding='utf-8') as log:
        result = subprocess.run([settings['voice_python'], str(Path(__file__).with_name('inactive_voice_repair.py')),
                                 '--work', str(work)], cwd=work, stdout=log, stderr=subprocess.STDOUT,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    return result.returncode == 0
