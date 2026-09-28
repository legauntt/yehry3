"""One hidden, bounded artwork lifecycle pass. Run periodically with Task Scheduler.

The config contains paths and a monthly budget, never the API key itself.
All masters, prompts, accounting and logs live outside disposable worktrees.
Failures preserve the worktree and block unattended reruns for human review.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time


def run_pass(config_path, check_only=False):
    config = json.loads(Path(config_path).read_text(encoding="utf-8-sig"))
    state = Path(config["state"]).resolve()
    if not state.is_dir() or not (state / "ledger.json").is_file():
        raise RuntimeError("Existing shared spend ledger is required; refusing to reset the allowance")
    if not Path(config["baseline"]).is_file():
        raise RuntimeError("The protected existing-catalog baseline is required")
    if not 0 < config["budget"] <= 40 or config.get("budgetPeriod") != "monthly":
        raise RuntimeError("Ongoing authorization is capped at $40 per calendar month")
    runtime = state / "automation"
    runtime.mkdir(exist_ok=True)
    pending = runtime / "pending.json"
    if pending.exists():
        raise RuntimeError(f"An earlier pass needs review: {pending}")
    lock = runtime / "worker.lock"
    with lock.open("x", encoding="utf-8") as stream:
        json.dump({"pid": os.getpid(), "startedAt": datetime.now(timezone.utc).isoformat()}, stream)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    logs = runtime / "runs" / stamp
    logs.mkdir(parents=True)
    workspace = Path(config["workspace"]).resolve()
    repo = Path(config["repo"]).resolve()
    checkout = (workspace / ("yehry3-artwork-auto-" + stamp)).resolve()
    if checkout.parent != workspace or checkout == repo or checkout.exists():
        lock.unlink()
        raise RuntimeError("Unsafe or occupied temporary worktree path")
    branch = "codex/artwork-auto-" + stamp
    created = False
    count = 0

    def command(args, cwd, label, allowed=(0,)):
        nonlocal count
        count += 1
        result = subprocess.run([str(x) for x in args], cwd=cwd, capture_output=True,
                                text=True, encoding="utf-8", errors="replace",
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                                env={**os.environ, "MONGOMS_DISABLE_POSTINSTALL": "1"})
        (logs / f"{count:02}-{label}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
        print(f"{label}: exit {result.returncode}", flush=True)
        if result.returncode not in allowed:
            raise RuntimeError(f"{label} failed; see {logs}")
        return result.stdout.strip(), result.returncode

    def git(cwd, *args):
        return command(["git", "-c", f"safe.directory={cwd.as_posix()}", *args], cwd, "git-" + args[0])[0]

    def node(script, *args, allowed=(0,)):
        return command([config["node"], checkout / "scripts" / script, *args], checkout, script.removesuffix(".mjs"), allowed)

    def clean_worktree():
        # No force, no recursive shell deletion, and no junction traversal.
        # Only dependencies/build output created by this pass may be ignored.
        status = git(checkout, "status", "--porcelain", "--ignored")
        unexpected = [line for line in status.splitlines()
                      if line not in ("!! node_modules/", "!! dist/")]
        if unexpected:
            raise RuntimeError("Worktree has unique files; preserved for review")
        for name in ("node_modules", "dist"):
            directory = checkout / name
            if directory.exists() and (directory.is_symlink() or getattr(directory.lstat(), "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT):
                raise RuntimeError("Unexpected dependency junction; preserve worktree for review")
        git(repo, "worktree", "remove", "--", checkout)
        if checkout.exists() or str(checkout).replace("\\", "/") in git(repo, "worktree", "list", "--porcelain"):
            raise RuntimeError("Temporary worktree cleanup did not finish")

    try:
        git(repo, "fetch", "origin", "talandar")
        git(repo, "worktree", "add", "-b", branch, checkout, "origin/talandar")
        created = True
        baseline = logs / "before.json"
        node("audit-song-artwork.mjs", "audit", "--output", baseline)
        common = ["--state", state, "--lifecycle", "--incubation-hours", str(config["incubationHours"]),
                  "--lifecycle-baseline", config["baseline"],
                  "--budget", str(config["budget"]), "--budget-period", "monthly", "--limit", str(config.get("limit", 8)),
                  "--concurrency", str(config.get("concurrency", 4))]
        if check_only:
            node("song-artwork.mjs", "plan", *common)
            clean_worktree()
            return
        # The wrapper retains reservations for failures and never auto-retries them.
        _, generation_code = node("song-artwork.mjs", "run", *common, "--key-file", config["keyFile"],
                                  "--python", config["python"], allowed=(0, 1))
        node("audit-song-artwork.mjs", "verify-protected", "--baseline", baseline)
        changes = git(checkout, "status", "--porcelain")
        if not changes:
            if generation_code:
                raise RuntimeError("Artwork generation needs review; no changes were published")
            clean_worktree()
            return
        # Cover publication is the only mutation this worker may ship.
        for line in changes.splitlines():
            name = line[3:] if line.startswith((" M ", "?? ")) else line.lstrip(" M?")
            if name != "assets/artwork-catalog.js" and not name.startswith("assets/artwork/"):
                raise RuntimeError(f"Unexpected change in artwork worktree: {name}")
        command([config["node"], config["npmCli"], "ci", "--ignore-scripts", "--no-audit", "--no-fund"], checkout, "npm-ci")
        command([config["node"], config["npmCli"], "run", "build"], checkout, "build")
        command([config["node"], config["npmCli"], "test"], checkout, "test")
        git(checkout, "add", "--", "assets/artwork-catalog.js", "assets/artwork")
        git(checkout, "commit", "-m", "Add staged artwork for active new songs")
        checked_head = git(checkout, "rev-parse", "HEAD")
        git(checkout, "fetch", "origin", "talandar")
        git(checkout, "rebase", "origin/talandar")
        node("audit-song-artwork.mjs", "verify-protected", "--baseline", baseline)
        # Validate again if a concurrent publication changed the checkout.
        if checked_head != git(checkout, "rev-parse", "HEAD"):
            command([config["node"], config["npmCli"], "run", "build"], checkout, "build-before-push")
            command([config["node"], config["npmCli"], "test"], checkout, "test-before-push")
        git(checkout, "push", "origin", "HEAD:talandar")
        deadline = time.monotonic() + 1800
        while True:
            _, code = node("song-artwork.mjs", "verify", allowed=(0, 1))
            if code == 0:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError("Live artwork verification timed out; worktree preserved")
            time.sleep(30)
        node("audit-song-artwork.mjs", "verify-protected", "--baseline", baseline)
        node("audit-song-artwork.mjs", "audit", "--output", logs / "published.json")
        (logs / "publication.json").write_text(json.dumps({
            "commit": git(checkout, "rev-parse", "HEAD"),
            "verifiedAt": datetime.now(timezone.utc).isoformat(),
            "site": "https://yehry3.app",
            "ledger": str(state / "ledger.json"),
        }, indent=2), encoding="utf-8")
        clean_worktree()
        if generation_code:
            print("Successful covers published; failed jobs remain reserved for manual review", flush=True)
    except BaseException as error:
        if created and checkout.exists():
            pending.write_text(json.dumps({"worktree": str(checkout), "logs": str(logs), "error": str(error)}, indent=2), encoding="utf-8")
        raise
    finally:
        lock.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--check", action="store_true", help="Plan only: no paid calls, commits or deployment")
    args = parser.parse_args()
    try:
        run_pass(args.config, args.check)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
