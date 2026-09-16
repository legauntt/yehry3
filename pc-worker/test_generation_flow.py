import ast
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from common import load, save, sha, fingerprint
from generation_controls import normalize, constraints
from generation_runtime import configure
from generation_flow import approved_plan, candidate_request, composition_choice
from generation_candidates import prepare, selected
from composition_ending import CompositionReady, identifier
from test_planner import fixture


class GenerationFlowTests(unittest.TestCase):
    def test_worker_roundtrip_releases_both_reviews_then_publishes_one_selected_render(self):
        import sys
        from worker import run_once
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); directory=root/'jobs'/'flow-test'
            planned=constraints(fixture(), {'details':{'generation':{'version':1,'reviewLyrics':True,'candidates':2}}})
            prompt={'id':'flow-test','status':'processing','prompt':'A new song about a station', 'details':{'voiceModel':'v7','generation':planned['generation']}}
            reviews={}; timeline=[]; executions=[]
            class API:
                def call(self,path,body=None,**kwargs):
                    timeline.append(path)
                    if '/generation-review/' in path:return {'review':copy.deepcopy(reviews.get(path.rsplit('/',1)[1]))}
                    if path=='/claim':
                        self_test.assertIn('generation-v8-v1',body['capabilities']);prompt['status']='processing'
                    elif path.endswith('/generation-review'):
                        reviews[body['kind']]={'id':body['reviewId'],'kind':body['kind'],'payload':body['payload'],'state':'pending'}
                        prompt.update(status='queued',generationReview={'id':body['reviewId'],'kind':body['kind'],'state':'pending'})
                    elif path.endswith('/complete'):prompt.update(status='completed',result=body['result'])
                    elif path.endswith('/publishing'):prompt['status']='publishing'
                    elif path.endswith('/publish'):prompt.update(status='published',releaseUrl='https://example.com/fixture.mp3')
                    return {'prompt':copy.deepcopy(prompt)}
            self_test=self;api=API()
            def owned(command,*args,**kwargs):
                executions.append(command)
                if '--prepare-candidates' in command:
                    save(directory/'composition-review-offer.json',{'reviewId':'composition-test','kind':'composition','payload':{'candidates':[{'index':0},{'index':1}]}})
                else:save(directory/'render-result.json',{'status':'verified'})
            config={'state_dir':str(root),'generation_v8':True,'settings':{'python':sys.executable}}
            with patch('worker.basis_files',return_value=[]),patch('worker.make_plan',return_value=planned),patch('worker.run_owned',side_effect=owned), \
                 patch('worker.metadata',return_value=('fixture.mp3',{'title':planned['title']})),patch('worker.upload'),patch('worker.update_catalog'),patch('worker.register_remix'):
                run_once(config,api)
                self.assertEqual(prompt['generationReview']['kind'],'lyrics');self.assertEqual(executions,[]);self.assertFalse((root/'claim.json').exists())
                reviews['lyrics'].update(state='approved',decision={'action':'approve','lyrics':planned['lyrics']})
                prompt['generationReview']['state']='approved'
                run_once(config,api)
                self.assertEqual(prompt['generationReview']['kind'],'composition');self.assertEqual(len(executions),1);self.assertFalse((root/'claim.json').exists())
                reviews['composition'].update(state='approved',decision={'action':'approve','candidate':1})
                prompt['generationReview']['state']='approved'
                run_once(config,api)
            self.assertEqual(prompt['status'],'published');self.assertEqual(len(executions),2)
            self.assertEqual(load(directory/'composition-selection.json')['index'],1)
            self.assertEqual(sum(path.endswith('/complete') for path in timeline),1)
            self.assertFalse((root/'claim.json').exists())

    def test_actual_recipe_freezes_native_fields_and_mix_before_existing_peak_checks(self):
        recipes = Path(__file__).resolve().parents[2] / 'troofs-desktop/worker/recipes'
        if not recipes.exists(): self.skipTest('Installed Troofs recipe integration; verified on the production PC')
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            for style in ('song', 'opera'):
                for name, source in [('generate_song.py', f'generate_{style}.py'), ('finish_song.py','finish_song.py')]:
                    (work / name).write_bytes((recipes / source).read_bytes())
                options = normalize({'version': 1, 'bpm': 98, 'keyscale': 'D minor', 'meter': '3/4', 'instruments': ['piano','cello'], 'variation': 'adventurous', 'vocalGainDb': 2, 'backingGainDb': -3})
                track = {'caption': 'old four-four and unintelligible endings', 'bpm': 98, 'keyscale': 'D minor'}
                configure(work, track, {'arrangement': 'A piano waltz.'}, {'generation': options})
                self.assertNotIn('four-four', track['caption']); self.assertNotIn('unintelligible', track['caption'])
                self.assertIn('piano, cello', track['caption'])
                self.assertEqual(track['generation_native']['timesignature'], '3')
                self.assertEqual(track['generation_native']['lm_temperature'], .9)
                source = (work / 'generate_song.py').read_text('utf-8')
                self.assertIn("req.update(CONFIG['generation_native'])", source)
                self.assertIn("planned.update({k:v for k,v in CONFIG['generation_native'].items() if v != ''})", source)
                finish = ast.parse((work / 'finish_song.py').read_text('utf-8'))
                assignment = next(n for n in finish.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'mix' for t in n.targets))
                value = eval(compile(ast.Expression(assignment.value), 'mix', 'eval'), {'backing': .2, 'voice': .1, 'cfg': {'vocal_gain_db': 1}, 'track': track})
                self.assertAlmostEqual(value, .2 * 10**(-3/20) + .1 * 10**(3/20))
                self.assertIn('encoded_peak<10**(-.5/20)', (work / 'finish_song.py').read_text('utf-8'))

    def test_unknown_recipe_is_rejected_without_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary); (work/'generate_song.py').write_text('different recipe')
            (work/'finish_song.py').write_text('unchanged finisher')
            before = {p.name:p.read_bytes() for p in work.iterdir()}
            with self.assertRaises(ValueError): configure(work, {'bpm':100,'keyscale':'D minor'}, {'arrangement':'Band'}, {'generation':{'version':1}})
            self.assertEqual(before, {p.name:p.read_bytes() for p in work.iterdir()})

    def test_lyrics_pause_then_approval_reuses_original_and_rejects_changed_decision(self):
        with tempfile.TemporaryDirectory() as temporary:
            plan = constraints(fixture(), {'details': {'generation': {'version':1, 'reviewLyrics':True}}})
            original = copy.deepcopy(plan)
            prompt = {'id':'song','details': {'generation': plan['generation']}}
            class API:
                review = None
                def call(self, path): return {'review': self.review}
            api = API()
            proposed, offer = approved_plan(plan, prompt, temporary, [], api)
            self.assertIsNone(proposed)
            api.review = {'id':offer['reviewId'], 'kind':'lyrics','state':'approved','payload':offer['payload'], 'decision':{'action':'approve','lyrics':plan['lyrics'].replace('rose','light')}}
            accepted, pending = approved_plan(plan, prompt, temporary, [], api)
            self.assertIsNone(pending); self.assertNotEqual(accepted['lyrics'], plan['lyrics']); self.assertEqual(plan, original)
            self.assertEqual(approved_plan(plan, prompt, temporary, [], api)[0], accepted)
            api.review['decision']['lyrics'] = original['lyrics']
            with self.assertRaises(ValueError): approved_plan(plan, prompt, temporary, [], api)

    def request(self, root):
        return {'prompt_id':'request','directory':str(root/'job'),'basis':[], 'voice_model':'v7',
            'plan': {**fixture(), 'generation':normalize({'version':1,'candidates':2,'seed':123})},
            'config': {'settings': {'studio_dir':str(root/'studio'),'ffmpeg':'fixture-ffmpeg'}}}

    def test_candidates_resume_one_budget_and_only_convert_selected_with_audio_hashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); request=self.request(root); directory=Path(request['directory']); directory.mkdir()
            calls=[]
            def preflight(child, **kwargs):
                calls.append(child['prompt_id']); self.assertTrue(kwargs['preflight'])
                work=root/('troofs-desktop-'+identifier(child)); work.mkdir(exist_ok=True)
                for name in ('selected-mix.wav','selected-vocals.wav','selected-backing.wav'): (work/name).write_bytes(b'original audio')
                save(work/'track.json', {'duration':120,'lyrics':child['plan']['lyrics']})
                save(work/'desktop-job.json', {'tasks':[]}); save(work/'arrangement-checks.json', {'duration':120})
                raise CompositionReady(work)
            def ffmpeg(command, **kwargs): Path(command[-1]).write_bytes(b'ID3'+b'preview'*100)
            with patch('generation_candidates.subprocess.run',side_effect=ffmpeg):
                prepare(request,preflight); prepare(request,preflight)
            self.assertEqual(len(calls),2); self.assertEqual(load(directory/'composition-budget.json')['started'],[0,1])
            offer=load(directory/'composition-review-offer.json')
            class API:
                def call(self,path): return {'review': {'id':offer['reviewId'],'kind':'composition','state':'approved','payload':offer['payload'],'decision':{'action':'approve','candidate':1}}}
            self.assertIsNone(composition_choice(request,{'id':'request'},API()))
            converted=[]
            self.assertEqual(selected(request, lambda child: converted.append(child) or {'status':'verified'}), {'status':'verified'})
            self.assertEqual(len(converted),1); self.assertTrue(converted[0]['prompt_id'].endswith('-1'))
            self.assertEqual(converted[0]['plan']['generation']['seed'],1132)
            report=load(directory/'composition-candidates.json')
            (Path(report['candidates'][0]['work'])/'selected-mix.wav').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'candidate changed'): selected(request, lambda child: self.fail('must not convert'))

    def test_candidate_interruption_resumes_same_id_and_rejects_budget_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); request=self.request(root); Path(request['directory']).mkdir()
            calls=[]
            def interrupted(child, **kwargs): calls.append(child['prompt_id']); raise OSError('interrupted')
            for _ in range(2):
                with self.assertRaises(OSError): prepare(request, interrupted)
            self.assertEqual(calls[0],calls[1]); self.assertEqual(load(Path(request['directory'])/'composition-budget.json')['started'],[0])
            changed=copy.deepcopy(request); changed['plan']['generation']['candidates']=3
            with self.assertRaises(ValueError): prepare(changed,interrupted)
            self.assertEqual(len(calls),2)


if __name__ == '__main__': unittest.main()
