"""Local, revisioned WAV edits and stem exports. Never publish or mutate source audio."""
import argparse
import math
import shutil
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from common import fingerprint, load, save, sha


def read(path):
    path = Path(path).resolve()
    if path.suffix.lower() != '.wav': raise ValueError('Use a lossless WAV for editing')
    audio, rate = sf.read(path, dtype='float32', always_2d=True)
    if rate not in (44100, 48000) or audio.shape[1] not in (1, 2) or not len(audio) or not np.isfinite(audio).all():
        raise ValueError('Use a finite mono or stereo WAV at 44.1 or 48 kHz')
    return audio, rate


def true_peak(audio):
    maximum = 0.
    for start in range(0, len(audio), 176400):
        section = audio[max(0, start-100):min(len(audio),start+176500)]
        maximum = max(maximum, float(np.max(np.abs(resample_poly(section, 4, 1, axis=0)))))
    return maximum


def revision(output_root, inputs):
    identity = fingerprint(inputs)
    root = Path(output_root).resolve() / identity[:20]
    if root.exists() and (root / 'revision.json').exists():
        report = load(root / 'revision.json')
        if report.get('inputs') != inputs: raise ValueError('Existing revision identity differs')
        for item in report['files']:
            if sha(root / item['name']) != item['sha256']: raise ValueError('An existing revision file changed')
        return root, report
    if root.exists() and any(root.iterdir()): raise ValueError('Incomplete revision exists; inspect it before making a new revision')
    root.mkdir(parents=True, exist_ok=True)
    return root, None


def finish(root, inputs, names, **evidence):
    result = {'version': 1, 'inputs': inputs, 'files': [{'name': name, 'sha256': sha(root/name), 'bytes': (root/name).stat().st_size} for name in names],
              'originals_retained': True, 'listening_accepted': False, 'published': False, **evidence}
    save(root/'revision.json', result)
    return root, result


def region(source, replacement, start, end, output_root, fade=.25):
    """Copy a region from an aligned alternate take; transitions stay inside it."""
    original, rate = read(source); alternate, other_rate = read(replacement)
    if rate != other_rate or original.shape != alternate.shape: raise ValueError('Region revisions require takes with identical sample rate, channels and length; no implicit stretching')
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in (start,end,fade)) or not 0 <= start < end <= len(original)/rate or not .01 <= fade <= 2 or 2*fade > end-start:
        raise ValueError('Choose an in-song region with room for both transitions (0.01–2 seconds each)')
    a,b,n = round(start*rate),round(end*rate),round(fade*rate)
    if 2*n > b-a: raise ValueError('Region is too short for the selected transitions')
    inputs = {'kind':'region_from_alternate_take','source_sha256':sha(source),'replacement_sha256':sha(replacement), 'start_sample':a,'end_sample':b,'fade_samples':n,'sample_rate':rate,'tool_sha256':sha(__file__)}
    root, saved = revision(output_root,inputs)
    if saved: return root,saved
    mix = original.copy()
    weight = np.ones((b-a,1),dtype='float32'); ramp=np.linspace(0,1,n,dtype='float32')[:,None]
    weight[:n]=ramp;weight[-n:]=ramp[::-1]
    mix[a:b] = original[a:b]*(1-weight)+alternate[a:b]*weight
    peak = true_peak(mix)
    if peak > 10**(-.5/20): raise ValueError('Region revision exceeds the peak ceiling; choose another passage or lower its source level before editing')
    sf.write(root/'revision.wav',mix,rate,subtype='FLOAT')
    decoded,_=read(root/'revision.wav')
    if not np.array_equal(decoded[:a],original[:a]) or not np.array_equal(decoded[b:],original[b:]) or not np.array_equal(decoded,mix):
        raise ValueError('Samples outside the selected region did not remain exact')
    return finish(root,inputs,['revision.wav'],sample_rate=rate,duration=len(mix)/rate,true_peak_dbfs=20*math.log10(max(peak,1e-12)),outside_region_bit_exact=True,
                  note='Uses an existing aligned alternate take. It does not call a model or generate new lyrics.')


def stems(work, output_root):
    """Export source-aligned raw converted vocals/backing, with explicit provenance."""
    work = Path(work).resolve()
    names = ['matched-vocals.wav','selected-backing.wav']
    voice, rate = read(work/names[0]); backing, other_rate=read(work/names[1])
    if rate != other_rate or voice.shape != backing.shape: raise ValueError('Stems are not aligned')
    inputs = {'kind':'source_aligned_stems','files':{name:sha(work/name) for name in names},'tool_sha256':sha(__file__)}
    root,saved=revision(output_root,inputs)
    if saved:return root,saved
    for name in names: shutil.copyfile(work/name,root/name)
    return finish(root,inputs,names,sample_rate=rate,duration=len(voice)/rate,
                  note='Raw converted voice and backing at source timing, before final mastering, reprises or quiet-tail edits. Individual instruments are not separated.')


def mix(vocals, backing, output_root, vocal_db=0, backing_db=0):
    voice,rate=read(vocals);band,other_rate=read(backing)
    if rate!=other_rate or voice.shape!=band.shape:raise ValueError('Mix stems must have matching sample rate, channels and length')
    if any(type(v) not in (int,float) or not math.isfinite(v) or not -12<=v<=6 for v in (vocal_db,backing_db)):raise ValueError('Levels must be between -12 and +6 dB')
    inputs={'kind':'stem_mix','vocals_sha256':sha(vocals),'backing_sha256':sha(backing),'vocal_db':vocal_db,'backing_db':backing_db,'tool_sha256':sha(__file__)}
    root,saved=revision(output_root,inputs)
    if saved:return root,saved
    combined=voice*10**(vocal_db/20)+band*10**(backing_db/20)
    peak=true_peak(combined); gain=min(1.,10**(-1/20)/max(peak,1e-12)); combined*=gain
    sf.write(root/'mix.wav',combined,rate,subtype='FLOAT')
    decoded,_=read(root/'mix.wav')
    if not np.array_equal(decoded,combined) or true_peak(decoded)>10**(-.9/20):raise ValueError('Mix integrity or peak verification failed')
    return finish(root,inputs,['mix.wav'],sample_rate=rate,duration=len(combined)/rate,peak_safety_gain_db=20*math.log10(gain),
                  note='A new local stem mix; listen for balance and endings before accepting it.')


def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    edit=sub.add_parser('region');edit.add_argument('--source',required=True,type=Path);edit.add_argument('--replacement',required=True,type=Path)
    edit.add_argument('--start',required=True,type=float);edit.add_argument('--end',required=True,type=float);edit.add_argument('--fade',type=float,default=.25)
    export=sub.add_parser('stems');export.add_argument('--work',required=True,type=Path)
    remix=sub.add_parser('mix');remix.add_argument('--vocals',required=True,type=Path);remix.add_argument('--backing',required=True,type=Path)
    remix.add_argument('--vocal-db',type=float,default=0);remix.add_argument('--backing-db',type=float,default=0)
    for command in (edit,export,remix):command.add_argument('--output',required=True,type=Path)
    args=parser.parse_args()
    if args.command=='region':root,_=region(args.source,args.replacement,args.start,args.end,args.output,args.fade)
    elif args.command=='stems':root,_=stems(args.work,args.output)
    else:root,_=mix(args.vocals,args.backing,args.output,args.vocal_db,args.backing_db)
    print(root/'revision.json')


if __name__=='__main__':main()
