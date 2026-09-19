import copy, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from common import load, save
from queue_monitor import classify, scan
from vocal_repair import intervals
from renderer import vocal_recovery

class FakeAPI:
    def __init__(self, prompts):self.rows=prompts;self.calls=[];self.posts=[];self.lose_response=False
    def prompts(self):return copy.deepcopy(self.rows)
    def call(self,path,method='GET',body=None):
        self.posts.append((path,method,copy.deepcopy(body)));return {'entry':{}}
    def retry(self,prompt):
        self.calls.append(prompt['id'])
        target=next(p for p in self.rows if p['id']==prompt['id'])
        if target['version']!=prompt['version']:raise AssertionError('Stale retry')
        target.update(status='queued',version=target['version']+1)
        if self.lose_response:self.lose_response=False;raise TimeoutError('response lost')
        return copy.deepcopy(target)

def prompt(ident='one',error='Connection timed out',status='failed',active=False):
    return {'id':ident,'prompt':'A requested song','status':status,'workerError':error,'workerActive':active,'version':1}

class MonitorTests(unittest.TestCase):
    def config(self,directory):return {'state_dir':directory,'settings':{'studio_dir':str(Path(directory)/'studio')}}
    def test_idle_and_canceled_never_retry(self):
        with tempfile.TemporaryDirectory() as root:
            api=FakeAPI([prompt(status='canceled'),prompt('two',status='published')])
            report=scan(self.config(root),api)
            self.assertEqual(api.calls,[]);self.assertEqual(report['needs_attention'],0)
    def test_transients_cool_down_and_stop_after_three_even_when_error_changes(self):
        with tempfile.TemporaryDirectory() as root:
            api=FakeAPI([prompt()]);cfg=self.config(root)
            scan(cfg,api,now=1000);self.assertEqual(len(api.calls),1)
            api.rows[0]['status']='failed';scan(cfg,api,now=1001);self.assertEqual(len(api.calls),1)
            scan(cfg,api,now=1900);self.assertEqual(len(api.calls),2)
            api.rows[0]['status']='failed';api.rows[0]['workerError']='Temporary connection failure'
            scan(cfg,api,now=5500);self.assertEqual(len(api.calls),3)
            api.rows[0]['status']='failed';scan(cfg,api,now=99999);self.assertEqual(len(api.calls),3)
            self.assertIn('budget exhausted',load(Path(root)/'monitor/report.json')['requests'][0]['next_action'])
    def test_deterministic_spacing_gets_one_policy_attempt(self):
        with tempfile.TemporaryDirectory() as root, patch('queue_monitor.local_context',return_value={'has_request':True}):
            api=FakeAPI([prompt(error='Too much instrumental space')]);cfg=self.config(root)
            scan(cfg,api,now=0);api.rows[0]['status']='failed';scan(cfg,api,now=99999)
            self.assertEqual(len(api.calls),1)
    def test_lost_success_response_is_reconciled_without_requeueing(self):
        with tempfile.TemporaryDirectory() as root:
            api=FakeAPI([prompt()]);api.lose_response=True;cfg=self.config(root)
            with self.assertRaises(TimeoutError):scan(cfg,api,now=0)
            scan(cfg,api,now=1);self.assertEqual(len(api.calls),1)
            api.rows[0]['status']='published';report=scan(cfg,api,now=2)
            self.assertEqual(report['resolved'],1);self.assertEqual(report['resolved_by_category'],{'transient_runtime':1})
            self.assertNotIn('pending_retry',load(Path(root)/'monitor/ledger.json')['requests']['one'])
    def test_active_workers_and_unknown_integrity_input_errors_need_review(self):
        with tempfile.TemporaryDirectory() as root:
            api=FakeAPI([prompt(active=True),prompt('two','Checksum mismatch'),prompt('three','Encoded peak too loud'),prompt('four','Unexpected assertion')])
            report=scan(self.config(root),api);self.assertEqual(api.calls,[])
            self.assertEqual(report['needs_attention'],4)
            self.assertEqual(set(report['open_by_category']),{'transient_runtime','saved_inputs','audio_integrity','unknown'})
    def test_verified_export_goes_to_publication_and_voice_attempt_is_not_repeated(self):
        self.assertEqual(classify('export failed',{'has_result':True})[:2],('publication','retry'))
        context={'has_request':True,'state':{'stage':'finish'}}
        self.assertEqual(classify('Missing vocal phrase',context)[:2],('vocal_dropout','retry'))
        context['voice_repair']={'status':'failed'}
        self.assertEqual(classify('Missing vocal phrase',context)[:2],('vocal_dropout','review'))
        context['vocal_warnings_enabled'] = True
        self.assertEqual(classify('Missing vocal phrase',context)[:2],('vocal_dropout','retry'))
        self.assertEqual(classify('Ending needs completion',{'ending_attempted':True})[:2],('unfinished_ending','review'))
    def test_retry_batch_is_bounded_and_dry_run_only_observes(self):
        with tempfile.TemporaryDirectory() as root:
            api=FakeAPI([prompt(str(i)) for i in range(5)]);cfg=self.config(root)
            report=scan(cfg,api,enabled=False);self.assertEqual(api.calls,[]);self.assertEqual(report['needs_attention'],5)
            report=scan(cfg,api);self.assertEqual(len(api.calls),2)
    def test_dropout_intervals_match_real_olivia_failure_and_reject_large_or_invalid_repairs(self):
        rows=intervals("AssertionError: ('Missing vocal phrase', [182.2, 182.4, 182.6])",283.2)
        self.assertEqual(rows,[{'label':'phrase-1','context':[176,190],'patch':[181.85,183.5]}])
        for text in ["('Missing vocal phrase', [-1])","('Missing vocal phrase', [300])","('Missing vocal phrase', [1, 3, 5, 7])"]:
            with self.assertRaises(ValueError):intervals(text,283.2)
        self.assertEqual(intervals('unrelated failure',283.2),[])
    def test_interrupted_voice_repair_resumes_but_applied_or_failed_does_not(self):
        import uuid
        with tempfile.TemporaryDirectory() as root:
            work=Path(root)/('troofs-desktop-'+str(uuid.uuid5(uuid.NAMESPACE_URL,'prompt')));work.mkdir()
            save(work/'desktop-status.json',{'status':'failed','stage':'finish','error':'Missing vocal phrase'})
            request={'prompt_id':'prompt','directory':root,'config':{'automatic_vocal_repair':True,'engine_resources':root,
                     'settings':{'studio_dir':str(Path(root)/'studio'),'voice_python':'python'}}}
            with patch('renderer.subprocess.run') as run:
                self.assertFalse(vocal_recovery(request,pending_only=True));run.assert_not_called()
                save(work/'vocal-repair/status.json',{'status':'applying'})
                self.assertTrue(vocal_recovery(request,pending_only=True));run.assert_called_once()
                for status in ('failed','applied'):
                    save(work/'vocal-repair/status.json',{'status':status})
                    self.assertFalse(vocal_recovery(request))

if __name__=='__main__':unittest.main()
