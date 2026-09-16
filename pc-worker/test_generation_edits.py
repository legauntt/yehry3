import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf
from common import sha
from generation_edits import region,stems,mix,read,true_peak


class GenerationEditTests(unittest.TestCase):
    def fixture(self,root):
        rate=44100;t=np.arange(rate*3)/rate
        voice=np.column_stack([np.sin(2*np.pi*220*t)*.12]*2).astype('float32')
        backing=np.column_stack([np.sin(2*np.pi*165*t)*.18]*2).astype('float32')
        for name,data in [('matched-vocals.wav',voice),('selected-backing.wav',backing),('original.wav',voice+backing),('alternate.wav',voice-backing)]:sf.write(root/name,data,rate,subtype='PCM_24')
        return rate

    def test_region_preserves_original_and_every_sample_outside_bounded_transitions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);rate=self.fixture(root);original=root/'original.wav';alternate=root/'alternate.wav';before=sha(original)
            directory,report=region(original,alternate,.8,2.2,root/'revisions',.1)
            a,_=read(original);b,_=read(directory/'revision.wav')
            self.assertTrue(np.array_equal(a[:round(.8*rate)],b[:round(.8*rate)]));self.assertTrue(np.array_equal(a[round(2.2*rate):],b[round(2.2*rate):]))
            self.assertFalse(np.array_equal(a[rate:2*rate],b[rate:2*rate]));self.assertEqual(sha(original),before)
            self.assertEqual(region(original,alternate,.8,2.2,root/'revisions',.1),(directory,report))
            (directory/'revision.wav').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'revision file changed'):region(original,alternate,.8,2.2,root/'revisions',.1)

    def test_misaligned_or_unbounded_edits_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);self.fixture(root)
            for start,end,fade in [(-1,2,.1),(1,4,.1),(1,1.1,.2),(0,float('nan'),.1)]:
                with self.assertRaises(ValueError):region(root/'original.wav',root/'alternate.wav',start,end,root/'edits',fade)
            sf.write(root/'short.wav',np.zeros((44100,2),dtype='float32'),44100)
            with self.assertRaisesRegex(ValueError,'identical'):region(root/'original.wav',root/'short.wav',1,2,root/'edits')

    def test_stem_exports_retain_hashes_and_new_mix_checks_peaks_without_mutating_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);self.fixture(root)
            directory,report=stems(root,root/'stems')
            for name in ['matched-vocals.wav','selected-backing.wav']:self.assertEqual(sha(directory/name),sha(root/name))
            before={p.name:sha(p) for p in root.glob('*.wav')}
            output,result=mix(directory/'matched-vocals.wav',directory/'selected-backing.wav',root/'mixes',6,6)
            audio,_=read(output/'mix.wav');self.assertLess(true_peak(audio),10**(-.9/20))
            self.assertEqual(before,{p.name:sha(p) for p in root.glob('*.wav')});self.assertFalse(result['listening_accepted'])


if __name__=='__main__':unittest.main()
