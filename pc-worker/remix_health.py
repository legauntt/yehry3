"""Periodically certify retained remix sources without claiming or rendering jobs."""
import time
from pathlib import Path
from common import load, save, utc
from remix_sources import archive_vocals, resolve

CHECK_SECONDS = 6 * 60 * 60
RETRY_SECONDS = 15 * 60


def check_library(config, api):
    report = {'at': utc(), 'sources': []}
    journal = Path(config['state_dir']) / 'remix-source-health.json'
    for source in api.call('/remix-sources')['sources']:
        row = {'song_id': source['songId']}
        marker = {key: source[key] for key in ('version', 'url', 'sha256', 'bytes')}
        try:
            archive_vocals(config, source)
            resolve(config, source)
        except (OSError, ValueError) as error:
            row.update(status='unavailable', reason=str(error))
        else:
            row['status'] = 'ready'
        try:
            path = '/songs/' + source['songId'] + '/remix-source'
            api.call(path + ('/unavailable' if row['status'] == 'unavailable' else ''), marker)
        except Exception as error:
            row.update(status='error', reason=str(error))
        report['sources'].append(row)
        save(journal, report)
    report['counts'] = {status: sum(row['status'] == status for row in report['sources'])
                        for status in ('ready', 'unavailable', 'error')}
    save(journal, report)
    return report


def check_due(config, api, now=None):
    if not config.get('catalog_remix_health'): return
    now = time.time() if now is None else now
    schedule = Path(config['state_dir']) / 'remix-source-health-schedule.json'
    if schedule.exists() and load(schedule).get('next_check', 0) > now: return
    # Persist before network activity. An outage must not hold up normal production.
    save(schedule, {'next_check': now + RETRY_SECONDS, 'at': utc()})
    try:
        report = check_library(config, api)
        if not report['counts']['error']:
            save(schedule, {'next_check': now + CHECK_SECONDS, 'at': utc()})
    except Exception as error:
        save(Path(config['state_dir']) / 'remix-source-health-error.json', {'at': utc(), 'error': str(error)})
