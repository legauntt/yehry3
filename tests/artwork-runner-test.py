"""Exercise the scheduler boundary without network, image calls or publication."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import os
from datetime import datetime, timezone
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("runner", Path(__file__).resolve().parents[1] / "scripts/artwork-lifecycle.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTest(unittest.TestCase):
    def test_restart_archives_only_preboot_locks_and_preserves_paid_receipts(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "automation").mkdir()
            ledger = state / "ledger.json"
            ledger.write_text('{"jobs":{"uncertain":{"status":"reserved"}}}')
            pending = state / "automation/pending.json"
            pending.write_text('{"worktree":"preserve-this"}')
            before = {file: file.read_bytes() for file in (ledger, pending)}
            for name in ("automation/worker.lock", "run.lock"):
                lock = state / name
                lock.write_text(json.dumps({"pid": os.getpid(), "startedAt":
                    datetime.fromtimestamp(100, timezone.utc).isoformat()}))
                os.utime(lock, (100, 100))
            with patch.object(runner, "boot_time", return_value=1000):
                runner.recover_previous_boot_locks(state)
            self.assertFalse((state / "run.lock").exists())
            self.assertFalse((state / "automation/worker.lock").exists())
            self.assertEqual(len(list(state.rglob("*.pre-restart-*"))), 2)
            for file, contents in before.items():
                self.assertEqual(file.read_bytes(), contents)

    def test_current_boot_or_malformed_lock_is_not_removed(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "automation").mkdir()
            lock = state / "automation/worker.lock"
            lock.write_text(json.dumps({"startedAt": datetime.now(timezone.utc).isoformat()}))
            with patch.object(runner, "boot_time", return_value=1000):
                runner.recover_previous_boot_locks(state)
                self.assertTrue(lock.exists())
                lock.write_text("interrupted-write")
                with self.assertRaises(ValueError):
                    runner.recover_previous_boot_locks(state)
                self.assertEqual(lock.read_text(), "interrupted-write")

    def exercise(self, protection_failure=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / "state"
            state.mkdir()
            receipt = {"jobs": {"rejected-song": {"status": "failed-or-uncertain", "reserved": 0.01}}}
            ledger = state / "ledger.json"
            ledger.write_text(json.dumps(receipt))
            baseline = root / "baseline.json"
            baseline.write_text("{}")
            config = root / "config.json"
            config.write_text(json.dumps({"state": str(state), "baseline": str(baseline),
                "workspace": str(root), "repo": str(root / "repo"), "budget": 40,
                "budgetPeriod": "monthly", "incubationHours": 24, "node": "node",
                "keyFile": "never-read", "python": "python"}))
            calls = []

            def command(args, **kwargs):
                args = [str(arg) for arg in args]
                calls.append(args)
                code = 0
                output = ""
                if args[0] == "git":
                    operation = args[3:]
                    if operation[:2] == ["worktree", "add"]:
                        Path(operation[4]).mkdir()
                    elif operation[:2] == ["worktree", "remove"]:
                        shutil.rmtree(operation[-1])
                elif args[1].endswith("song-artwork.mjs") and args[2] == "run":
                    code = 1
                elif protection_failure and "verify-protected" in args:
                    code = 1
                return subprocess.CompletedProcess(args, code, output, "")

            with patch.object(runner.subprocess, "run", side_effect=command):
                if protection_failure:
                    with self.assertRaises(RuntimeError):
                        runner.run_pass(config)
                else:
                    runner.run_pass(config)
            self.assertEqual(json.loads(ledger.read_text()), receipt)
            self.assertFalse((state / "automation/worker.lock").exists())
            self.assertEqual((state / "automation/pending.json").exists(), protection_failure)
            self.assertEqual(bool(list(root.glob("yehry3-artwork-auto-*"))), protection_failure)
            self.assertFalse(any("push" in call or "commit" in call for call in calls))

    def test_rejected_only_pass_keeps_receipt_and_unblocks_future_songs(self):
        self.exercise()

    def test_protection_failure_preserves_checkout_and_blocks_publication(self):
        self.exercise(protection_failure=True)


if __name__ == "__main__":
    unittest.main()
