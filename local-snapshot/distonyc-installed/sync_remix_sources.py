"""Register eligible retained publications; never claim, retry, or render a request."""
import argparse, os
from pathlib import Path
from common import API, inside, load, save, utc
from remix_sources import prepare


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--request-id')
    choice.add_argument('--all-published', action='store_true')
    choice.add_argument('--check-library', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    config = load(args.config)
    api = API(config['api'], config['worker_id'], os.environ['DISTONYC_WORKER_TOKEN'])
    if args.check_library:
        if args.prepare_only: parser.error('--check-library reports verified availability to the server; omit --prepare-only')
        from remix_health import check_library
        report = check_library(config, api)
        print(report['counts'])
        return 1 if report['counts']['error'] else 0
    jobs = Path(config['state_dir']) / 'jobs'
    directories = [inside(jobs / args.request_id, jobs)] if args.request_id else sorted(path.parent for path in jobs.glob('*/render-result.json'))
    report = {'at': utc(), 'prepare_only': args.prepare_only, 'requests': []}
    report_file = Path(config['state_dir']) / ('remix-source-prepare.json' if args.prepare_only else 'remix-source-registration.json')
    for directory in directories:
        row = {'request_id': directory.name}
        try:
            prompt = api.call('/prompts/' + directory.name)['prompt']
            if prompt['status'] != 'published':
                row.update(status='skipped', reason='Request is not published')
            else:
                source = prepare(config, prompt)
                if source:
                    if not args.prepare_only:
                        api.call('/songs/' + source['songId'] + '/remix-source',
                            {key: source[key] for key in ('version', 'url', 'sha256', 'bytes')})
                    row.update(status='prepared' if args.prepare_only else 'registered', song_id=source['songId'], sha256=source['sha256'])
                else:
                    row.update(status='unavailable', reason='No supported retained converted stem or published lyric sheet')
        except (OSError, ValueError) as error:
            row.update(status='error', reason=str(error))
        except Exception as error:
            # Keep per-song server failures in the report; the command never retries a queue job.
            row.update(status='error', reason=str(error))
        report['requests'].append(row); save(report_file, report)
        print(row['status'] + ': ' + directory.name, flush=True)
    report['counts'] = {status: sum(row['status'] == status for row in report['requests'])
                        for status in ('registered', 'prepared', 'unavailable', 'skipped', 'error')}
    save(report_file, report)
    print(report['counts'])
    return 1 if report['counts']['error'] else 0


if __name__ == '__main__': raise SystemExit(main())
