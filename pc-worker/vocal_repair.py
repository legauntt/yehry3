"""Recover short voice dropouts with new context, saved V6 and unchanged final checks."""
import argparse, ast, gc, importlib.util, math, re, shutil, sys
from pathlib import Path
from common import load, save, sha

def intervals(error, duration):
    match=re.search(r"Missing vocal phrase['\"]?,\s*(\[[^\]]*\])",error)
    if not match:return []
    values=ast.literal_eval(match.group(1))
    if not isinstance(values,list) or not values or any(type(t) not in (int,float) or not math.isfinite(t) or t<0 or t+.2>duration for t in values):
        raise ValueError('Invalid saved vocal-dropout intervals')
    groups=[]
    for t in sorted(set(values)):
        if groups and t-groups[-1][-1]<.201:groups[-1].append(t)
        else:groups.append([t])
    if len(groups)>3 or sum(g[-1]-g[0]+.2 for g in groups)>4:
        raise ValueError('Vocal dropout exceeds the automatic repair budget of three passages / four seconds')
    result=[]
    for index,g in enumerate(groups):
        a,b=max(0,g[0]-.35),min(duration,g[-1]+.9)
        start=max(0,min(math.floor(g[0]-6.2),duration-14))
        result.append({'label':f'phrase-{index+1}','context':[start,min(duration,start+14)],'patch':[a,b]})
    # Nearby windows share one contextual render, preserving one smooth patch.
    merged=[]
    for row in result:
        if merged and row['patch'][0]<=merged[-1]['patch'][1]:
            merged[-1]['patch'][1]=row['patch'][1]
            if row['patch'][1]>=merged[-1]['context'][1]-.2:raise ValueError('Repair context does not cover the merged passage')
        else:merged.append(row)
    return merged

def candidate(s, source, original, row, converted):
    """Assemble only the repaired passage, with the same envelope treatment as the saved recipe."""
    np=s.c.np;SR=44100
    start,end=row['context'];a,b=[round(t*SR) for t in row['patch']]
    old=source[round(start*SR):round(end*SR)].mean(axis=1)
    new=np.pad(converted,(0,max(0,len(old)-len(converted))))[:len(old)].copy()
    x,y=s.env(old)[::220],s.env(new)[::220];scores=[]
    for lag in range(-24,25):
        xx,yy=(x[:-lag],y[lag:]) if lag>0 else ((x[-lag:],y[:lag]) if lag<0 else (x,y))
        corr=float(np.corrcoef(xx,yy)[0,1])
        if np.isfinite(corr):scores.append((corr,lag))
    corr,lag=max(scores);shift=lag*220
    if corr<.75 or abs(shift/SR)>.05:raise ValueError('Repaired phrase did not preserve timing')
    if shift>0:new=np.pad(new[shift:],(0,shift))
    if shift<0:new=np.pad(new[:shift],(-shift,0))
    envelope=s.env(old);active=envelope>max(float(envelope.max())*.04,.001)
    new*=s.rms(old[active])/s.rms(new[active]);new*=s.connected_gate(envelope,SR)
    new*=s.rms(old[active])/s.rms(new[active])
    old_long=np.sqrt(np.maximum(s.uniform_filter1d(old*old,size=round(.8*SR)),0)+1e-10)
    new_long=np.sqrt(np.maximum(s.uniform_filter1d(new*new,size=round(.8*SR)),0)+1e-10)
    dynamics=np.clip(old_long/np.maximum(new_long,.003),10**(-4/20),10**(4/20))
    new*=s.uniform_filter1d(dynamics,size=round(.35*SR))
    clip=new[a-round(start*SR):b-round(start*SR)]
    weight=np.ones(len(clip),dtype='float32');edge=min(round(.2*SR),len(clip)//2)
    weight[:edge]=np.linspace(0,1,edge);weight[-edge:]=np.linspace(1,0,edge)
    result=original.copy();result[a:b]=original[a:b]*(1-weight[:,None])+clip[:,None]*weight[:,None]
    assert np.array_equal(result[:a],original[:a]) and np.array_equal(result[b:],original[b:])
    return result,{'envelope_correlation':corr,'shift_seconds':shift/SR,'patch':row['patch']}

def missing_windows(s, source, voice):
    weak=[];run=longest=0.;previous=-10
    for a in range(0,len(voice)-8820,8820):
        old,new=s.rms(source[a:a+8820]),s.rms(voice[a:a+8820]);t=a/44100
        if old>10**(-35/20) and new<min(old/8,10**(-45/20)):
            run=run+.2 if abs(t-previous-.2)<.001 else .2;previous=t;longest=max(longest,run);weak.append(t)
    return weak,longest

def recover(work, engine_resources):
    work=Path(work).resolve();root=work/'vocal-repair';root.mkdir(exist_ok=True)
    status_path=root/'status.json'
    status=load(status_path) if status_path.exists() else None
    if status and status['status']=='applied':return
    if status and status['status']=='failed':raise ValueError('Automatic vocal repair was already attempted; inspect vocal-repair diagnostics')
    sys.path.insert(0,str(engine_resources));import engine_tasks as engine
    manifest=load(work/'desktop-job.json');engine.validate_saved(work,manifest)
    if manifest['kind']!='new':raise ValueError('Automatic voice recovery requires the saved new-song recipe')
    with engine.gpu_lock(manifest['settings']['studio_dir']):
        spec=importlib.util.spec_from_file_location('saved_voice_repair_recipe',work/'convert_song.py')
        s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
        c=s.c;np,sf=c.np,c.sf;SR=44100
        def read(p):
            x,sr=sf.read(p,dtype='float32',always_2d=True)
            assert sr==SR and np.isfinite(x).all();return x
        if status is None:
            state=load(work/'desktop-status.json')
            assert state['status']=='failed' and state['stage']=='finish'
            rows=intervals(state.get('error',''),sf.info(work/'selected-vocals.wav').duration)
            if not rows:raise ValueError('No bounded vocal phrase was identified')
            backup=root/'originals';backup.mkdir(exist_ok=True)
            names=['matched-vocals.wav','matched-mix.wav','voice-checks.json','voice-assembly.json','desktop-status.json','matched-vocals-words.json']
            for name in names:shutil.copy2(work/name,backup/name)
            original_files=[work/'selected-vocals.wav',work/'selected-backing.wav',work/'desktop-job.json',work/'track.json',*sorted((work/'conversion').glob('*-converted.wav'))]
            status={'status':'rendering','version':1,'rows':rows,'completed':[],
                    'originals':{str(p.relative_to(work)):sha(p) for p in original_files},
                    'raw_source_voice_blend':0,'new_training':False,'pitch_shift':0,'checks_and_thresholds_unchanged':True}
            save(status_path,status)
        for name,digest in status['originals'].items():assert sha(work/name)==digest,name
        try:
            source=read(work/'selected-vocals.wav');voice=read(root/'originals/matched-vocals.wav')
            conversion_rows=load(work/'conversion-plan.json')['chunks'];details=[]
            def stage(name,fn):
                if name in status['completed']:return
                print('Vocal recovery:',name,flush=True);fn();status['completed'].append(name);save(status_path,status)
            for row in status['rows']:
                start,end=row['context'];label=row['label'];c.OUT=root/label;c.OUT.mkdir(exist_ok=True);c.LABELS=[label]
                def prepare():
                    wave=c.normalized(source[round(start*SR):round(end*SR)].mean(axis=1));edge=round(.015*SR)
                    wave[:edge]*=np.linspace(0,1,edge);wave[-edge:]*=np.linspace(1,0,edge)
                    sf.write(c.OUT/(label+'.wav'),wave,SR,subtype='PCM_24')
                    anchor_row=min(conversion_rows,key=lambda r:abs(sum(r['interval'])/2-sum(row['patch'])/2))
                    ref=load(work/'conversion'/(anchor_row['label']+'-reference.json'))['reference']
                    for suffix in ['.wav','-semantic.npy','-f0.npy','-mel.npy','-style.npy']:
                        shutil.copy2(Path(ref['directory'])/(ref['label']+suffix),c.OUT/('tony-anchor'+suffix))
                    shutil.copy2(work/'conversion/tony-multiple-songs-style.npy',c.OUT/'tony-multiple-songs-style.npy')
                    save(c.OUT/'reference.json',ref)
                stage(label+':prepare',prepare);stage(label+':features',c.features)
                def pitch():
                    c.pitch();fresh=np.load(c.OUT/(label+'-f0.npy'));original=np.zeros_like(fresh)
                    cached={r['label']:np.load(work/'conversion'/(r['label']+'-f0.npy')) for r in conversion_rows}
                    for i,t in enumerate(start+np.arange(len(fresh))*.01):
                        choices=[r for r in conversion_rows if r['interval'][0]<=t<=r['interval'][1]]
                        if not choices:continue
                        selected=min(choices,key=lambda r:abs(sum(r['interval'])/2-t));f0=cached[selected['label']]
                        original[i]=f0[min(round((t-selected['interval'][0])/.01),len(f0)-1)]
                    np.save(c.OUT/(label+'-f0.npy'),original)
                stage(label+':pitch',pitch)
                def diffuse():
                    c.torch.backends.mkldnn.enabled=True;c.torch.backends.cuda.enable_flash_sdp(True)
                    model=c.load_conversion_model();modules=s.install(model)
                    checkpoint=c.torch.load(s.EXP/'tony-catalog-adapter.pt',map_location='cpu',weights_only=True)
                    s.restore(modules,checkpoint['adapter'],checkpoint['recommended_strength']);s.offload_forward(model.cfm.estimator)
                    with c.torch.autocast('cpu',enabled=False):c.diffuse('tony-multiple-songs',30,source=label,model=model,output=label)
                    del model,modules,checkpoint;gc.collect();c.torch.cuda.empty_cache()
                stage(label+':diffuse',diffuse)
                def vocode():
                    from modules.bigvgan.bigvgan import BigVGAN
                    c.torch.backends.mkldnn.enabled=True
                    model=BigVGAN.from_pretrained(str(c.MODELS/'bigvgan'),use_cuda_kernel=False,local_files_only=True).eval();model.remove_weight_norm()
                    assert not model.use_tanh_at_final
                    model.conv_post.register_forward_hook(lambda module,inputs,output:output*.25);s.offload_forward(model)
                    c.vocode(label,model=model)
                    del model;gc.collect();c.torch.cuda.empty_cache()
                stage(label+':vocode',vocode)
                raw=read(c.OUT/(label+'-converted.wav')).mean(axis=1)
                voice,detail=candidate(s,source,voice,row,raw)
                from modules.rmvpe import RMVPE
                c.torch.backends.mkldnn.enabled=False;c.torch.set_num_threads(2)
                model=RMVPE(str(c.MODELS/'rmvpe.pt'),is_half=False,device='cpu')
                expected=np.load(c.OUT/(label+'-f0.npy'))
                with c.torch.inference_mode():
                    actual=model.infer_from_audio(c.torch.from_numpy(c.resample_poly(voice[round(start*SR):round(end*SR)].mean(axis=1),160,441).astype('float32')),thred=.03)
                a,b=[round((t-start)/.01) for t in row['patch']];n=min(len(actual),len(expected),b)
                old,new=expected[a:n],actual[a:n];mutual=(old>1)&(new>1)
                if mutual.sum()>10:
                    cents=1200*np.abs(np.log2(new[mutual]/old[mutual]));median=float(np.median(cents))
                    assert median<60,('Repaired pitch changed',median)
                    detail.update(median_pitch_error_cents=median,mutually_voiced_frames=int(mutual.sum()))
                else:
                    # Unpitched consonants/breaths may be repaired, but cannot become a new sustained note.
                    assert (old>1).sum()<=10 and (new>1).sum()<=10,'Repaired phrase lost or invented sustained pitch'
                    detail.update(pitch_check_applicable=False,source_voiced_frames=int((old>1).sum()),converted_voiced_frames=int((new>1).sum()))
                details.append(detail);del model;gc.collect()
            weak,longest=missing_windows(s,source,voice)
            assert longest<=.4,('Repaired voice still has a missing phrase',weak)
            assert np.isfinite(voice).all() and float(np.max(np.abs(voice)))<.999
            report={'status':'validated','patches':details,'weak_windows':weak,'longest_missing_vocal_run_seconds':longest,
                    'original_chunks_preserved':len(conversion_rows),'unchanged_samples_outside_patches':True,'new_training':False,'raw_source_voice_blend':0,'listening_review':False}
            sf.write(root/'repaired-vocals.wav',voice,SR,subtype='FLOAT')
            sf.write(root/'repaired-mix.wav',read(work/'selected-backing.wav')+voice,SR,subtype='FLOAT')
            save(root/'validation.json',report);status['status']='applying';save(status_path,status)
            (root/'repaired-vocals.wav').replace(work/'matched-vocals.wav');(root/'repaired-mix.wav').replace(work/'matched-mix.wav')
            checks=load(root/'originals/voice-checks.json');checks['phrase_repair']=report;save(work/'voice-checks.json',checks)
            assembly=load(root/'originals/voice-assembly.json');assembly['phrase_repair']='vocal-repair/validation.json';save(work/'voice-assembly.json',assembly)
            journal=load(root/'originals/desktop-status.json');journal['completed']=[stage for stage in journal['completed'] if stage not in ('matched-words','finish','analysis')]
            save(work/'desktop-status.json',journal)
            status.update(status='applied',repaired_vocals_sha256=sha(work/'matched-vocals.wav'));save(status_path,status)
        except Exception as error:
            # If interrupted mid-apply, the complete candidate and originals can be replayed safely.
            if status['status']!='applying':status.update(status='failed',error=str(error)[:1500]);save(status_path,status)
            raise

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--work',required=True,type=Path);parser.add_argument('--engine-resources',required=True,type=Path);args=parser.parse_args()
    recover(args.work,args.engine_resources)
