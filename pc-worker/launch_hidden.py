"""Run scheduled entry points with pythonw so PowerShell cannot flash at startup."""
import argparse
import os
from pathlib import Path
import subprocess
import traceback


def run(task, root):
    root = Path(root).resolve()
    script = {'worker': 'run.ps1', 'monitor': 'monitor-run.ps1',
              'budget': 'paid-budget-reconcile.ps1', 'lyrics': 'lyric-writer-run.ps1'}[task]
    log = root / 'state' / (task + '-launcher.log')
    log.parent.mkdir(parents=True, exist_ok=True)
    if log.exists() and log.stat().st_size > 1024 * 1024:
        log.replace(log.with_suffix('.log.previous'))
    with log.open('a', encoding='utf-8') as output:
        try:
            powershell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = subprocess.SW_HIDE
            # Hide the console at creation, before PowerShell parses its arguments.
            # Keeping a hidden console also lets native children inherit it.
            with subprocess.Popen([
                str(powershell), '-NoProfile', '-NonInteractive', '-ExecutionPolicy',
                'RemoteSigned', '-WindowStyle', 'Hidden', '-File', str(root / script),
            ], cwd=root, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                startupinfo=startup, creationflags=subprocess.CREATE_NEW_CONSOLE) as process:
                # Stay alive so Task Scheduler retains IgnoreNew, timeouts and retries.
                return process.wait()
        except Exception:
            traceback.print_exc(file=output)
            return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--task', required=True, choices=('worker', 'monitor', 'budget', 'lyrics'))
    raise SystemExit(run(parser.parse_args().task, Path(__file__).parent))
