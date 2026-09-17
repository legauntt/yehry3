import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from common import fingerprint, load, save
import lyric_constraints as lc
from planner import make_plan
from test_planner import fixture, PlannerTests
from winprocess import Stopped

class LyricConstraintTests(unittest.TestCase):
    def test_numeric_directives_and_boundaries(self):
        cases = {
            'Write between 260 and 350 words.': (260,350),
            'Keep the lyrics to 250–330 words.': (250,330),
            'Exactly 480 words': (480,480),
            'Use a total of 120 lyric words': (120,120),
            'No more than 150 words': (0,150),
            'At most 160 words': (0,160),
            'Do not exceed 200 words': (0,200),
            'No fewer than 90 words': (90,None),
            'At least 100 words': (100,None),
            'Under 100 words': (0,99),
            'More than 100 words': (101,None),
            'Word count: 100-160 words': (100,160),
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(lc.extract(text),[dict(minimum=expected[0],maximum=expected[1])])
    def test_creative_data_is_not_a_whole_sheet_limit(self):
        for text in ['He said exactly 10 words.', 'Write a song about a man who knows exactly 10 words.',
                     'The verse has exactly 40 words', 'Exactly 40 words per verse',
                     'Use exactly 10 words in each line', 'Do not use exactly 100 words',
                     'Keep the line “exactly 50 words” intact', 'A letter with no more than 10 words',
                     "Sing 'under 20 words' twice", 'About 200 words', 'Roughly 200-300 words']:
            with self.subTest(text=text):self.assertEqual(lc.extract(text),[])
    def test_counting_omits_known_labels_only(self):
        self.assertEqual(lc.lyric_words("[Verse 2]\nI'm blue-eyed, café don't.\n[Chorus]\nI'm blue-eyed.\n[unknown phrase]\n[End]"),
                         ["I'm",'blue-eyed','café',"don't","I'm",'blue-eyed','unknown','phrase'])
    def job(self, root, outputs, text='Keep the lyrics to 70-90 words.'):
        config,brief,calls,mocked=PlannerTests().run_feedback_case(root,outputs)
        brief.update(prompt=text,details={'voiceModel':'v8','generation':{'version':1}})
        return config,brief,calls,mocked
    def test_measured_correction_and_lost_cache_reuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bad={**fixture(),'lyrics':fixture()['lyrics'].replace('[End]', ' extra'*30+'\n[End]')}
            config,brief,calls,mocked=self.job(root,[bad,fixture()])
            with mocked:
                result=make_plan(config,brief,root,[])
                (root/'plan.json').unlink()
                self.assertEqual(make_plan(config,brief,root,[]),result)
            self.assertEqual(len(calls),2)
            self.assertIn('word count is 110',calls[1])
            self.assertIn('70–90',calls[1])
            self.assertEqual(load(root/'lyric-pacing.json')['words'],80)
            self.assertEqual([x['status'] for x in load(root/'planner-result-attempts.json')['attempts']],['invalid','accepted'])
    def test_budget_is_shared_and_survives_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);config,brief,calls,mocked=self.job(root,[fixture()],'At most 20 words.')
            with mocked:
                for _ in range(2):
                    with self.assertRaisesRegex(ValueError,'after 3 attempts.*word count is 80'):
                        make_plan(config,brief,root,[])
            self.assertEqual(len(calls),3)
            self.assertFalse((root/'plan.json').exists())
    def test_cancel_keeps_budget_and_first_private_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);config,brief,calls,mocked=self.job(root,[Stopped('Canceled')],'At most 20 words.')
            brief['adminNote']='Keep the lyrics to 70-90 words.'
            with mocked,self.assertRaises(Stopped):make_plan(config,brief,root,[])
            before=(root/'lyric-constraints.json').read_bytes()
            brief['adminNote']='At most 10 words.'
            def model(command,*args,**kwargs):save(Path(command[command.index('--output-last-message')+1]),fixture())
            with patch('planner.run_owned',side_effect=model) as resumed:make_plan(config,brief,root,[])
            self.assertEqual(resumed.call_count,1)
            self.assertEqual((root/'lyric-constraints.json').read_bytes(),before)
            self.assertEqual(len(load(root/'planner-result-attempts.json')['attempts']),2)
    def test_required_phrases_and_locks_are_checked_before_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            line='With a crooked grin, he polished the brass buckle.'
            good={**fixture(),'lyrics':'[Verse]\nShoes and boots.\n'+line+'\n'+'A rose upon the stairway, a knock upon the door.\n'*5+'[End]'}
            config,brief,calls,mocked=self.job(root,[fixture(),good],'Between 50 and 70 words.')
            brief['details']['generation'].update(requiredPhrases=['shoes','boots','crooked grin','brass buckle'],lockedLines=[line],avoidPhrases=['shoes','boots','crooked grin','brass'])
            with mocked:result=make_plan(config,brief,root,[])
            self.assertEqual(len(calls),2);self.assertIn('locked lyric line',calls[1])
            self.assertIn(line,result['lyrics']);self.assertEqual(load(root/'lyric-pacing.json')['words'],62)
    def test_preserve_conflict_can_explain_without_cutting_words(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);attention={**fixture(),'recipe':'needs_attention','lyrics':'','explanation':'Supplied words exceed the explicit limit.'}
            config,brief,calls,mocked=self.job(root,[fixture(),attention],'At most 20 words.')
            brief['details']['lyricSheet']={'mode':'preserve','text':fixture()['lyrics']}
            with mocked:result=make_plan(config,brief,root,[])
            self.assertEqual(result['recipe'],'needs_attention');self.assertEqual(len(calls),2)
            self.assertIn('word count is 80',calls[1]);self.assertIn('preserve-mode',calls[1])
            self.assertEqual(load(root/'planner-result.json')['lyrics'],fixture()['lyrics'])
    def test_old_jobs_and_v6_v7_stay_outside_new_policy(self):
        for marker in ['planning-input.json','plan.json','render-request.json','render-result.json','planner-result-attempts.json','material-planning-attempts.json']:
            with self.subTest(marker=marker),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);save(root/marker,{})
                self.assertIsNone(lc.prepare(root,{'prompt':'At most 2 words','details':{'voiceModel':'v8'}}))
        for version in ['v6','v7']:
            with tempfile.TemporaryDirectory() as tmp:
                self.assertIsNone(lc.prepare(tmp,{'prompt':'At most 2 words','details':{'voiceModel':version,'generation':{'version':1}}}))
    def test_density_is_advisory_and_long_ending_is_not_guessed(self):
        with tempfile.TemporaryDirectory() as tmp:
            contract=lc.prepare(tmp,{'prompt':'A sparse ballad','details':{'voiceModel':'v8'}})
            sparse={**fixture(),'duration':600}
            self.assertEqual(lc.validate(sparse,contract,tmp),sparse)
            evidence=lc.pacing({**sparse,'allow_long_instrumental_outro':True},contract)
            self.assertIsNone(evidence['available_vocal_seconds'])
            self.assertFalse(evidence['achieved_timing_verified'])
    def test_explicit_timing_and_input_fingerprint(self):
        with tempfile.TemporaryDirectory() as tmp:
            brief={'prompt':'At least 50 words','details':{'voiceModel':'v8','generation':{'version':1,'vocalEntry':5,'endingSeconds':20}}}
            contract=lc.prepare(tmp,brief)
            self.assertEqual(lc.pacing(fixture(),contract)['available_vocal_seconds'],245)
            with self.assertRaisesRegex(ValueError,'different planning inputs'):lc.prepare(tmp,{**brief,'prompt':'Changed'})
    def test_no_limit_is_inferred_from_supplied_lyrics_or_locked_words(self):
        with tempfile.TemporaryDirectory() as tmp:
            brief={'prompt':'Sing the supplied words','details':{'voiceModel':'v8','lyricSheet':{'text':'Exactly 20 words'},'generation':{'version':1,'lockedLines':['At most 3 words']}}}
            self.assertFalse(lc.prepare(tmp,brief)['explicit_limit'])

if __name__=='__main__':unittest.main()
