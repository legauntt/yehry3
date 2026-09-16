"""Freeze V8 controls into each new job's actual composition and mix recipes."""
from pathlib import Path
from common import save, sha
from generation_controls import normalize, arrangement_guidance, synthesis_options


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('Unsupported recipe for V8 controls; the original recipe is retained')
    return source.replace(old, new, 1)


def configure(work, track, spec, plan):
    options = normalize(plan.get('generation'))
    if not options: return
    work = Path(work)
    # The studio's legacy caption includes four-four and permission for unintelligible
    # endings. Build a coherent new caption from the frozen arrangement and selections.
    track['caption'] = (spec['arrangement'].strip() + ' ' + arrangement_guidance(options) +
        'A rough smoky older male singer with connected vowels, loose phrasing and a catchable hook. '
        'Complete the written final verse and chorus; keep closing words meaningful. '
        'Unless explicitly requested in the arrangement, do not fill the ending with screamed syllables or a repeated earlier verse. '
        f"Requested pulse {track['bpm']} BPM, {track['keyscale']}. ")
    track['allow_long_instrumental_outro'] = plan.get('allow_long_instrumental_outro', False)
    track['generation'] = options
    track['generation_native'] = synthesis_options(options)
    # Supplied fields must survive the LM stage; its audio codes remain unchanged.
    pinned = ['duration', 'bpm', 'keyscale', 'seed', 'lm_seed', 'lyrics', 'caption']
    source_path = work / ('generate_base.py' if (work / 'generate_base.py').exists() else 'generate_song.py')
    original = source_path.read_text('utf-8')
    source = replace_once(original, "    save(HERE/'request.json',req)",
        "    req.update(CONFIG['generation_native'])\n    save(HERE/'request.json',req)")
    source = replace_once(source, "        save(HERE/'planned-request.json',planned)",
        f"        planned.update({{k:req[k] for k in {pinned!r}}})\n"
        "        planned.update({k:v for k,v in CONFIG['generation_native'].items() if v != ''})\n        save(HERE/'planned-request.json',planned)")
    compile(source, str(source_path), 'exec')
    # Change the mixing equation before peak/codec validation, preserving those checks.
    finish_path = work / ('finish_versioned.py' if (work / 'finish_versioned.py').exists() else 'finish_song.py')
    finish_original = finish_path.read_text('utf-8')
    finish = replace_once(finish_original, "mix=backing+voice*10**(cfg['vocal_gain_db']/20)",
        "mix=backing*10**(track['generation']['backingGainDb']/20)+voice*10**((cfg['vocal_gain_db']+track['generation']['vocalGainDb'])/20)")
    compile(finish, str(finish_path), 'exec')
    report = {'version': 1, 'options': options, 'native': track['generation_native'],
              'prior_recipe_sha256': {source_path.name: sha(source_path), finish_path.name: sha(finish_path)},
              'musical_targets_require_listening': True}
    source_path.write_text(source, encoding='utf-8')
    finish_path.write_text(finish, encoding='utf-8')
    report['recipe_sha256'] = {p.name: sha(p) for p in (source_path, finish_path)}
    save(work / 'generation-controls.json', report)
