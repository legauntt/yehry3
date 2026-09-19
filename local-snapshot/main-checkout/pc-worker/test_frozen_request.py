import copy
import tempfile
import unittest
from pathlib import Path
from common import load, sha
from frozen_request import reuse_or_save


class FrozenRequestTests(unittest.TestCase):
    def request(self):
        return {'config': {'settings': {'python': 'saved-python'}, 'automatic_outro_retry': True},
                'prompt_id': 'existing-request', 'directory': 'private-job', 'plan': {'lyrics': 'Frozen words'},
                'basis': [], 'voice_model': 'v7'}

    def test_added_runtime_capability_reuses_exact_frozen_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'render-request.json'; original=self.request()
            self.assertEqual(reuse_or_save(path, original), original)
            digest=sha(path); current=copy.deepcopy(original); current['config']['catalog_remix']=True
            current['config']['settings']['python']='current-python'
            self.assertEqual(reuse_or_save(path,current),original)
            self.assertEqual(sha(path),digest)
            self.assertEqual(load(path),original)

    def test_changed_creative_inputs_identity_and_voice_still_fail_closed(self):
        for field in ('prompt_id','directory','plan','basis','voice_model'):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'render-request.json'; original=self.request(); reuse_or_save(path,original)
                digest=sha(path); changed=copy.deepcopy(original); changed[field]='different'
                with self.assertRaisesRegex(ValueError,'changed'): reuse_or_save(path,changed)
                self.assertEqual(sha(path),digest)


if __name__=='__main__': unittest.main()
