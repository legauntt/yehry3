"""Bounded, persistent triage of Needs Attention requests via the existing admin API."""
import argparse, collections, hashlib, json, os, time, urllib.error, urllib.parse, urllib.request, uuid
from pathlib import Path
from common import inside, load, save, singleton, utc

POLICY_VERSION = 2
RETRY_DELAYS = (0, 15*60, 60*60)

class AdminAPI:
    def __init__(self, base, password):
        if not base.startswith('https://'): raise ValueError('Monitor API requires HTTPS')
        self.base = base.rstrip('/')
        self.headers = {'Content-Type':'application/json', 'X-Visitor-ID':str(uuid.uuid4())}
        self.headers['Authorization'] = 'Bearer ' + self.call('/session', 'POST', {'role':'admin','password':password})['token']
    def call(self, path, method='GET', body=None):
        req = urllib.request.Request(self.base+path, method=method, headers=self.headers,
            data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(req,timeout=30) as response: return json.load(response)
    def prompts(self):
        rows=[]; page=0
        while True:
            data=self.call('/admin/prompts?status=all&page='+str(page));rows+=data['prompts'];page+=1
            if len(rows)>=data['total']: return rows
            if page>100: raise ValueError('Monitor pagination exceeded its limit')
    def retry(self, prompt):
        return self.call('/admin/prompts/'+urllib.parse.quote(prompt['id'],safe=''), 'PATCH',
            {'action':'status','status':'queued','version':prompt['version']})['prompt']

def local_context(config, prompt_id):
    directory=inside(Path(config['state_dir'])/'jobs'/prompt_id,Path(config['state_dir'])/'jobs')
    context={'directory':str(directory),'has_plan':(directory/'plan.json').exists(),'ending_attempted':(directory/'ending-repair.json').exists()}
    context['vocal_warnings_enabled'] = config.get('vocal_dropout_warnings', False)
    request=directory/'render-request.json'
    if request.exists():
        context['has_request']=True
        ident=str(uuid.uuid5(uuid.NAMESPACE_URL,prompt_id+(':ending-v1' if context['ending_attempted'] else '')))
        work=Path(config['settings']['studio_dir']).parent/('troofs-desktop-'+ident)
        context['work']=str(work)
        for name,key in [('desktop-status.json','state'),('vocal-repair/status.json','voice_repair')]:
            if (work/name).exists():context[key]=load(work/name)
    result=directory/'render-result.json'
    if result.exists():context['has_result']=load(result).get('status')=='verified'
    return context

def classify(error, context):
    error=error.casefold()
    # Changed/missing inputs need an actual repair; retrying cannot restore them.
    if any(term in error for term in ('checksum','hash mismatch','saved worker changed','saved track changed','inputs changed','file changed','no such file','filenotfound','model is missing')):
        return 'saved_inputs', 'review', 'Restore the named input or reconcile its provenance before retrying.'
    if context.get('has_result'):
        return 'publication', 'retry', 'Reuse the verified export and retry publication.'
    if 'missing vocal phrase' in error:
        recovery=context.get('voice_repair',{})
        if recovery.get('status') in ('failed','applied'):
            if context.get('vocal_warnings_enabled') and context.get('state', {}).get('stage') == 'finish':
                return 'vocal_dropout', 'retry', 'Recheck source bleed, then publish the retained performance with a vocal issue notice if repair remains unresolved.'
            return 'vocal_dropout', 'review', 'A contextual voice repair has already been attempted; review its diagnostics.'
        if context.get('has_request') and context.get('state',{}).get('stage')=='finish':
            return 'vocal_dropout', 'retry', 'Rerender bounded vocal passages with the saved voice; preserve the rest of the song.'
        return 'vocal_dropout', 'review', 'The saved voice and finishing journal are needed for recovery.'
    if 'ending needs completion' in error or 'final vocal has no complete ending' in error:
        if context.get('ending_attempted'):
            return 'unfinished_ending', 'review', 'The longer ending attempt also failed; retain both renders for an arrangement repair.'
        return 'unfinished_ending', 'retry', 'Allow the renderer one longer composition attempt with a complete ending.'
    if 'long instrumental outro' in error or ('too much instrumental space' in error and context.get('has_request')):
        return 'musical_spacing', 'retry', 'Apply the current advisory policy; export with a visible musical warning when integrity passes.'
    if any(term in error for term in ('out of memory','cuda error','cublas','gpu memory')):
        return 'gpu_resources', 'retry', 'Retry saved stages after a cooldown; do not retrain or restart completed stages.'
    if any(term in error for term in ('timeout','timed out','connection','temporary','temporarily','winerror 32','winerror 33','sharing violation','502','503','504','lease expired')):
        return 'transient_runtime', 'retry', 'Retry saved work with increasing cooldowns.'
    if any(term in error for term in ('peak','clipped','nonfinite','nan','pitch error','insufficient mutually voiced','ending tail remains loud')):
        return 'audio_integrity', 'review', 'Inspect the signal and repair the affected audio before export.'
    if any(term in error for term in ('recipe','lyrics','plan','unsupported','needs_attention')):
        return 'creative_plan', 'review', 'Review the saved plan and supported recipe; retain the original brief.'
    return 'unknown', 'review', 'Keep the error and stage diagnostics for a new recovery rule.'

def signature(category, error):
    return hashlib.sha256((category+'\n'+error.strip()).encode()).hexdigest()[:16]

def due(entry, now, maximum=3):
    attempts=[a for a in entry.get('attempts',[]) if a.get('policy_version',1)==POLICY_VERSION]
    # Budget is per request as well as per cause: changing messages cannot create an infinite loop.
    if len(attempts)>=maximum:return False
    if not attempts:return True
    return now-attempts[-1]['at_epoch']>=RETRY_DELAYS[min(len(attempts),len(RETRY_DELAYS)-1)]

def retry_budget(entry, category):
    if len([a for a in entry.get('attempts',[]) if a.get('policy_version',1)==POLICY_VERSION])>=3:return False
    if category in ('vocal_dropout','unfinished_ending','musical_spacing'):
        return not any(a['category']==category and a.get('policy_version',1)==POLICY_VERSION for a in entry.get('attempts',[]))
    return True

def report_markdown(report):
    rows=['# Distonyc queue monitor','',f"Updated {report['at']}. Scheduled every 5 minutes while Jesse is signed in and the PC is awake.",'',
        f"Needs Attention: {report['needs_attention']}. Recovering: {report['recovering']}. Resolved after being observed: {report['resolved']}. Retried this check: {report['retried']}.",'',
        'Musical spacing is advisory. Vocal dropouts receive a bounded audio repair. Other causes use cooldowns or remain available for review.','',
        '| Category | Needs Attention | Resolved |','| --- | ---: | ---: |']
    for category in sorted(set(report['open_by_category'])|set(report['resolved_by_category'])):
        rows.append(f"| {category} | {report['open_by_category'].get(category,0)} | {report['resolved_by_category'].get(category,0)} |")
    rows+=['','## Requests','']
    for row in report['requests']:
        title=row['prompt'].replace('\n',' ').replace('|','/')
        rows += [f"- **{row['status']} / {row['category']}** — {title}",f"  {row['next_action']} Attempts: {row['attempts']}. ID: `{row['id']}`"]
    if not report['requests']:rows+=['No failures have been observed yet.']
    rows+=['','## Recent checks','','| Time (UTC) | Needs Attention | Recovering | Resolved |','| --- | ---: | ---: | ---: |']
    for point in report['history'][-24:]:rows.append(f"| {point['at']} | {point['needs_attention']} | {point['recovering']} | {point['resolved']} |")
    return '\n'.join(rows)+'\n'

def scan(config, api, now=None, enabled=True):
    now=time.time() if now is None else now
    root=Path(config['state_dir'])/'monitor';root.mkdir(parents=True,exist_ok=True)
    path=root/'ledger.json'; ledger=load(path) if path.exists() else {'version':1,'requests':{},'history':[]}
    prompts=api.prompts(); seen={p['id']:p for p in prompts};retried=0
    for prompt in prompts:
        ident=prompt['id'];entry=ledger['requests'].get(ident)
        if prompt['status']=='failed':
            error=str(prompt.get('workerError','Unknown failure'))
            try:
                context=local_context(config,ident)
                category,action,reason=classify(error,context)
            except (OSError,ValueError,KeyError) as local_error:
                category,action,reason='saved_inputs','review','Saved job metadata could not be read. Restore it before retrying.'
                error+=' Local metadata: '+str(local_error)[:500]
            if entry is None:entry={'first_seen':utc(),'attempts':[]};ledger['requests'][ident]=entry
            entry.update(id=ident,prompt=prompt.get('prompt',''),status='failed',category=category,error=error,
                         next_action=reason,signature=signature(category,error),last_seen=utc(),policy_version=POLICY_VERSION)
            # An interrupted network response is reconciled from server state before another retry.
            pending=entry.get('pending_retry')
            if pending and pending['version']!=prompt['version']:
                entry.pop('pending_retry');save(path,ledger)
            allowed=action=='retry' and not prompt.get('workerActive') and due(entry,now) and retry_budget(entry,category)
            if enabled and allowed and retried<2:
                if not pending:
                    attempt={'at_epoch':now,'at':utc(),'category':category,'signature':entry['signature'],'policy_version':POLICY_VERSION}
                    entry['attempts'].append(attempt)
                    entry['pending_retry']={'version':prompt['version'],'at_epoch':now}
                    save(path,ledger)
                try:updated=api.retry(prompt)
                except urllib.error.HTTPError as error:
                    if error.code!=409:raise
                    entry['next_action']='Request changed during the check; reconcile on the next pass.'
                    entry.pop('pending_retry',None);save(path,ledger);continue
                entry.update(status=updated['status'],next_action='Queued to resume saved work.');entry.pop('pending_retry',None)
                seen[ident]=updated;retried+=1;save(path,ledger)
            elif action=='retry' and not retry_budget(entry,category):
                entry['next_action']='Automatic retry budget exhausted. Review this cause before enabling another attempt.'
            elif action=='retry' and not due(entry,now):entry['next_action']='Cooling down before the next saved-work retry.'
        elif entry is not None:
            entry['status']=prompt['status'];entry.pop('pending_retry',None)
            if prompt['status']=='published':
                entry.setdefault('resolved_at',utc());entry['next_action']='Published successfully; retained as evidence for this recovery category.'
            elif prompt['status']=='canceled':entry['next_action']='Canceled; monitor will take no action.'
    entries=list(ledger['requests'].values())
    opened=[e for e in entries if e['status']=='failed'];resolved=[e for e in entries if e['status']=='published']
    recovering=[e for e in entries if e['status'] in ('queued','processing','completed','publishing')]
    point={'at':utc(),'needs_attention':sum(p['status']=='failed' for p in seen.values()),'recovering':len(recovering),'resolved':len(resolved)}
    ledger['history']=(ledger['history']+[point])[-2016:];save(path,ledger)
    report={**point,'status':'ok','retried':retried,'policy_version':POLICY_VERSION,
            'open_by_category':dict(collections.Counter(e['category'] for e in opened)),
            'resolved_by_category':dict(collections.Counter(e['category'] for e in resolved)),
            'requests':[{k:e[k] for k in ('id','prompt','status','category','next_action')}|{'attempts':len(e['attempts'])} for e in entries],
            'history':ledger['history']}
    save(root/'report.json',report);(root/'report.md').write_text(report_markdown(report),encoding='utf-8')
    return report

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True,type=Path);parser.add_argument('--observe-only',action='store_true');args=parser.parse_args()
    config=load(args.config);root=Path(config['state_dir'])/'monitor';root.mkdir(parents=True,exist_ok=True)
    password=os.environ.pop('DISTONYC_MONITOR_PASSWORD','')
    if not password:raise ValueError('The monitor DPAPI credential was not loaded')
    with singleton(root/'monitor.lock') as acquired:
        if not acquired:return
        try:
            api=AdminAPI(config['api'],password);del password
            report=scan(config,api,enabled=not args.observe_only)
            save(root/'health.json',{k:report[k] for k in ('at','status','needs_attention','recovering','resolved','retried')})
            print(json.dumps({k:report[k] for k in ('at','status','needs_attention','recovering','resolved','retried')}))
        except Exception as error:
            save(root/'health.json',{'at':utc(),'status':'monitor_error','error':str(error)[:1000]})
            raise

if __name__=='__main__':main()
