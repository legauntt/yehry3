import math
import tempfile
import unittest
from pathlib import Path
from quality_finish import compile_policy, review_outro, RULE
from renderer import execution_manifest, failure_detail, with_quality
from common import save
from publish import song_record


class QualityTests(unittest.TestCase):
    def test_long_outro_warns_but_integrity_assertions_still_stop_export(self):
        source = f"""assert voice_ok, 'Missing vocal phrase'
assert 0<post_vocal_seconds<=13,({RULE!r},post_vocal_seconds)
assert peak_ok, 'Encoded peak too loud'
exported=True
"""
        code = compile_policy(source, 'finisher.py')
        def run(seconds, voice=True, peak=True):
            issues=[]
            namespace={'voice_ok':voice,'peak_ok':peak,'post_vocal_seconds':seconds,
                       '_distonyc_review_outro':lambda value:review_outro(value,issues)}
            exec(code,namespace)
            self.assertTrue(namespace['exported'])
            return issues
        self.assertEqual(run(4.28), [])
        self.assertEqual(run(26.78), [{'code':'long_instrumental_outro','seconds':26.78}])
        for seconds in [0,-1,math.nan,math.inf]:
            with self.assertRaises(ValueError): run(seconds)
        with self.assertRaisesRegex(AssertionError,'Missing vocal'): run(26.78,voice=False)
        with self.assertRaisesRegex(AssertionError,'peak'): run(26.78,peak=False)
        with self.assertRaises(ValueError): compile_policy(source.replace('<=13','<=30'),'changed.py')

    def test_frozen_manifest_is_unchanged_and_warning_survives_publication(self):
        manifest={'kind':'new','workers':{'finish_song.py':'abc'},'tasks':[
            {'name':'generate','command':['python','generate.py']},
            {'name':'finish','command':['voice-python','saved/finish_song.py','--work','saved']}]}
        adapted=execution_manifest(manifest)
        self.assertEqual(manifest['tasks'][1]['command'][1],'saved/finish_song.py')
        self.assertEqual(adapted['tasks'][0],manifest['tasks'][0])
        self.assertTrue(adapted['tasks'][1]['command'][1].endswith('quality_finish.py'))
        with tempfile.TemporaryDirectory() as directory:
            issue={'code':'long_instrumental_outro','seconds':22.86}
            save(Path(directory)/'mix-results.json',{'qualityIssues':[issue]})
            result=with_quality({'work_path':directory})
            record=song_record({'songId':'song','releaseUrl':'https://example.com/song.mp3',
                'result':{**result,'title':'Samarie','duration':263.44}})
            self.assertEqual(record['qualityIssues'],[issue])

    def test_failure_uses_current_stage_and_cause(self):
        with tempfile.TemporaryDirectory() as directory:
            save(Path(directory)/'progress.json',{'stage':'Mastering and exporting','percent':86.7})
            detail=failure_detail({'directory':directory},RuntimeError('Needs attention.\nAssertionError: Missing vocal phrase\nLog: C:/private/finish.log'))
            self.assertIn('Mastering and exporting failed: AssertionError: Missing vocal phrase',detail['message'])
            self.assertNotIn('private',detail['message'])


if __name__=='__main__': unittest.main()
