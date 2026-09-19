# Local snapshot — 2026-09-19

A point-in-time copy of code that existed only on Jesse's PC, captured so it stops living outside
version control. Nothing here runs, is imported, or is published: `scripts/build.mjs` does not copy
this folder into `dist/`, and the site never serves it.

`DRIFT.md` reports how each snapshot compares with `origin/talandar` at capture time.

## `distonyc-installed/`

The 94 `.py`, `.ps1` and `.md` files actually installed at `%LOCALAPPDATA%\Distonyc`, which is **not**
a checkout of `pc-worker/`. At capture, 27 files differed from the branch, 6 existed only on the PC,
and 18 branch files were not installed at all. Notably the installed `queue_monitor.py` carried
uncommitted classification work (suite packaging, sparse-vocal fallbacks, prepared repairs) *and*
predated guided Dehaka recovery until it was ported in on 2026-09-19.

## `main-checkout/`

The 88 modified and untracked files in `C:\Users\Jesse\code\yehry3`, a checkout hundreds of commits
behind `talandar`. 25 of them are byte-identical to the branch and only look local because the stale
index never learned about them; 51 genuinely differ and 12 do not exist on the branch.

## Deliberately excluded

- `worker-credential.xml`, `monitor-credential.xml` — DPAPI-protected secrets. They never belong in a
  repository, least of all a public one.
- `state/claim.json` — holds a live worker lease token.
- `state/` generally, and the 1.2 GB of rendered MP3s under `state/jobs/`. The text parts of the
  machine state live in the private chairlift repository under `distonyc-local/` instead.
- `*.pre-shepherd` editor backups and `__pycache__`.

Every file copied here was scanned for credential patterns first. The only matches were an
environment-variable *name* (`DISTONYC_MONITOR_PASSWORD`) and a dummy `Bearer` string inside a test,
both reviewed and kept.

## Using it

This is evidence, not a source of truth. To reconcile the PC with the branch, diff a file against
`pc-worker/` and port the parts worth keeping — then install with
`install.ps1 -Files @('one.py','two.py')` and let it regenerate `runtime-release.json`, which
`run.ps1` and `monitor-run.ps1` verify at every start.
