"""Windows Job Objects stop only this worker's process tree on cancel or crash."""
import ctypes, os, subprocess, time
from ctypes import wintypes
from pathlib import Path

class Stopped(Exception): pass

class Job:
    def __init__(self, process):
        if os.name != 'nt': raise RuntimeError('This production worker requires Windows')
        class Basic(ctypes.Structure):
            _fields_ = [('user', ctypes.c_int64), ('job', ctypes.c_int64), ('flags', wintypes.DWORD),
                        ('minimum', ctypes.c_size_t), ('maximum', ctypes.c_size_t), ('active', wintypes.DWORD),
                        ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD), ('scheduling', wintypes.DWORD)]
        class IO(ctypes.Structure): _fields_ = [(name, ctypes.c_uint64) for name in ['readOps','writeOps','otherOps','readBytes','writeBytes','otherBytes']]
        class Limits(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', IO), ('processMemory', ctypes.c_size_t), ('jobMemory', ctypes.c_size_t), ('peakProcess', ctypes.c_size_t), ('peakJob', ctypes.c_size_t)]
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]; self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        limits = Limits(); limits.basic.flags = 0x2000 # KILL_ON_JOB_CLOSE
        if not self.handle or not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not self.kernel.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(process._handle))):
            self.close(); raise ctypes.WinError(ctypes.get_last_error())
    def stop(self):
        if self.handle: self.kernel.TerminateJobObject(self.handle, 1)
    def close(self):
        if getattr(self, 'handle', None): self.kernel.CloseHandle(self.handle); self.handle = None

def child_env():
    # The API token is only used by the trusted parent. Renderers/planners never receive it.
    return {key: value for key, value in os.environ.items() if key not in {'DISTONYC_WORKER_TOKEN', 'DISTONYC_MONITOR_PASSWORD', 'OPENAI_API_KEY', 'CODEX_API_KEY'} and not key.startswith('CODEX_')}

def run_owned(command, cwd, log, stop=None, timeout=86400, gate=None, input_text=None):
    log = Path(log); log.parent.mkdir(parents=True, exist_ok=True)
    if gate: Path(gate).unlink(missing_ok=True)
    with log.open('a', encoding='utf-8') as output:
        process = subprocess.Popen([str(item) for item in command], cwd=cwd, env=child_env(),
            stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
            text=True, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS)
        job = None
        try:
            job = Job(process)
            if gate: Path(gate).write_text('start', encoding='ascii')
            if input_text is not None:
                process.stdin.write(input_text); process.stdin.close()
            start = time.monotonic()
            while process.poll() is None:
                if stop and stop(): raise Stopped('Cancellation or lease loss; owned processes stopped.')
                if time.monotonic() - start > timeout: raise TimeoutError('The operation exceeded its time limit; saved work is retained.')
                time.sleep(.25)
            if process.returncode: raise RuntimeError(f'Operation failed (exit {process.returncode}); see {log.name}.')
        finally:
            if job: job.stop(); job.close()
            elif process.poll() is None: process.kill()
            process.wait(timeout=20)
            if gate: Path(gate).unlink(missing_ok=True)
