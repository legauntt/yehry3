"""Durable Eleven Music requests; no automatic billable retries."""
import argparse
import contextlib
import ctypes
import json
import math
import os
import re
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
import uuid

from common import fingerprint, load, save, sha, singleton, utc

MODEL = 'music_v2_5'
ENDPOINT = 'https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192'
MAX_CAP_CENTS = 20000
RATE_CENTS = 100
MAX_BYTES = 32 * 1024 * 1024
MAX_ERROR_BYTES = 65536


def policy(path):
    value = load(path)
    cap = value.get('cap_cents')
    if (value.get('version') != 1 or type(cap) is not int or not 0 < cap <= MAX_CAP_CENTS
            or not all(isinstance(value.get(k), str) and Path(value[k]).is_absolute()
                       for k in ('ledger', 'credential'))):
        raise ValueError('Invalid paid music policy; configure a total cap within $200')
    return value


def validate_ledger(ledger):
    if ledger.get('version') != 1 or not isinstance(ledger.get('requests'), list):
        raise ValueError('Restore the paid music spending ledger before generation')
    ids = set()
    for row in ledger['requests']:
        if (not isinstance(row.get('id'), str) or row['id'] in ids or
                type(row.get('reserved_cents')) is not int or row['reserved_cents'] <= 0):
            raise ValueError('The paid music ledger is invalid')
        retry = row.get('operator_retry')
        if retry is not None and (not isinstance(retry, dict) or retry.get('version') != 1
                or type(retry.get('reserved_cents')) is not int or retry['reserved_cents'] != row['reserved_cents']
                or retry.get('status') not in ('authorized', 'consumed')
                or retry.get('request_hash') != row.get('request_hash')):
            raise ValueError('The paid music operator retry record is invalid')
        ids.add(row['id'])


@contextlib.contextmanager
def budget_lock(path):
    import msvcrt
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as stream:
        stream.seek(0)
        # Locking beyond EOF is supported on Windows; do not read a byte locked by another process.
        try: msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError: yield False; return
        try: yield True
        finally: stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)


def get_key(path):
    # Current-user DPAPI; neither environment variables nor browser data carry the key.
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    data = Path(path).read_bytes()
    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt.CryptUnprotectData.restype = wintypes.BOOL
    crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise RuntimeError('This Windows account cannot unlock the saved ElevenLabs credential')
    try: return ctypes.string_at(target.data, target.size).decode('utf-8')
    finally: kernel.LocalFree(target.data)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def send(body, key):
    request = urllib.request.Request(ENDPOINT, data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
        method='POST', headers={'xi-api-key': key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'})
    # A provider redirect must never forward the credential to another destination.
    with urllib.request.build_opener(NoRedirect).open(request, timeout=600) as response:
        data = response.read(MAX_BYTES + 1)
        if not 100000 <= len(data) <= MAX_BYTES or not response.headers.get('Content-Type', '').startswith('audio/'):
            raise ValueError('Eleven Music did not return a complete audio file')
        return data, {k: response.headers[k] for k in ('song-id', 'request-id', 'x-request-id') if response.headers.get(k)}


def request_duration(body):
    if set(body) != {'model_id', 'composition_plan', 'seed'} or body['model_id'] != MODEL:
        raise ValueError('Unsupported paid music request')
    if type(body['seed']) is not int or not 0 <= body['seed'] <= 2147483647:
        raise ValueError('Invalid paid music seed')
    chunks = body['composition_plan'].get('chunks', [])
    if set(body['composition_plan']) != {'chunks'} or not 1 <= len(chunks) <= 30:
        raise ValueError('Invalid paid composition plan')
    for chunk in chunks:
        if (set(chunk) - {'text', 'duration_ms', 'positive_styles', 'negative_styles'} or
                type(chunk.get('duration_ms')) is not int or not 3000 <= chunk['duration_ms'] <= 120000 or
                not isinstance(chunk.get('text'), str) or not chunk['text'].strip()):
            raise ValueError('Invalid paid composition section')
    duration = sum(c['duration_ms'] for c in chunks)
    if not 69000 <= duration <= 600000:
        raise ValueError('Paid songs must be between 69 and 600 seconds')
    return duration


def reserved_total(ledger):
    return sum(row['reserved_cents'] + (row.get('operator_retry') or {}).get('reserved_cents', 0)
               for row in ledger['requests'])


def clean_error_text(value, key='', limit=1500):
    if not isinstance(value, (str, int, float)): return None
    text = str(value)
    if key: text = text.replace(key, '[redacted]')
    text = re.sub(r'(?i)(?:bearer\s+|sk[_-])[A-Za-z0-9_.-]+', '[redacted]', text)
    text = re.sub(r'(?i)((?:xi-api-key|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+',
                  r'\1[redacted]', text)
    return ' '.join(text.split())[:limit]


def failure_detail(error, key=''):
    """Private allowlisted diagnostics, never the raw response/request or credentials."""
    result = {'at': utc(), 'exception_type': type(error).__name__}
    if not isinstance(error, urllib.error.HTTPError):
        result['message'] = clean_error_text(str(error), key)
        return result
    result['http_status'] = error.code
    result['provider'] = {name: clean_error_text(error.headers.get(name), key, 200)
        for name in ('request-id', 'x-request-id', 'trace-id', 'song-id')
        if error.headers and error.headers.get(name)}
    try:
        raw = error.read(MAX_ERROR_BYTES + 1)
        result['body_truncated'] = len(raw) > MAX_ERROR_BYTES
        if result['body_truncated']: return result
        body = json.loads(raw)
        detail = body.get('detail', body) if isinstance(body, dict) else None
        if isinstance(detail, dict):
            result['detail'] = {name: clean_error_text(detail[name], key)
                for name in ('type', 'code', 'status', 'message', 'request_id')
                if name in detail and isinstance(detail[name], (str, int, float))}
        elif isinstance(detail, list):
            result['validation'] = [{name: clean_error_text(item[name], key, 500)
                for name in ('type', 'msg') if name in item and isinstance(item[name], str)}
                | {'loc': [clean_error_text(value, key, 100) for value in item.get('loc', [])[:12]]}
                for item in detail[:12] if isinstance(item, dict) and isinstance(item.get('loc', []), list)]
        elif isinstance(detail, str): result['detail'] = {'message': clean_error_text(detail, key)}
    except Exception as read_error:
        result['body_read_error'] = type(read_error).__name__
    return result


def failure_summary(detail):
    provider = detail.get('detail') or {}
    status = 'HTTP ' + str(detail['http_status']) if 'http_status' in detail else detail['exception_type']
    code = provider.get('code') or provider.get('status')
    message = provider.get('message') or detail.get('message')
    if not message and detail.get('validation'):
        message = '; '.join(str(row.get('loc', [])) + ': ' + row.get('msg', '') for row in detail['validation'])
    identifier = provider.get('request_id') or next(iter((detail.get('provider') or {}).values()), None)
    return ('Eleven Music ' + status + ((' [' + code + ']') if code else '')
            + ((': ' + message[:450]) if message else '')
            + ((' (request ' + identifier[:100] + ')') if identifier else ''))[:700]


def validated_request(work):
    inputs = load(work / 'paid-inputs.json')
    body = load(work / 'paid-request.json')
    if fingerprint(body) != inputs['request_hash']:
        raise ValueError('The frozen paid composition changed')
    duration_ms = request_duration(body)
    reservation = inputs['authorization']
    cost = math.ceil(duration_ms * RATE_CENTS / 60000)
    if (reservation.get('version') != 1 or reservation.get('backend') != 'eleven_music'
            or reservation.get('budgetId') != 'eleven-music-total-v1' or reservation.get('currency') != 'USD'
            or reservation.get('duration') * 1000 != duration_ms
            or reservation.get('rateCentsPerMinute') != RATE_CENTS or reservation.get('reservedCents') != cost):
        raise ValueError('The paid request exceeds its confirmed authorization')
    return inputs, body, duration_ms, cost


def authorize_retry(work, reason):
    """Operator only: reserve one explicitly authorized retry without erasing attempt one."""
    work = Path(work)
    if not isinstance(reason, str) or not 12 <= len(reason.strip()) <= 2000:
        raise ValueError('Record the explicit user authorization and reconciliation evidence')
    inputs, body, duration_ms, cost = validated_request(work)
    cfg = policy(inputs['policy_path']); ledger_path = Path(cfg['ledger'])
    with budget_lock(ledger_path.with_suffix('.lock')) as acquired:
        if not acquired: raise RuntimeError('Another paid music request holds the spending ledger; retry later')
        ledger = load(ledger_path); validate_ledger(ledger)
        row = next((row for row in ledger['requests'] if row['id'] == inputs['prompt_id']), None)
        if not row or row.get('status') != 'requires_reconciliation':
            raise ValueError('Operator retry requires a retained failed paid reservation')
        if row.get('request_hash') != inputs['request_hash'] or row['reserved_cents'] != cost:
            raise ValueError('The original paid reservation does not match the frozen request')
        if row.get('operator_retry'):
            raise ValueError('This request already has its one operator retry authorization')
        if any((work/name).exists() for name in ('paid-original.mp3', 'paid-original.partial', 'paid-receipt.json', 'generated.wav')):
            raise ValueError('Reconcile retained audio before authorizing another paid request')
        if not cfg.get('enabled') or reserved_total(ledger) + cost > cfg['cap_cents']:
            raise ValueError('Paid music is disabled or the local paid music budget is exhausted')
        original = dict(row)
        retry = {'version': 1, 'id': str(uuid.uuid4()), 'authorized_at': utc(), 'reason': reason.strip(),
            'request_hash': inputs['request_hash'], 'reserved_cents': cost, 'status': 'authorized',
            'original_attempt': original}
        row['operator_retry'] = retry
        save(ledger_path, ledger)
        return retry


def compose(work, send_request=send, key_reader=get_key):
    work = Path(work)
    inputs, body, duration_ms, cost = validated_request(work)
    cfg = policy(inputs['policy_path'])
    ledger_path = Path(cfg['ledger'])
    with budget_lock(ledger_path.with_suffix('.lock')) as acquired:
        if not acquired: raise RuntimeError('Another paid music request holds the spending ledger; retry later')
        ledger = load(ledger_path)
        validate_ledger(ledger)
        prior = next((row for row in ledger['requests'] if row['id'] == inputs['prompt_id']), None)
        receipt_path = work / 'paid-receipt.json'; output = work / 'paid-original.mp3'
        if prior:
            if prior['request_hash'] != inputs['request_hash'] or prior['reserved_cents'] != cost:
                raise ValueError('A paid reservation already exists for different inputs')
            if receipt_path.exists():
                receipt = load(receipt_path)
                if (receipt.get('request_hash') != inputs['request_hash'] or receipt.get('prompt_id') != inputs['prompt_id']
                        or output.stat().st_size != receipt['bytes'] or sha(output) != receipt['sha256']):
                    raise ValueError('The retained paid composition failed its integrity check')
                prior.update(status='completed', sha256=receipt['sha256'], bytes=receipt['bytes'])
                save(ledger_path, ledger)
                return receipt
            retry = prior.get('operator_retry') or {}
            if retry.get('status') != 'authorized' or prior.get('status') != 'requires_reconciliation':
                raise RuntimeError('Paid music needs reconciliation: this request was already sent or reserved. No automatic repeat charge is allowed.')
            if output.exists() or output.with_suffix('.partial').exists() or (work/'generated.wav').exists():
                raise ValueError('Reconcile retained audio before using the paid operator retry')
        elif output.exists() or receipt_path.exists():
            raise ValueError('Restore the missing paid reservation before resuming retained audio')
        if not cfg.get('enabled'):
            raise ValueError('Paid music is disabled; the confirmed request remains saved')
        if reserved_total(ledger) + (0 if prior else cost) > cfg['cap_cents']:
            raise ValueError('The local paid music budget is exhausted; no request was sent')
        key = key_reader(cfg['credential'])
        if prior:
            row = prior
            row['operator_retry'].update(status='consumed', consumed_at=utc())
            attempt = 2
        else:
            row = {'id': inputs['prompt_id'], 'request_hash': inputs['request_hash'], 'reserved_cents': cost,
                   'duration_ms': duration_ms, 'status': 'reserved', 'at': utc()}
            ledger['requests'].append(row)
            attempt = 1
        save(ledger_path, ledger)  # Reserve/consume durably BEFORE the billable invocation.
        try:
            data, provider = send_request(body, key)
            temporary = output.with_suffix('.partial')
            with temporary.open('wb') as stream:
                stream.write(data); stream.flush(); os.fsync(stream.fileno())
            temporary.replace(output)
            receipt = {'version': 1, 'prompt_id': inputs['prompt_id'], 'request_hash': inputs['request_hash'],
                'sha256': sha(output), 'bytes': len(data), 'provider': provider, 'model': MODEL, 'attempt': attempt,
                'reserved_cents': cost, 'estimated_price_cents': duration_ms / 60000 * 15,
                'actual_invoice_checked': False, 'completed_at': utc()}
            save(receipt_path, receipt)
            row.update(status='completed', sha256=receipt['sha256'], bytes=receipt['bytes'])
            save(ledger_path, ledger)
            return receipt
        except Exception as error:
            detail = failure_detail(error, key)
            detail.update(prompt_id=inputs['prompt_id'], request_hash=inputs['request_hash'], attempt=attempt)
            row.update(status='requires_reconciliation', error_type=type(error).__name__, latest_error=detail)
            if isinstance(error, urllib.error.HTTPError): row['http_status'] = error.code
            save(ledger_path, ledger)
            save(work/'paid-errors'/(str(uuid.uuid4())+'.json'), detail)
            save(work/'paid-error.json', detail)
            raise RuntimeError(failure_summary(detail) + '. Paid music needs reconciliation; no automatic repeat charge is allowed.') from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--authorize-retry', action='store_true')
    parser.add_argument('--reason')
    args = parser.parse_args()
    if args.authorize_retry:
        retry = authorize_retry(args.work, args.reason)
        print(json.dumps({'status': 'authorized', 'id': retry['id'], 'reserved_cents': retry['reserved_cents']}))
        return
    if args.reason: parser.error('--reason requires --authorize-retry')
    receipt = compose(args.work)
    inputs = load(args.work / 'paid-inputs.json')
    decoded = args.work / 'generated.wav'
    evidence = args.work / 'paid-decoded.json'
    if evidence.exists():
        saved = load(evidence)
        if saved['original_sha256'] != receipt['sha256'] or sha(decoded) != saved['sha256']:
            raise ValueError('The decoded paid composition changed')
        return
    # MP3 is preserved verbatim. Decode only; no trimming, fading, or normalization.
    subprocess.run([inputs['ffmpeg'], '-v', 'error', '-nostdin', '-y', '-i', str(args.work / 'paid-original.mp3'),
                    '-ar', '44100', '-ac', '2', '-c:a', 'pcm_f32le', str(decoded)], check=True,
                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    save(evidence, {'original_sha256': receipt['sha256'], 'sha256': sha(decoded), 'audio_trimmed': False})


if __name__ == '__main__': main()
