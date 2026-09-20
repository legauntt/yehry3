"""Settle conservative paid music holds against ElevenLabs provider history.

Reservations are taken at $1.00/minute before the only billable call, while published
Eleven Music generation bills $0.15/minute. Nothing lowered a hold afterwards, so the
shared $200 cap filled roughly 6.7x faster than real spending. This records the settled
cost per attempt without touching `reserved_cents`, the frozen requests, the receipts or
any row's history, so receipt-backed resume keeps validating against the original
authorization while the cap counts what was actually generated.

An attempt settles to zero only with evidence that the provider rejected it before
generating audio (an HTTP 4xx). Anything else keeps its full hold and is reported for
manual review. The billable minutes are then checked against the provider's own credit
record; a disagreement aborts the write.
"""
import argparse
import json
import math
import sys
import time
import urllib.request
from pathlib import Path

from common import load, save, utc
from paid_music import budget_lock, charged_cents, get_key, policy, validate_ledger

# Published Eleven Music generation rate; receipts already record this as estimated_price_cents.
RATE_CENTS_PER_MINUTE = 15
# Measured against music_v2_5 usage on 2026-09-19: 149,188 credits for 180.8333 generated minutes.
CREDITS_PER_MINUTE = 825
USAGE_ENDPOINT = 'https://api.elevenlabs.io/v1/usage/character-stats'
SUBSCRIPTION_ENDPOINT = 'https://api.elevenlabs.io/v1/user/subscription'
USAGE_WINDOW_DAYS = 120
TOLERANCE = 0.02
GENERATION_MODEL_PREFIX = 'music_'
BASIS = 'published $0.15/minute rate, settled against ElevenLabs music_v2_5 credit history'


def metered_cents(duration_ms):
    return math.ceil(duration_ms * RATE_CENTS_PER_MINUTE / 60000)


def provider_credits(credential, days=USAGE_WINDOW_DAYS):
    """Read-only usage history. This never generates audio and is not billable."""
    key = get_key(credential)
    now = int(time.time() * 1000)
    query = (USAGE_ENDPOINT + '?start_unix=' + str(now - days * 86400000) + '&end_unix=' + str(now)
             + '&aggregation_interval=day&breakdown_type=model')
    request = urllib.request.Request(query, headers={'xi-api-key': key})
    with urllib.request.urlopen(request, timeout=120) as response:
        usage = json.loads(response.read()).get('usage', {})
    return {name: sum(values) for name, values in usage.items()}


def provider_balance(credential):
    """The plan's remaining credits, shaped for Chairlift's credits endpoint.

    Read-only and not billable. It needs the key's `User` permission (`user_read`); without it
    the provider answers 401 `missing_permissions`. Only counts and the reset time leave the PC.
    """
    key = get_key(credential)
    request = urllib.request.Request(SUBSCRIPTION_ENDPOINT, headers={'xi-api-key': key})
    with urllib.request.urlopen(request, timeout=60) as response:
        state = json.loads(response.read())
    limit, used = state.get('character_limit'), state.get('character_count')
    if any(type(value) is not int or value < 0 for value in (limit, used)):
        raise ValueError('ElevenLabs returned an unreadable plan balance')
    balance = {'version': 1, 'creditsRemaining': max(0, limit - used), 'creditLimit': limit}
    if type(state.get('next_character_count_reset_unix')) is int:
        balance['resetUnix'] = state['next_character_count_reset_unix']
    if isinstance(state.get('tier'), str):
        balance['tier'] = state['tier'][:40]
    return balance


def generation_credits(models):
    """The ledger records song generation only. Another Eleven product on the same key is reported, not counted.

    On 2026-09-20 a 12,857-credit `two_stems_v1` trial made outside the worker read as unexplained generated
    minutes and aborted eleven hourly settlements, leaving every new hold at $1.00/minute against the cap.
    """
    return sum(value for name, value in models.items() if name.startswith(GENERATION_MODEL_PREFIX))


def rejected_before_generation(entry):
    status = entry.get('http_status') or (entry.get('latest_error') or {}).get('http_status')
    return entry.get('error_type') == 'HTTPError' and isinstance(status, int) and 400 <= status < 500


def settle(row, entry, name, produced):
    """One attempt's settled cost, or None when there is no evidence of what it cost."""
    if entry is produced:
        return metered_cents(row['duration_ms']), 'generated the retained audio'
    if name == 'retry' and entry.get('status') == 'authorized':
        return 0, 'authorized but never sent to the provider'
    # authorize_retry snapshots the first attempt before the row is overwritten by attempt two,
    # so the original's own failure evidence lives there once a retry exists.
    retry = row.get('operator_retry')
    failure = row if name == 'retry' or not retry else retry.get('original_attempt', row)
    if rejected_before_generation(failure):
        return 0, 'provider rejected the request before generating audio'
    return None, 'no evidence this attempt avoided generation; hold retained'


def plan(ledger):
    """Classify every attempt as generated, rejected before generation, or unresolved."""
    attempts = []
    for row in ledger['requests']:
        retry = row.get('operator_retry')
        # A completed row holds exactly one take: the authorized retry when it was consumed.
        produced = None
        if row.get('status') == 'completed':
            produced = retry if retry and retry.get('status') == 'consumed' else row
        entries = [(row, 'original')] + ([(retry, 'retry')] if retry else [])
        for entry, name in entries:
            settled, why = settle(row, entry, name, produced)
            attempts.append({'id': row['id'], 'attempt': name, 'entry': entry, 'held': entry['reserved_cents'],
                             'settled': settled, 'why': why,
                             'billed_ms': row['duration_ms'] if entry is produced else 0,
                             # An attempt of unknown outcome may already have spent credits.
                             'open_ms': row['duration_ms'] if settled is None else 0})
    return attempts


def verify_against_provider(attempts, credential):
    """Credits must match what the ledger says was generated, allowing for attempts in flight.

    An unresolved attempt may or may not have reached the provider - a request sent moments
    ago has already spent credits while its row is still open - so it sets an upper bound
    rather than a disagreement. Its hold is retained either way.
    """
    minutes = sum(a['billed_ms'] for a in attempts) / 60000
    open_minutes = sum(a['open_ms'] for a in attempts) / 60000
    models = provider_credits(credential)
    credits = generation_credits(models)
    low = minutes * CREDITS_PER_MINUTE
    high = (minutes + open_minutes) * CREDITS_PER_MINUTE
    tolerance = max(low * TOLERANCE, CREDITS_PER_MINUTE)
    ok = low - tolerance <= credits <= high + tolerance
    return {'generated_minutes': round(minutes, 4), 'unresolved_minutes': round(open_minutes, 4),
            'provider_credits': credits, 'outside_ledger_credits': sum(models.values()) - credits,
            'expected_credits': round(low, 1),
            'expected_ceiling': round(high + tolerance, 1), 'models': models,
            'credits_per_minute': round(credits / minutes, 2) if minutes else None, 'agrees': bool(ok)}


def reconcile(policy_path, apply=False):
    cfg = policy(policy_path)
    ledger_path = Path(cfg['ledger'])
    with budget_lock(ledger_path.with_suffix('.lock')) as acquired:
        if not acquired:
            raise RuntimeError('Another paid music request holds the spending ledger; retry later')
        ledger = load(ledger_path)
        validate_ledger(ledger)
        before = sum(charged_cents(row) + (charged_cents(r) if (r := row.get('operator_retry')) else 0)
                     for row in ledger['requests'])
        attempts = plan(ledger)
        evidence = verify_against_provider(attempts, cfg['credential'])
        after = sum(a['settled'] if a['settled'] is not None else a['held'] for a in attempts)
        report = {'at': utc(), 'cap_cents': cfg['cap_cents'], 'before_cents': before, 'after_cents': after,
                  'unresolved': [{k: a[k] for k in ('id', 'attempt', 'held', 'why')}
                                 for a in attempts if a['settled'] is None],
                  'provider': evidence, 'applied': False,
                  'rows': [{k: a[k] for k in ('id', 'attempt', 'held', 'settled', 'why')} for a in attempts]}
        if not apply:
            return report
        if not evidence['agrees']:
            raise ValueError('Provider credit history does not match the generated minutes; '
                             'reconcile manually before writing: ' + json.dumps(evidence))
        stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
        save(ledger_path.with_name(ledger_path.stem + '-before-reconcile-' + stamp + '.json'), ledger)
        for attempt in attempts:
            if attempt['settled'] is None:
                continue
            attempt['entry'].update(reconciled_cents=attempt['settled'], reconciled_at=report['at'],
                                    reconciled_basis=BASIS + '; ' + attempt['why'])
        history = ledger.setdefault('reconciliations', [])
        history.append({k: report[k] for k in ('at', 'before_cents', 'after_cents', 'provider', 'unresolved')})
        validate_ledger(ledger)
        save(ledger_path, ledger)
        report['applied'] = True
        report['backup'] = str(ledger_path.with_name(ledger_path.stem + '-before-reconcile-' + stamp + '.json'))
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--policy', required=True, type=Path)
    parser.add_argument('--apply', action='store_true', help='write the settled costs; otherwise report only')
    parser.add_argument('--usage-only', action='store_true', help='print provider credit usage and exit')
    args = parser.parse_args()
    if args.usage_only:
        cfg = policy(args.policy)
        models = provider_credits(cfg['credential'])
        total = generation_credits(models)
        print(json.dumps({'at': utc(), 'credits': total, 'outside_ledger_credits': sum(models.values()) - total, 'models': models,
                          'generated_minutes': round(total / CREDITS_PER_MINUTE, 2),
                          'value_cents': round(total / CREDITS_PER_MINUTE * RATE_CENTS_PER_MINUTE)}, indent=2))
        return
    report = reconcile(args.policy, apply=args.apply)
    print(json.dumps(report, indent=2))
    if report['unresolved']:
        print(str(len(report['unresolved'])) + ' attempt(s) kept their full hold; review them.', file=sys.stderr)


if __name__ == '__main__':
    main()
