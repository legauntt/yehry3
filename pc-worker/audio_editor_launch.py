"""Windowless entry point for the independent audio editor service."""
import os
from pathlib import Path
import subprocess
from winprocess import Job

root = Path(__file__).resolve().parent
startup = subprocess.STARTUPINFO()
startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
startup.wShowWindow = subprocess.SW_HIDE
with (root / 'launcher.log').open('a', encoding='utf-8') as output:
    with subprocess.Popen([str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'),
                           '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-WindowStyle', 'Hidden',
                           '-File', str(root / 'audio-editor-run.ps1')], cwd=root, stdin=subprocess.DEVNULL,
                          stdout=output, stderr=subprocess.STDOUT, startupinfo=startup,
                          creationflags=subprocess.CREATE_NEW_CONSOLE) as process:
        owned = Job(process)
        try:
            code = process.wait()
        finally:
            owned.stop(); owned.close()
        raise SystemExit(code)
