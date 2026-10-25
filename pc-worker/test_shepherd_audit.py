import tempfile, unittest
from pathlib import Path
from common import save
from reliability_audit import shepherd_outcomes


class ShepherdAuditTests(unittest.TestCase):
    def test_does_not_credit_eventual_publication_after_failed_action_or_no_action(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); prompts = []; ledger = {}
            for ident, action, fails in [('successful', 'replan', False), ('failed', 'replan', True), ('diagnosed', 'needs_code_fix', False)]:
                job = root / 'jobs' / ident / 'shepherd' / 'guided-steer'
                save(job / 'input.json', {'consultation_id': ident})
                save(job / 'journal.json', {'decision': {'action': action}})
                ledger[ident] = {'attempts': [{'steer': ident, 'category': 'replan', 'at': '2026-09-20T00:00:00Z'}] if action == 'replan' else []}
                history = [{'at': '2026-09-20T00:00:01Z', 'action': 'status', 'status': 'queued'}]
                if fails: history += [{'at': '2026-09-20T00:00:02Z', 'status': 'failed'}]
                history += [{'at': '2026-09-20T00:00:03Z', 'status': 'published'}]
                prompts.append({'id': ident, 'status': 'published', 'history': history})
            save(root / 'monitor/ledger.json', {'requests': ledger})
            report = shepherd_outcomes({'state_dir': folder}, prompts)
            self.assertEqual(report['outcomes'], {'published_without_another_failure': 1, 'failed_again': 1, 'no_queue_action': 1})


if __name__ == '__main__': unittest.main()
