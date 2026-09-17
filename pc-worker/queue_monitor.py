"""Bounded, persistent triage of Needs Attention requests via the existing admin API."""
import argparse, collections, hashlib, json, os, re, time, urllib.error, urllib.parse, urllib.request, uuid
from pathlib import Path
from common import inside, load, save, singleton, utc
from failure_evidence import evidence
from reliability_audit import metrics
from auto_shepherd import decide as shepherd_decide, eligible as shepherd_eligible
from delivery_check import verify_delivery

POLICY_VERSION = 4
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
    def recovery(self, prompt, phase):
        return self.call('/admin/prompts/'+urllib.parse.quote(prompt['id'],safe=''), 'PATCH',
            {'action':'recovery','phase':phase,'version':prompt['version']})['prompt']

def local_context(config, prompt_id):
    return evidence(config, prompt_id)

def classify(error, context):
    error=error.casefold()
    from music_backend import payment_attention
    if payment_attention(error):
        return 'paid_music', 'review', 'Review the saved paid reservation, budget or credential. Automatic recovery cannot authorize another charge.'
    # Changed/missing inputs need an actual repair; retrying cannot restore them.
    if any(term in error for term in ('checksum','hash mismatch','saved worker changed','saved track changed','inputs changed','file changed','no such file','filenotfound','model is missing')):
        return 'saved_inputs', 'review', 'Restore the named input or reconcile its provenance before retrying.'
    if context.get('has_result'):
        return 'publication', 'retry', 'Reuse the verified export and retry publication.'
    # Failed pitch assertions are integrity failures, even beside old network diagnostics.
    if (any(term in error for term in ('voice validation failed', 'vocal validation failed', 'pitch error', 'insufficient mutually voiced'))
            or re.search(r'(?:assert[^\n]*|assertionerror:)[^\n]*(?:median|p90)_pitch_error_cents', error)):
        return 'audio_integrity', 'review', 'Inspect the signal and repair the affected audio before export.'
    # Prefer the current validation failure over a stale authentication error in an append-only log.
    if any(term in error for term in ('invalid music settings','invalid planning result','keyscale','invalid tempo or duration')):
        if not context.get('has_request') and context.get('saved_planner_output') and context.get('planner_attempts',0)<3:
            return 'planner_format', 'retry', 'Normalize and reuse the saved output, or use only the remaining planning attempts.'
        return 'planner_format', 'review', 'Inspect the retained planning result; never replan started audio.'
    if any(term in error for term in ('invalid_organization','401 unauthorized','authentication required','insufficient_quota')):
        return 'authentication', 'review', 'Restore the configured service login or quota before resuming.'
    if 'unicodedecodeerror' in error or "'charmap' codec" in error:
        return 'unicode_runtime', 'retry', 'Resume the frozen recipe with the installed UTF-8 runtime wrapper.'
    if any(term in error for term in ('permissionerror','permission denied','winerror 5')):
        return 'windows_io', 'retry', 'Retry saved stages after a cooldown; retain any persistent access failure for review.'
    if 'missing vocal phrase' in error:
        recovery=context.get('voice_repair',{})
        if recovery.get('status') in ('failed','applied'):
            if context.get('vocal_warnings_enabled') and context.get('state', {}).get('stage') == 'finish':
                return 'vocal_dropout', 'retry', 'Recheck source bleed, then publish the retained performance with a vocal issue notice if repair remains unresolved.'
            return 'vocal_dropout', 'review', 'A contextual voice repair has already been attempted; review its diagnostics.'
        if context.get('has_request') and context.get('state',{}).get('stage')=='finish':
            if context.get('voice_model', 'v6') != 'v6' and context.get('vocal_warnings_enabled'):
                return 'vocal_dropout', 'retry', 'Publish the retained performance with a vocal issue notice; passage repair is not supported for this voice model.'
            return 'vocal_dropout', 'retry', 'Rerender bounded vocal passages with the saved voice; preserve the rest of the song.'
        return 'vocal_dropout', 'review', 'The saved voice and finishing journal are needed for recovery.'
    if 'ending needs completion' in error or 'final vocal has no complete ending' in error:
        if context.get('ending_attempted'):
            return 'unfinished_ending', 'review', 'The longer ending attempt also failed; retain both renders for an arrangement repair.'
        return 'unfinished_ending', 'retry', 'Allow the renderer one longer composition attempt with a complete ending.'
    if ('long instrumental outro' in error or 'long instrumental introduction' in error
            or ('too much instrumental space' in error and context.get('has_request'))):
        return 'musical_spacing', 'retry', 'Apply the current advisory policy; export with a visible musical warning when integrity passes.'
    if any(term in error for term in ('out of memory','cuda error','cublas','gpu memory')):
        return 'gpu_resources', 'retry', 'Retry saved stages after a cooldown; do not retrain or restart completed stages.'
    # Decimal signal measurements are not HTTP status codes.
    http_failure = re.search(r'\b(?:http(?:\s*error)?|status(?:\s+code)?)\s*[:=]?\s*(?:502|503|504)\b', error)
    http_failure = http_failure or re.search(r'(?<![\d.])(?:502\s+bad gateway|503\s+service unavailable|504\s+gateway timeout)\b', error)
    if http_failure or any(term in error for term in ('timeout','timed out','connection','temporary','temporarily','winerror 32','winerror 33','sharing violation','lease expired')):
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
    if category in ('vocal_dropout','unfinished_ending','musical_spacing','planner_format','unicode_runtime','shepherd'):
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
    prompts=api.prompts(); seen={p['id']:p for p in prompts};retried=0;consulted=0;checked_delivery=0
    deliveries=[p for p in prompts if p['status']=='published' and p['id'] in ledger['requests']
                and ledger['requests'][p['id']].get('delivery',{}).get('status')!='verified']
    delivery_id=min(deliveries,key=lambda p:ledger['requests'][p['id']].get('delivery_checked_epoch',0))['id'] if deliveries else None
    for prompt in prompts:
        ident=prompt['id'];entry=ledger['requests'].get(ident)
        if prompt['status']=='failed':
            error=str(prompt.get('workerError','Unknown failure'))
            try:
                context=local_context(config,ident)
                diagnostic='\n'.join((error, context.get('diagnostic_error','')))
                category,action,reason=classify(diagnostic,context)
            except (OSError,ValueError,KeyError) as local_error:
                category,action,reason='saved_inputs','review','Saved job metadata could not be read. Restore it before retrying.'
                error+=' Local metadata: '+str(local_error)[:500]
                context={}
            if entry is None:entry={'first_seen':utc(),'attempts':[]};ledger['requests'][ident]=entry
            entry.update(id=ident,prompt=prompt.get('prompt',''),status='failed',category=category,error=error,
                         next_action=reason,signature=signature(category,error),last_seen=utc(),policy_version=POLICY_VERSION)
            # Failure episodes are retained even after the mutable latest error is replaced.
            episodes=entry.setdefault('failures',[])
            episode={'version':prompt['version'],'error':error,'category':category,'at':utc()}
            if not episodes or episodes[-1]['error']!=error or episodes[-1]['version']!=prompt['version']:
                episodes.append(episode)
            # Consult shepherd once only after the deterministic policy has no supported next action.
            if (enabled and config.get('automatic_shepherd') and not prompt.get('workerActive') and consulted<1
                    and (action!='retry' or not retry_budget(entry,category))
                    and shepherd_eligible(category,context)):
                if not entry.get('shepherd'):
                    save(path,ledger)
                    entry['shepherd']=shepherd_decide(config,prompt,context);consulted+=1
                    save(path,ledger)
                decision=entry['shepherd']
                if decision['action']=='retry_saved_work' and retry_budget(entry,'shepherd'):
                    category,action,reason='shepherd','retry',decision['reason']
                    entry.update(category=category,next_action=reason)
                elif action!='retry':entry['next_action']=decision['reason']
            # An interrupted network response is reconciled from server state before another retry.
            pending=entry.get('pending_retry')
            if pending and pending['version']!=prompt['version']:
                entry.pop('pending_retry');pending=None;save(path,ledger)
            allowed=action=='retry' and not prompt.get('workerActive') and (bool(pending) or due(entry,now) and retry_budget(entry,category))
            if enabled and allowed and retried<2:
                if not pending:
                    attempt={'at_epoch':now,'at':utc(),'category':category,'signature':entry['signature'],'policy_version':POLICY_VERSION}
                    entry['attempts'].append(attempt)
                    entry['pending_retry']={'version':prompt['version'],'at_epoch':now}
                    save(path,ledger)
                try:updated=api.retry(prompt)
                except urllib.error.HTTPError as error:
                    if error.code not in (409,429):raise
                    # The server rejected admission; no production retry was spent.
                    if entry.get('pending_retry'):entry['attempts'].pop()
                    entry['next_action']='Queue full; waiting for capacity.' if error.code==429 else 'Request changed during the check; reconcile on the next pass.'
                    entry.pop('pending_retry',None);save(path,ledger)
                    if error.code==429 and config.get('recovery_status_api'):
                        try: seen[ident]=api.recovery(prompt,'recovering')
                        except urllib.error.HTTPError as mark_error:
                            if mark_error.code!=409:raise
                    continue
                entry.update(status=updated['status'],next_action='Queued to resume saved work.');entry.pop('pending_retry',None)
                seen[ident]=updated;retried+=1;save(path,ledger)
            elif action=='retry' and not retry_budget(entry,category):
                entry['next_action']='Automatic retry budget exhausted. Review this cause before enabling another attempt.'
            elif action=='retry' and not due(entry,now):entry['next_action']='Cooling down before the next saved-work retry.'
            if enabled and config.get('recovery_status_api') and entry['status']=='failed' and not prompt.get('workerActive'):
                phase='recovering' if action=='retry' and retry_budget(entry,category) else 'attention'
                try:
                    updated=api.recovery(prompt,phase);seen[ident]=updated
                except urllib.error.HTTPError as error:
                    if error.code!=409:raise
        elif entry is not None:
            entry['status']=prompt['status'];entry.pop('pending_retry',None)
            if prompt['status']=='published':
                entry.setdefault('resolved_at',utc());entry['next_action']='Published successfully; retained as evidence for this recovery category.'
                if enabled and config.get('verify_recovered_publication') and ident==delivery_id and checked_delivery<1:
                    checked_delivery+=1
                    entry['delivery_checked_epoch']=now;save(path,ledger)
                    try: entry['delivery']=verify_delivery(config,prompt)
                    except (OSError,ValueError,RuntimeError,KeyError,TypeError) as delivery_error:
                        entry['delivery']={'status':'verification_pending','error':str(delivery_error)[:1000],'at':utc()}
                    if entry['delivery']['status']!='verified':entry['next_action']='Published; completing public artifact and live catalog verification.'
            elif prompt['status']=='canceled':entry['next_action']='Canceled; monitor will take no action.'
    entries=list(ledger['requests'].values())
    opened=[e for e in entries if e['status']=='failed'];resolved=[e for e in entries if e['status']=='published']
    recovering=[e for e in entries if e['status'] in ('queued','processing','completed','publishing')]
    automatic=[p for p in seen.values() if p['status']=='failed' and p.get('recovery',{}).get('phase')=='recovering'
               and p['recovery'].get('expiresAt','')>utc()]
    point={'at':utc(),'needs_attention':sum(p['status']=='failed' for p in seen.values())-len(automatic),
           'recovering':len(recovering)+len(automatic),'resolved':len(resolved)}
    ledger['history']=(ledger['history']+[point])[-2016:];save(path,ledger)
    report={**point,'status':'ok','retried':retried,'shepherd_consultations':consulted,'policy_version':POLICY_VERSION,
            'reliability_72h':metrics(prompts),
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
