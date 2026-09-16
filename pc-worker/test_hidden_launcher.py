"""Exercise the real windowless host, native descendants and scheduler exit status."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

import launch_hidden


@unittest.skipUnless(os.name == 'nt', 'Windows scheduled task launcher')
class HiddenLauncherTests(unittest.TestCase):
    def test_pythonw_hides_native_descendants_waits_and_preserves_exit_code(self):
        pythonw = Path(sys.executable).with_name('pythonw.exe')
        for task, script in [('worker', 'run.ps1'), ('monitor', 'monitor-run.ps1')]:
            with self.subTest(task=task), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve() / 'quiet launch é'
                root.mkdir()
                shutil.copyfile(launch_hidden.__file__, root / 'launch_hidden.py')
                (root / 'probe.py').write_text('''import ctypes, json, subprocess, sys
from pathlib import Path
kernel = ctypes.WinDLL('kernel32')
kernel.GetConsoleWindow.restype = ctypes.c_void_p
user = ctypes.WinDLL('user32')
user.IsWindowVisible.argtypes = [ctypes.c_void_p]
window = kernel.GetConsoleWindow()
Path(sys.argv[1] + '.json').write_text(json.dumps({
    'console': window, 'visible': bool(user.IsWindowVisible(window)),
    'cwd': str(Path.cwd()),
}), encoding='utf-8')
if sys.argv[1] == 'child':
    subprocess.run([sys.executable, __file__, 'grandchild'], check=True)
print('native output retained')
''', encoding='utf-8')
                executable = str(Path(sys.executable)).replace("'", "''")
                (root / script).write_text(
                    "$ErrorActionPreference = 'Stop'\n"
                    f"& '{executable}' (Join-Path $PSScriptRoot 'probe.py') child\n"
                    "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n"
                    "Set-Content -LiteralPath (Join-Path $PSScriptRoot 'started') -Value 'ready'\n"
                    "while (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'release'))) { Start-Sleep -Milliseconds 20 }\n"
                    "Write-Output 'script output retained'\nexit 23\n", encoding='utf-8')
                with subprocess.Popen([str(pythonw), str(root / 'launch_hidden.py'), '--task', task]) as process:
                    try:
                        deadline = time.monotonic() + 20
                        while not (root / 'started').exists() and process.poll() is None and time.monotonic() < deadline:
                            time.sleep(.05)
                        self.assertTrue((root / 'started').exists(), 'PowerShell did not reach its wait gate')
                        self.assertIsNone(process.poll(), 'Launcher exited before the script completed')
                        for name in ('child', 'grandchild'):
                            probe = json.loads((root / (name + '.json')).read_text(encoding='utf-8'))
                            self.assertTrue(probe['console'], 'Native children should inherit the hidden console')
                            self.assertFalse(probe['visible'], 'A native child exposed its console')
                            self.assertEqual(Path(probe['cwd']), root)
                    finally:
                        (root / 'release').touch()
                    self.assertEqual(process.wait(timeout=20), 23)
                log = (root / 'state' / (task + '-launcher.log')).read_bytes()
                self.assertIn(b'native output retained', log)
                self.assertIn(b'script output retained', log)

    def test_startup_failure_is_logged_and_returns_failure(self):
        with tempfile.TemporaryDirectory() as root:
            original = os.environ['SystemRoot']
            try:
                os.environ['SystemRoot'] = str(Path(root) / 'missing-windows')
                self.assertEqual(launch_hidden.run('worker', root), 1)
            finally:
                os.environ['SystemRoot'] = original
            self.assertIn('FileNotFoundError', (Path(root) / 'state/worker-launcher.log').read_text())


if __name__ == '__main__':
    unittest.main()
