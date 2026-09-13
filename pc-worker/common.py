"""Local durable state and narrow HTTPS API client; no Mongo credentials on the PC."""
import contextlib, hashlib, json, os, tempfile, time, urllib.error, urllib.request
from pathlib import Path

def load(path): return json.loads(Path(path).read_text('utf-8-sig'))
def save(path, data):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    # A heartbeat/log viewer can briefly hold the destination without delete
    # sharing on Windows. Unique files also prevent concurrent writers from
    # truncating or renaming each other's pending JSON.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                prefix=path.name + '.', suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.flush(); os.fsync(handle.fileno())
        deadline = time.monotonic() + 3
        delay = .02
        while True:
            try:
                temporary.replace(path)
                return
            except OSError as error:
                if getattr(error, 'winerror', None) not in (5, 32, 33) or time.monotonic() >= deadline:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, .2)
    finally:
        if temporary is not None:
            try: temporary.unlink(missing_ok=True)
            except OSError: pass
def sha(path):
    with Path(path).open('rb') as handle: return hashlib.file_digest(handle, 'sha256').hexdigest()
def fingerprint(data): return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
def utc(): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
def inside(path, root):
    path, root = Path(path).resolve(), Path(root).resolve()
    if not path.is_relative_to(root): raise ValueError('Path is outside the configured directory')
    return path

class APIError(Exception):
    def __init__(self, status, message): super().__init__(message); self.status = status

class API:
    def __init__(self, base, worker_id, token):
        if not base.startswith('https://') and not base.startswith('http://127.0.0.1:'): raise ValueError('HTTPS API required')
        self.base, self.worker_id, self.token = base.rstrip('/'), worker_id, token
    def call(self, path, body=None, timeout=25):
        request = urllib.request.Request(self.base + '/worker' + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': 'Bearer ' + self.token, 'X-Worker-ID': self.worker_id, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response: return json.load(response)
        except urllib.error.HTTPError as error:
            try: message = json.load(error).get('error', 'API request failed')
            except (ValueError, AttributeError): message = 'API request failed'
            raise APIError(error.code, message) from None

@contextlib.contextmanager
def singleton(path):
    import msvcrt
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as handle:
        handle.seek(0)
        if not handle.read(1): handle.write(b'0'); handle.flush()
        handle.seek(0)
        try: msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError: yield False; return
        try: yield True
        finally: handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
