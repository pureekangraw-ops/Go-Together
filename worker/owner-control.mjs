// Bounded read on the existing private AppTools capability. No approval or job dispatch.
import {listFactoryApprovals} from './factory-approvals.mjs';
import {factoryDirectStatus} from './factory-direct.mjs';
import {observatoryDirect} from './observatory-direct.mjs';
const GO='https://go-together.pureekangraw.workers.dev';
const identifier=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(x)?x:null;
const value=async fn=>{let timer;try{return {ok:true,value:await Promise.race([
 Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('READ_TIMEOUT')),5000);})
 ])};}catch{return {ok:false};}finally{clearTimeout(timer);}};
const resultId=(r,key)=>identifier(r?.[key]??r?.result?.[key]??r?.receipt?.[key]);
export async function readOwnerDashboard(env={}){
 const observedAt=new Date().toISOString();
 const [db,approvals,events,factory,observatory]=await Promise.all([
  value(()=>env.DB.prepare('SELECT 1 AS healthy').first()),
  value(()=>listFactoryApprovals(env.DB,50)),
  value(()=>env.DB.prepare('SELECT approval_id,action,actor,event_at,details_json FROM factory_approval_events ORDER BY id DESC LIMIT 100').all()),
  value(()=>factoryDirectStatus(env)),
  value(()=>observatoryDirect(env,'observatory_session',{}))
 ]);
 const f=factory.value,obs=observatory.value;
 const version={id:identifier(env.CF_VERSION_METADATA?.id),tag:identifier(env.CF_VERSION_METADATA?.tag)};
 const system=(id,name,status,reason,extra={})=>({id,name,status,reason,observedAt,version:null,...extra});
 const systems=[
  system('go','GO Brain',db.ok&&db.value?.healthy===1?'READY':'ERROR',db.ok?'D1_READ_OK':'D1_READ_UNAVAILABLE',{version}),
  system('factory','Factory',f?.ok===true?(f.commandReady===true?'READY':'CONNECTED'):'UNKNOWN',f?.status||'FACTORY_READ_UNAVAILABLE',
   {version:{id:null,sourceSha:/^[a-f0-9]{40}$/.test(f?.sourceSha||'')?f.sourceSha:null}}),
  system('observatory','Observatory',obs?.ok===true?'CONNECTED':'UNKNOWN',identifier(obs?.status)||'OBSERVATORY_READ_UNAVAILABLE'),
  system('goview','GOVIEW','UNKNOWN','NO_GENERAL_STATUS_OPERATION')
 ];
 const rows=approvals.ok?approvals.value.map(x=>({
  id:x.id,domain:x.domain,status:x.status,requestId:x.requestId,
  workId:resultId(x.result,'workId'),jobId:resultId(x.result,'jobId'),receiptId:resultId(x.result,'receiptId'),
  createdAt:x.createdAt,updatedAt:x.updatedAt,approvalUrl:GO+'/#factory-approvals'
 })):[];
 const goAudit=events.ok?(events.value.results||[]).map(x=>{
  let details={};try{details=JSON.parse(x.details_json);}catch{}
  return {approvalId:x.approval_id,action:x.action,actor:x.actor,eventAt:x.event_at,
   requestId:identifier(details.requestId),workId:identifier(details.workId),receiptId:identifier(details.receiptId)};
 }):[];
 return {observedAt,version,systems,identity:{actor:'GO',authentication:env.BRAIN_AUTH_MODE==='DIRECT'?'OAuth for MCP; Cloudflare Access for dashboard':'Cloudflare Access',
  scope:'brain-owner',ownerConfigured:typeof env.OWNER_EMAIL==='string',credentialLifecycle:'NOT_IMPLEMENTED'},
  factory:{approvalsAvailable:approvals.ok,approvals:rows,approvalsUrl:GO+'/#factory-approvals',
   domains:['CODE','VISUAL','LOGIC','PROOF'].map(name=>({name,status:f?.machinery?.[name]==='READY'?'READY':'UNKNOWN'}))},goAudit,
  gaps:[...(!approvals.ok?['APPROVALS_READ_UNAVAILABLE']:[]),...(!events.ok?['GO_AUDIT_READ_UNAVAILABLE']:[]),
   ...(!version.id?['GO_VERSION_METADATA_NOT_BOUND']:[]),'GOVIEW_REQUIRES_EXACT_COMMAND_OR_ARTIFACT_ID',
   'FACTORY_JOB_HISTORY_LIMITED_TO_EXISTING_GO_APPROVALS','HUB_DELIVERY_ACTOR_AND_WORK_IDS_NOT_RECORDED']};
}
