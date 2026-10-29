import {goCiAcceptance} from './release-ci.mjs';
import {hubGroup,hubTool,hubConnections} from './hub-client.mjs';
import {deliverFactoryCodeToGithub,runFactoryCodeToGithub} from './factory-code-delivery.mjs';
import {buildBrainContext} from './brain-context.mjs';
import {checkReferenceById,auditReferences} from './brain-reference-health.mjs';
import {PROVIDER_TOOLS} from './provider-catalog.mjs';
import {goviewDirect,isGoviewTool} from './goview-direct.mjs';
import {createOAuthHandler, verifyAccessToken} from './mcp-oauth.mjs';
import {factoryDirectStatus, factoryDirectAuthProbe, factoryDirectSubmit, factoryDirectJobStatus, factoryDirectReadback, factoryDirectArtifact, factoryJobStampStatus, factoryWorkshopContent, factoryVisualUpload, factoryVisualUploadStatus, factoryVisualZipChunk} from './factory-direct.mjs';
import {FactoryApprovalError,createFactoryApproval,getFactoryApproval,listFactoryApprovals,approveFactoryApproval,rejectFactoryApproval,reconcileFactoryApproval} from './factory-approvals.mjs';
import {brainOAuthConfig} from './oauth-ledger.mjs';
import {observatoryDirect,isObservatoryTool} from './observatory-direct.mjs';
// GO-Together Personal Brain — single-owner, explicit Intake
const SOURCE_SHA='__SOURCE_SHA__';
const ORIGIN='https://go-together.pureekangraw.workers.dev';
const RESOURCE=ORIGIN+'/mcp';
const HEAD={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const EDIT=['kind','title','content','status','work_id','evidence_url','outcome','confidence','tags'];
const STAT=['active','needs_review','stale','archived','deleted'];
const CONF=['confirmed','probable','unknown'];
const stamp=()=>new Date().toISOString();
const reply=(o,code=200,h={})=>new Response(JSON.stringify(o),{status:code,headers:{...HEAD,...h}});
const error=(s,m)=>reply({error:m},s);
const id=()=>crypto.randomUUID();
const secret=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function hash(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
class Bad extends Error{constructor(status,message){super(message);this.status=status;}}
function restrict(v,keys){if(!v||typeof v!=='object'||Array.isArray(v))throw new Bad(400,'json_object_required');for(const k of Object.keys(v))if(!keys.includes(k))throw new Bad(400,'unknown_field:'+k);}
function clean(v,create=false){restrict(v,EDIT);if(create&&(!('title'in v)||!('content'in v)))throw new Bad(400,'title_and_content_required');const out={};
for(const [key,x] of Object.entries(v)){
 if(key==='tags'){if(!Array.isArray(x)||x.length>30||x.some(t=>typeof t!=='string'||t.length>80))throw new Bad(400,'invalid_tags');out.tags=JSON.stringify([...new Set(x.map(t=>t.trim()).filter(Boolean))]);continue;}
 if(typeof x!=='string')throw new Bad(400,'field_must_be_string:'+key);
 const value=x.trim();if(value.length>(key==='content'?50000:key==='evidence_url'?2000:1000)||((key==='title'||key==='content'||key==='kind')&&!value))throw new Bad(400,'invalid_length:'+key);
 if(key==='title'&&value.length>200)throw new Bad(400,'title_too_long');
 if(key==='kind'&&value.length>80)throw new Bad(400,'kind_too_long');
 if(key==='status'&&!STAT.includes(value))throw new Bad(400,'invalid_status');
 if(key==='confidence'&&!CONF.includes(value))throw new Bad(400,'invalid_confidence');
 if(key==='evidence_url'&&value&&!/^(https?:\/\/|notion:\/\/|user:\/\/)/i.test(value))throw new Bad(400,'invalid_evidence_url');
 out[key]=value;
}
if(create)Object.assign(out,{kind:out.kind||'operational_memory',status:out.status||'active',confidence:out.confidence||'unknown',tags:out.tags||'[]',work_id:out.work_id||'',evidence_url:out.evidence_url||'',outcome:out.outcome||''});
return out;}
const memory=x=>x?{...x,tags:JSON.parse(x.tags||'[]')}:null;
async function one(db,key){return memory(await db.prepare('SELECT * FROM memories WHERE id=?').bind(key).first());}
async function save(db,args){const x=clean(args,true),key=id(),t=stamp();
await db.prepare('INSERT INTO memories (id,kind,title,content,status,work_id,evidence_url,outcome,confidence,tags,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(key,x.kind,x.title,x.content,x.status,x.work_id,x.evidence_url,x.outcome,x.confidence,x.tags,1,t,t).run();
return one(db,key);}
async function edit(db,key,args,version=null){const before=await one(db,key);if(!before)throw new Bad(404,'memory_not_found');if(version!==null&&version!==before.revision)throw new Bad(409,'revision_conflict');
const x=clean(args);if(!Object.keys(x).length)throw new Bad(400,'empty_patch');
const fields=Object.keys(x),values=fields.map(k=>x[k]),sql='UPDATE memories SET '+fields.map(k=>k+'=?').join(',')+',revision=revision+1,updated_at=? WHERE id=? AND revision=? RETURNING *';
// D1 meta.changes includes audit-trigger writes. The returned row proves this
// compare-and-swap succeeded and is the exact version committed by this call.
const updated=await db.prepare(sql).bind(...values,stamp(),key,before.revision).first();
if(!updated)throw new Bad(409,'revision_conflict');
return memory(updated);}
async function audit(db,key){if(!(await one(db,key)))throw new Bad(404,'memory_not_found');const r=await db.prepare('SELECT * FROM history WHERE memory_id=? ORDER BY created_at DESC,id DESC LIMIT 500').bind(key).all();return (r.results||[]).map(x=>({id:x.id,action:x.action,created_at:x.created_at,before:x.before_json?JSON.parse(x.before_json):null,after:x.after_json?JSON.parse(x.after_json):null}));}
const sortCols=['updated_at','created_at','title','kind','status'];
async function listing(db,args={}){restrict(args,['kind','status','q','sort','limit']);const clauses=[],params=[];
let status=args.status||'active';if(status!=='all'){if(!STAT.includes(status))throw new Bad(400,'invalid_status');clauses.push('status=?');params.push(status);}
if(args.kind){if(typeof args.kind!=='string')throw new Bad(400,'invalid_kind');clauses.push('kind=?');params.push(args.kind);}
if(args.q){
// The deployed D1 SQLite build rejects LIKE patterns >50 chars (including our two %).
// Guard explicitly instead of surfacing an opaque SQLITE_ERROR after authorization.
if(typeof args.q!=='string'||args.q.length>48)throw new Bad(400,'invalid_query_like_length');
clauses.push('(title LIKE ? OR content LIKE ? OR work_id LIKE ? OR tags LIKE ? OR outcome LIKE ?)');
params.push(...Array(5).fill('%'+args.q+'%'));
}
const col=sortCols.includes(args.sort)?args.sort:'updated_at',max=Math.min(200,Math.max(1,Number(args.limit)||100));
const sql='SELECT * FROM memories'+(clauses.length?' WHERE '+clauses.join(' AND '):'')+' ORDER BY '+col+(col==='title'?' ASC':' DESC')+', id DESC LIMIT ?';
const r=await db.prepare(sql).bind(...params,max).all();return (r.results||[]).map(memory);}
function tokenize(t){const found=new Set(),words=String(t||'').toLowerCase().match(/[\p{L}\p{M}\p{N}_-]+/gu)||[];
for(const w of words){if(w.length>1)found.add(w);if(/[\u0e00-\u0e7f]/.test(w))for(let n=2;n<=4;n++)for(let i=0;i+n<=w.length;i++)found.add(w.slice(i,i+n));}return found;}
async function search(db,query,limit=25){if(typeof query!=='string'||!query.trim()||query.length>200)throw new Bad(400,'invalid_query');const wanted=tokenize(query),r=await db.prepare("SELECT * FROM memories WHERE status IN ('active','needs_review') ORDER BY updated_at DESC LIMIT 2000").all(),hits=[];
if(!wanted.size)throw new Bad(400,'invalid_query');
for(const raw of r.results||[]){const x=memory(raw),got=tokenize([x.title,x.title,x.title,x.content,x.work_id,x.outcome,...x.tags].join(' '));let n=0;for(const term of wanted)if(got.has(term))n++;if(n)hits.push({score:Math.round(1000*n/wanted.size)/1000,memory:x});}
hits.sort((a,b)=>b.score-a.score||b.memory.updated_at.localeCompare(a.memory.updated_at));const rows=hits.slice(0,Math.min(50,Math.max(1,Number(limit)||25)));
return {query,method:'lexical-v2',items:rows,count:rows.length,notice:'Lexical matching only; GO interprets the evidence.'};}
async function summary(db,query,limit=10){const r=await search(db,query,Math.min(20,Number(limit)||10));return {type:'source_excerpts_not_ai_summary',query,items:r.items.map(x=>({id:x.memory.id,title:x.memory.title,evidence_url:x.memory.evidence_url,revision:x.memory.revision,excerpt:x.memory.content.slice(0,700)})),count:r.count};}
async function body(req,allowEmpty=false,maxLength=1000000){const txt=await req.text();if(txt.length>maxLength)throw new Bad(413,'body_too_large');if(allowEmpty&&!txt.trim())return {};try{return JSON.parse(txt);}catch{throw new Bad(400,'invalid_json');}}
async function api(req,env,url,ctx){if(!(await owner(req,env,ctx)))return error(401,'owner_auth_required');const p=url.pathname,m=req.method,d=env.DB;
if(p==='/api/factory-approvals'&&m==='GET')return reply({items:await listFactoryApprovals(d)});
const approvalRoute=/^\/api\/factory-approvals\/([0-9a-f-]{36})(?:\/(approve|reject|status))?$/.exec(p);
if(approvalRoute){
 const [,approvalId,action]=approvalRoute;
 if(!action&&m==='GET'){
  const item=await getFactoryApproval(d,approvalId);
  return item?reply(item):error(404,'APPROVAL_NOT_FOUND');
 }
 if(action==='approve'&&m==='POST'){
  if(req.headers.get('origin')!==url.origin)return error(403,'same_origin_required');
  const args=await body(req);restrict(args,['payloadSha256']);
  const result=await approveFactoryApproval(d,{id:approvalId,payloadSha256:args.payloadSha256,actor:env.OWNER_EMAIL,
   dispatch:payload=>payload.githubDelivery
    ?runFactoryCodeToGithub(env,{requestId:payload.requestId,codeSpec:payload.spec,
      repo:payload.githubDelivery.repo,baseSha:payload.githubDelivery.baseSha,
      filePath:payload.githubDelivery.filePath,approved:true})
    :factoryDirectSubmit(env,{domain:payload.domain,spec:payload.spec,requestId:payload.requestId},true)});
  return reply({approval:result.approval,result:result.dispatchResult});
 }
 if(action==='reject'&&m==='POST'){
  if(req.headers.get('origin')!==url.origin)return error(403,'same_origin_required');
  const args=await body(req);restrict(args,['payloadSha256']);
  return reply({approval:await rejectFactoryApproval(d,{id:approvalId,payloadSha256:args.payloadSha256,actor:env.OWNER_EMAIL})});
 }
 if(action==='status'&&m==='POST'){
  if(req.headers.get('origin')!==url.origin)return error(403,'same_origin_required');
  const args=await body(req,true);restrict(args,[]);
  return reply({approval:await reconcileFactoryApproval(d,{id:approvalId,
   statusReader:requestId=>factoryDirectJobStatus(env,{requestId})})});
 }
 return error(405,'method_not_allowed');
}
if(p==='/api/stats'&&m==='GET'){const r=await d.prepare('SELECT status,COUNT(*) AS n FROM memories GROUP BY status').all();const out=Object.fromEntries(STAT.map(x=>[x,0]));for(const x of r.results||[])out[x.status]=x.n;return reply(out);}
if(p==='/api/retrieve'&&m==='GET')return reply(await search(d,url.searchParams.get('q')||'',url.searchParams.get('limit')||25));
if(p==='/api/summarize'&&m==='GET')return reply(await summary(d,url.searchParams.get('q')||'',url.searchParams.get('limit')||10));
if(p==='/api/context'&&m==='GET'){
 const mode=url.searchParams.get('mode')||'operational';
 const rawLimit=url.searchParams.get('limit');
 const limit=rawLimit===null?10:Number(rawLimit);
 if(!['operational','evolution','all'].includes(mode))throw new Bad(400,'invalid_context_mode');
 if(!Number.isInteger(limit)||limit<1||limit>15)throw new Bad(400,'invalid_context_limit');
 return reply(buildBrainContext(await search(d,url.searchParams.get('q')||'',Math.min(50,Math.max(20,limit*4))),{mode,limit}));
}

if(p==='/api/references/check'&&m==='GET'){
 const id=url.searchParams.get('id')||'';
 try{return reply(await checkReferenceById(d,id));}
 catch(e){if(e instanceof RangeError)throw new Bad(400,e.message);throw e;}
}
if(p==='/api/references/audit'&&m==='GET'){
 const n=url.searchParams.get('limit');
 const limit=n===null?3:Number(n);
 try{return reply(await auditReferences(d,limit));}
 catch(e){if(e instanceof RangeError)throw new Bad(400,e.message);throw e;}
}
if(p==='/api/memories'){if(m==='GET'){const items=await listing(d,Object.fromEntries(url.searchParams));return reply({items,count:items.length});}if(m==='POST')return reply(await save(d,await body(req)),201);}
const hit=/^\/api\/memories\/([0-9a-f-]{36})(?:\/(history|restore|status))?$/.exec(p);
if(!hit)return error(404,'not_found');const key=hit[1],action=hit[2];
if(m==='GET'&&action==='history')return reply({items:await audit(d,key)});
if(m==='GET'&&!action){const x=await one(d,key);return x?reply(x):error(404,'memory_not_found');}
if(m==='PATCH'&&!action){const args=await body(req),version=args.expected_revision;delete args.expected_revision;if(!Number.isInteger(version))throw new Bad(400,'expected_revision_required');return reply(await edit(d,key,args,version));}
if(m==='DELETE'&&!action){const x=await one(d,key);if(!x)throw new Bad(404,'memory_not_found');return reply({ok:true,item:await edit(d,key,{status:'deleted'},x.revision)});}
if(m==='POST'&&action==='status'){const args=await body(req);restrict(args,['status','expected_revision']);if(!Number.isInteger(args.expected_revision))throw new Bad(400,'expected_revision_required');return reply(await edit(d,key,{status:args.status},args.expected_revision));}
if(m==='POST'&&action==='restore'){const args=await body(req);restrict(args,['expected_revision']);const x=await one(d,key);if(!x)throw new Bad(404,'memory_not_found');return reply(await edit(d,key,{status:'active'},args.expected_revision??x.revision));}
return error(405,'method_not_allowed');}
const SCHEMA=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const type=(s)=>({type:s}),Q=type('string'),N=type('integer');
const fields={kind:Q,title:Q,content:Q,status:Q,work_id:Q,evidence_url:Q,outcome:Q,confidence:Q,tags:{type:'array',items:Q}};
// Business intent is supplied to GO; Factory assigns its own job ID.
const GO_FACTORY_CODE=SCHEMA({baseSource:Q,
  patch:SCHEMA({find:Q,replace:type('string')},['find','replace']),
  tests:{type:'array',minItems:1,maxItems:8,items:SCHEMA({
    path:Q,status:N,body:type('string')},['path','status','body'])}
},['baseSource','patch','tests']);
const GO_FACTORY_VISUAL=SCHEMA({
  design:SCHEMA({title:Q,body:type('string'),accent:Q},['title','body','accent']),
  viewport:SCHEMA({width:N,height:N},['width','height'])
},['design','viewport']);
const GO_FACTORY_LOGIC=SCHEMA({
  placement:{type:'string',const:'DWARF-01_TRAINING'}
},['placement']);
const GO_FACTORY_SPLIT=SCHEMA({imageSplit:SCHEMA({
 sourceRef:{type:'string',pattern:'^r2://factory/edge-source/go/[a-f0-9]{64}\\.png#sha256=[a-f0-9]{64}$'},
 count:{type:'integer',minimum:1,maximum:12},
 columns:{type:'integer',minimum:1,maximum:12},
 canvas:{type:'integer',minimum:64,maximum:1024},
 names:{type:'array',minItems:1,maxItems:12,items:{type:'string',pattern:'^[A-Za-z0-9_-]{1,64}$'}}
},['sourceRef','count','columns','canvas','names'])},['imageSplit']);
const GO_FACTORY_PROOF_CATALOG=SCHEMA({mode:{type:'string',const:'CATALOG'},caseIds:{type:'array',maxItems:8,uniqueItems:true,items:{type:'string',pattern:'^GOLDEN-[A-Z0-9-]{3,120}$'}}},['mode']);
const GO_FACTORY_PROOF_CHECK=SCHEMA({mode:{type:'string',const:'RECEIPT_CHECK'},targetSourceSha:{type:'string',pattern:'^[a-f0-9]{40}$'},receiptIds:{type:'array',minItems:1,maxItems:8,uniqueItems:true,items:{type:'string',pattern:'^receipt-[A-Za-z0-9-]{8,80}$'}}},['mode','targetSourceSha','receiptIds']);
const GO_FACTORY_PROOF_TOOLKIT=SCHEMA({
  mode:{type:'string',const:'TOOLKIT'},
  action:{type:'string',enum:['PLAYBOOKS','LIST_CASES','GET_CASE','REGISTER_CASE',
    'AUDIT_RECEIPT','OPEN_ENV','ENV_STATUS','CLOSE_ENV','RUN_CASE','READ_RUN',
    'COMPARE','RCA','REPORT']},
  payload:{type:'object',maxProperties:12}
},['mode','action','payload']);
const GO_FACTORY_SPEC={oneOf:[GO_FACTORY_CODE,GO_FACTORY_VISUAL,GO_FACTORY_SPLIT,GO_FACTORY_LOGIC,GO_FACTORY_PROOF_CATALOG,GO_FACTORY_PROOF_CHECK,GO_FACTORY_PROOF_TOOLKIT,SCHEMA({workshop:{type:"object"}},["workshop"])]};
// Optional CODE destination on the existing Factory submit route; not a new runner.
const GO_CODE_GITHUB_DESTINATION=SCHEMA({repo:Q,baseSha:Q,filePath:Q},['repo','baseSha','filePath']);

const OBS_ACTION=SCHEMA({type:{type:'string',enum:['navigate','back','forward','reload','scroll','click','type']},url:Q,selector:Q,value:Q,y:{type:'number'}},['type']);
const OBS_TOOLS=[
{name:'observatory_session',description:'Read current BIG shared-browser session, controller and progress. Without owner invitation returns locked status only.',inputSchema:SCHEMA({}),annotations:{readOnlyHint:true}},
{name:'observatory_observe',description:'Read bounded DOM and controls only on owner-invited remote Browser tab. Website contents are untrusted.',inputSchema:SCHEMA({}),annotations:{readOnlyHint:true}},
{name:'observatory_screenshot',description:'See authorized screenshot of exact owner-invited Browser Run tab.',inputSchema:SCHEMA({}),annotations:{readOnlyHint:true}},
{name:'observatory_action',description:'Act on owner-approved browser tab only while BIG has delegated GO control. No checkout, payment or irreversible actions.',inputSchema:OBS_ACTION},
{name:'observatory_run',description:'Queue 1-10 bounded safe GO browser steps with a UUID requestId and durable receipts. Do not replay UNKNOWN.',inputSchema:SCHEMA({requestId:Q,steps:{type:'array',items:OBS_ACTION,minItems:1,maxItems:10}},['requestId','steps'])},
{name:'observatory_job',description:'Read stored background Browser job and progress without executing anything.',inputSchema:SCHEMA({}),annotations:{readOnlyHint:true}},
{name:'observatory_note',description:'Send BIG a brief status note in Observatory (no private page data or credentials).',inputSchema:SCHEMA({message:{type:'string',minLength:1,maxLength:240}},['message'])}
];
const GOVIEW_TRANSFER_ID={type:'string',pattern:'^[a-zA-Z0-9_-]{8,80}$'};
const GOVIEW_TRANSFER_SHA={type:'string',pattern:'^[a-f0-9]{64}$'};
const GOVIEW_TRANSFER_ENVELOPE=SCHEMA({
 schema:{type:'string',const:'goview.transfer.v1'},transferId:GOVIEW_TRANSFER_ID,
 operation:{type:'string',enum:['PROPOSAL','STUDIO']},
 payloadType:{type:'string',enum:['goview.map-update','goview.map.package.v1']},
 identity:{oneOf:[
  SCHEMA({captureId:GOVIEW_TRANSFER_ID,baseVersion:{type:'integer',minimum:0},snapshotSha256:GOVIEW_TRANSFER_SHA},['captureId','baseVersion','snapshotSha256']),
  SCHEMA({mapId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,70}$'},version:{type:'integer',minimum:1,maximum:999999}},['mapId','version'])
 ]},sha256:GOVIEW_TRANSFER_SHA,payload:{type:'string',maxLength:1048576}
},['schema','transferId','operation','payloadType','identity','sha256','payload']);

const GOVIEW_IDENTITY={mapId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,70}$'},version:{type:'integer',minimum:1,maximum:999999},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},transferId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,80}$'}};
const GOVIEW_REQUIRED=['mapId','version','sha256','transferId'];
export const tools=[
 {name:'release_control',description:'Plan, start, recover status or explicitly roll back one owner-authorized pinned GO/Hub release. Never repeat start after timeout; use status with the same requestId. No arbitrary targets or credentials.',inputSchema:SCHEMA({action:{type:'string',enum:['plan','start','status','rollback']},releaseId:{type:'string',maxLength:60},requestId:{type:'string',pattern:'^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$'},goSha:{type:'string',pattern:'^[a-f0-9]{40}$'},hubSha:{type:'string',pattern:'^[a-f0-9]{40}$'},authorization:{type:'string',maxLength:80}},['action']),annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true}},
 ...Object.values(PROVIDER_TOOLS).flat(),
 {name:'hub_connections',description:'Read Hub V2 catalog and current provider connectivity through the Hub. No PANTHEON dependency.',inputSchema:SCHEMA({}),annotations:{readOnlyHint:true}},
 {name:'hub_refresh',description:'Refresh an explicitly selected Hub V2 connector schema. Does not approve changed schemas or execute a tool.',inputSchema:SCHEMA({connectorId:Q},['connectorId'])},
 {name:'goview_publish',description:'Publish owner-requested GO map package and verify exact remote bytes. Does not apply on Android. Preserve returned transfer ID/version/full SHA for Android preview; on uncertain outcome read exact version before retry.',inputSchema:SCHEMA({...GOVIEW_IDENTITY,package:{type:'string',maxLength:1048832}},[...GOVIEW_REQUIRED,'package'])},
 {name:'goview_readback',description:'Read explicitly selected remote map artifact by exact version and expected full SHA-256. No listing, GPS/history collection or handset access. Handset receipt must be exported by owner.',inputSchema:SCHEMA(GOVIEW_IDENTITY,GOVIEW_REQUIRED),annotations:{readOnlyHint:true}},
 {name:'goview_focus_point',description:'Ask the owner GOVIEW map to move its live camera to these coordinates while visible. No GPS read and no map write. Call goview_command_status for device receipt.',inputSchema:SCHEMA({commandId:Q,latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180},expectedRevision:{type:'integer',minimum:0}},['commandId','latitude','longitude'])},
 {name:'goview_propose_pin',description:'Propose a labelled place coordinate to owner GOVIEW. Device shows owner confirmation; no write until approved. This is an unverified suggested location.',inputSchema:SCHEMA({commandId:Q,latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180},label:{type:'string',minLength:1,maxLength:140},expectedRevision:{type:'integer',minimum:0}},['commandId','latitude','longitude','label'])},
 {name:'goview_command_status',description:'Read the exact direct GO map command delivery receipt. QUEUED does not mean saved or displayed.',inputSchema:SCHEMA({commandId:Q},['commandId']),annotations:{readOnlyHint:true}},
 {name:'goview_transfer_read',description:'Read only the explicitly selected typed transfer ID and expected payload SHA-256 from the owner upload receipt. Verify contract and exact bytes; no listing or GPS/history discovery.',inputSchema:SCHEMA({transferId:GOVIEW_TRANSFER_ID,sha256:GOVIEW_TRANSFER_SHA},['transferId','sha256']),annotations:{readOnlyHint:true}},
 {name:'goview_transfer_publish',description:'Publish an immutable PROPOSAL bound to an explicit snapshot digest/revision, or a separate Studio package. Never upload SNAPSHOT as GO. Verify exact readback; uncertainty requires exact read before any retry. Download does not apply a map: owner preview and Update remain required.',inputSchema:SCHEMA({envelope:GOVIEW_TRANSFER_ENVELOPE},['envelope'])},
 {name:'goview_transfer_receipt',description:'Read the device report for one exact transfer ID. Missing means NOT_OBSERVED; a report is not independent physical execution proof. Never replay Update to obtain a receipt.',inputSchema:SCHEMA({transferId:GOVIEW_TRANSFER_ID},['transferId']),annotations:{readOnlyHint:true}},
 ...OBS_TOOLS,
{name:'brain_search',description:'Search memory using lexical evidence matching; no autonomous reasoning.',inputSchema:SCHEMA({query:Q,limit:N},['query'])},
{name:'brain_retrieve',description:'Return an exact memory record by its internal record ID.',inputSchema:SCHEMA({id:Q},['id'])},
{name:'brain_list',description:'Organize and list memories by filters and sort order.',inputSchema:SCHEMA({kind:Q,status:Q,q:Q,sort:Q,limit:N})},
{name:'brain_save',description:'Save exactly supplied memory details. GO makes the decision.',inputSchema:SCHEMA(fields,['title','content'])},
{name:'brain_edit',description:'Change only the specified fields if the expected revision matches.',inputSchema:SCHEMA({id:Q,expected_revision:N,...fields},['id','expected_revision'])},
{name:'brain_set_status',description:'Explicitly archive, delete, restore, or flag a record.',inputSchema:SCHEMA({id:Q,status:Q,expected_revision:N},['id','status','expected_revision'])},
{name:'brain_history',description:'Read an exact record change history with snapshots.',inputSchema:SCHEMA({id:Q},['id'])},
{name:'brain_summarize',description:'Return extractive source-linked excerpts only; GO synthesizes conclusions.',inputSchema:SCHEMA({query:Q,limit:N},['query'])},
{name:'brain_context',description:'Read bounded source-linked GO Brain context for work continuity (operational) or RCA/learning review (evolution). Neither mode performs AI reasoning, tool execution, training, source verification or writes.',inputSchema:SCHEMA({query:Q,mode:{type:'string',enum:['operational','evolution','all']},limit:{type:'integer',minimum:1,maximum:15}},['query']),annotations:{readOnlyHint:true}},
{name:'brain_reference_check',description:'Read-only HTTP status check for exactly one stored evidence_url by memory ID; never follows redirects or claims private content access.',inputSchema:SCHEMA({id:Q},['id']),annotations:{readOnlyHint:true}},
{name:'brain_reference_audit',description:'Read-only on-demand spot-check of up to five recent stored evidence_url links; no recurring crawl, no memory writes.',inputSchema:SCHEMA({limit:{type:'integer',minimum:1,maximum:5}}),annotations:{readOnlyHint:true}},

{name:'factory_job_stamp_status',description:'Read only one GO-owned Job Stamp central evaluation and delivery eligibility by signed Factory receipt. Never executes a machine or claims recipient acceptance.',inputSchema:SCHEMA({receiptId:Q},['receiptId']),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'factory_direct_status',description:'Read Factory machinery registration through private GO->Factory Binding. No execution.',inputSchema:SCHEMA({}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'factory_direct_auth_probe',description:'Verify GO/Factory mutual HMAC using a fresh nonce on the private Service Binding, without issuing any Factory Job, reading secrets or invoking machinery. Returns sanitized authentication state only.',inputSchema:SCHEMA({}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'factory_direct_propose',description:'Create a durable Factory job proposal in the GO approvals inbox. This never executes Factory. The owner must review the exact payload and click Approve & run in the GO dashboard; approval identity, time and payload hash are recorded before the existing signed Factory path runs. No auto merge or production deploy.',inputSchema:SCHEMA({
  domain:{type:'string',enum:['CODE','VISUAL','LOGIC','PROOF']},spec:GO_FACTORY_SPEC,
  requestId:{type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},
  githubDelivery:GO_CODE_GITHUB_DESTINATION
},['domain','spec','requestId']),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
{name:'factory_direct_approval_status',description:'Read the durable state of one GO Factory approval proposal. This never approves, executes, or retries a job.',inputSchema:SCHEMA({approvalId:Q},['approvalId']),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'factory_visual_upload',description:'Upload owner-approved PNG sheet through signed GO to Factory R2. Returns immutable sourceRef and independent status readback, not finished assets.',inputSchema:SCHEMA({
 pngBase64:{type:'string',minLength:80,maxLength:5592408},
 sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},requestId:Q,
 approved:{type:'boolean',const:true}
},['pngBase64','sha256','approved']),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
{name:'factory_visual_zip_chunk',description:'Read one SHA-256 verified segment of a receipt-bound VISUAL ZIP (up to 256 KiB). Pass full expected ZIP digest from the verified image-pack manifest; does not execute anything.',inputSchema:SCHEMA({
 receiptId:Q,artifactRef:Q,offset:{type:'integer',minimum:0},
 length:{type:'integer',minimum:1,maximum:262144},
 expectedSha256:{type:'string',pattern:'^[a-f0-9]{64}$'}
},['receiptId','artifactRef','offset','expectedSha256']),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'factory_visual_upload_status',description:'Read existing signed Factory image upload receipt without redoing an effect.',inputSchema:SCHEMA({requestId:Q},['requestId']),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'factory_workshop_content',description:'Owner-approved nonsecret Workshop JSON content ingestion on the existing signed Factory rail. Returns an immutable content reference and digest; no machine execution. No credentials or customer data.',inputSchema:SCHEMA({content:{},approved:{type:'boolean',const:true}},['content','approved']),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
{name:'factory_direct_job_status',description:'Read Factory job/receipt by a prior GO-generated requestId; never reexecutes work.',inputSchema:SCHEMA({requestId:Q},['requestId']),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'factory_direct_readback',description:'Read one Factory-owned GO job receipt by receiptId; no Work Pass and no machine execution.',inputSchema:SCHEMA({receiptId:Q},['receiptId']),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'factory_direct_artifact',description:'Return receipt-bound CODE JS/VISUAL PNG or Workshop package JSON bytes with verified transport/content SHA-256.',inputSchema:SCHEMA({receiptId:Q,artifactRef:Q},['receiptId','artifactRef']),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:'factory_code_deliver_github',description:'Create a GitHub work branch, exact CODE source file and review PR only from a verified existing GO-owned Factory CODE receipt. No rerun, merge or deployment; uncertain effects require read-only reconciliation.',inputSchema:SCHEMA({receiptId:Q,repo:Q,baseSha:Q,filePath:Q,requestId:Q,approved:{type:'boolean',const:true}},['receiptId','repo','baseSha','filePath','requestId','approved']),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
];

async function toolCall(name,a,d,env,local=false){if(!a||typeof a!=='object')a={};
if(name.startsWith('pantheon_')||name==='factory_report')throw new Bad(410,'PANTHEON_DISCONNECTED');
if(name==='release_control'){restrict(a,['action','releaseId','requestId','goSha','hubSha','authorization']);if(local)throw Error('RELEASE_PRIVATE_RELAY_REFUSED');if(!env.HUB_V2?.releaseControl)throw Error('RELEASE_CONTROLLER_NOT_INSTALLED');return env.HUB_V2.releaseControl(a);}
if(!local&&hubGroup(name))return hubTool(env,name,a);
if(name==='hub_connections'){restrict(a,[]);return hubConnections(env);}
if(name==='hub_refresh'){restrict(a,['connectorId']);if(!env.HUB_V2)throw Error('HUB_V2_NOT_CONFIGURED');return env.HUB_V2.refresh(a.connectorId);}
if(isGoviewTool(name))return goviewDirect(env,name,a);
if(isObservatoryTool(name))return observatoryDirect(env,name,a);
if(name==='factory_job_stamp_status'){restrict(a,['receiptId']);return factoryJobStampStatus(env,a);}
if(name==='factory_direct_status'){restrict(a,[]);return factoryDirectStatus(env);}
if(name==='factory_direct_auth_probe'){restrict(a,[]);return factoryDirectAuthProbe(env);}
if(name==='factory_direct_propose'){
 restrict(a,['domain','spec','requestId','githubDelivery']);
 if(a.githubDelivery!==undefined)restrict(a.githubDelivery,['repo','baseSha','filePath']);
 const proposal=await createFactoryApproval(d,{domain:a.domain,spec:a.spec,
  requestId:a.requestId,githubDelivery:a.githubDelivery,createdBy:env.OWNER_EMAIL});
 return {ok:true,status:proposal.status==='PENDING'?'PENDING_OWNER_APPROVAL':'APPROVAL_'+proposal.status,
  approvalId:proposal.id,requestId:proposal.requestId,payloadSha256:proposal.payloadSha256,
  approvalUrl:ORIGIN+'/#factory-approvals',executionStarted:Boolean(proposal.approvedAt),
  approvalRequired:proposal.status==='PENDING'};
}
if(name==='factory_direct_approval_status'){
 restrict(a,['approvalId']);
 const item=await getFactoryApproval(d,a.approvalId);
 return item?{ok:true,approval:item}:{ok:false,status:'APPROVAL_NOT_FOUND'};
}
if(name==='factory_visual_upload'){restrict(a,['pngBase64','sha256','requestId','approved']);if(a.approved!==true)throw new Bad(403,'explicit_owner_approval_required');return factoryVisualUpload(env,{pngBase64:a.pngBase64,sha256:a.sha256,requestId:a.requestId},true);}
if(name==='factory_visual_zip_chunk'){restrict(a,['receiptId','artifactRef','offset','length','expectedSha256']);return factoryVisualZipChunk(env,a);}
if(name==='factory_visual_upload_status'){restrict(a,['requestId']);return factoryVisualUploadStatus(env,a);}
if(name==='factory_workshop_content'){restrict(a,['content','approved']);if(a.approved!==true)throw new Bad(403,'explicit_owner_approval_required');return factoryWorkshopContent(env,{content:a.content},true);}
if(name==='factory_direct_job_status'){restrict(a,['requestId']);return factoryDirectJobStatus(env,a);}
if(name==='factory_direct_readback'){restrict(a,['receiptId']);return factoryDirectReadback(env,a);}
if(name==='factory_direct_artifact'){restrict(a,['receiptId','artifactRef']);return factoryDirectArtifact(env,a);}
if(name==='factory_code_deliver_github'){restrict(a,['receiptId','repo','baseSha','filePath','requestId','approved']);if(a.approved!==true)throw new Bad(403,'explicit_owner_approval_required');return deliverFactoryCodeToGithub(env,a);}
if(name==='brain_search'){restrict(a,['query','limit']);return search(d,a.query,a.limit);}
if(name==='brain_retrieve'){restrict(a,['id']);return one(d,a.id);}
if(name==='brain_list')return {items:await listing(d,a)};
if(name==='brain_save')return save(d,a);
if(name==='brain_edit'){restrict(a,['id','expected_revision',...EDIT]);const {id,expected_revision,...patch}=a;if(!Number.isInteger(expected_revision))throw new Bad(400,'expected_revision_required');return edit(d,id,patch,expected_revision);}
if(name==='brain_set_status'){restrict(a,['id','status','expected_revision']);if(!Number.isInteger(a.expected_revision))throw new Bad(400,'expected_revision_required');return edit(d,a.id,{status:a.status},a.expected_revision);}
if(name==='brain_history'){restrict(a,['id']);return {items:await audit(d,a.id)};}
if(name==='brain_summarize'){restrict(a,['query','limit']);return summary(d,a.query,a.limit);}
if(name==='brain_reference_check'){
 restrict(a,['id']);
 try{return await checkReferenceById(d,a.id);}
 catch(e){if(e instanceof RangeError)throw new Bad(400,e.message);throw e;}
}
if(name==='brain_reference_audit'){
 restrict(a,['limit']);
 try{return await auditReferences(d,a.limit??3);}
 catch(e){if(e instanceof RangeError)throw new Bad(400,e.message);throw e;}
}
if(name==='brain_context'){
 restrict(a,['query','mode','limit']);
 const mode=a.mode??'operational',limit=a.limit??10;
 if(!['operational','evolution','all'].includes(mode))throw new Bad(400,'invalid_context_mode');
 if(!Number.isInteger(limit)||limit<1||limit>15)throw new Bad(400,'invalid_context_limit');
 return buildBrainContext(await search(d,a.query,Math.min(50,Math.max(20,limit*4))),{mode,limit});
}

throw new Bad(404,'unknown_tool');}
const rpc=(id,result)=>reply({jsonrpc:'2.0',id,result});
const MCP_INFO={name:'go-together',version:'1.3.0'};
const MCP_NEW='2026-07-28';
function mcpReply(id,result,modern=false){
 const payload=modern?{...result,_meta:{...(result._meta||{}),'io.modelcontextprotocol/serverInfo':MCP_INFO}}:result;
 return rpc(id,payload);
}
async function mcp(req,env,ctx){
 if(req.method!=='POST')return error(405,'method_not_allowed');
 const reportedBytes=Number(req.headers.get('content-length')||0);
 if(reportedBytes>7_000_000)return error(413,'mcp_body_too_large');
 if((!Number.isFinite(reportedBytes)||reportedBytes<0||reportedBytes>1_000_000)&&
    !(await owner(req,env,ctx)))return error(401,'owner_auth_required');
 const x=await body(req,true,7_000_000);
 if(JSON.stringify(x).length>1_000_000 &&
    !(x.method==='tools/call'&&x.params?.name==='factory_visual_upload'))
    return error(413,'large_mcp_body_not_allowed');
 if(!['initialize','server/discover','tools/list','notifications/initialized'].includes(x.method) && !(await owner(req,env,ctx)))return reply({error:'owner_auth_required'},401,{'www-authenticate':'Bearer resource_metadata="'+ORIGIN+'/.well-known/oauth-protected-resource/mcp"'});
 const isModern=req.headers.get('MCP-Protocol-Version')===MCP_NEW||x.params?._meta?.['io.modelcontextprotocol/protocolVersion']===MCP_NEW;
 if(x.method==='server/discover')return mcpReply(x.id,{
  resultType:'complete',supportedVersions:[MCP_NEW,'2025-06-18'],
  capabilities:{tools:{listChanged:false}},cacheScope:'private',ttlMs:60000
 },true);
 if(x.method==='notifications/initialized')return new Response(null,{status:202});
 if(x.method==='initialize')return rpc(x.id,{protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:MCP_INFO});
 if(x.method==='ping')return rpc(x.id,{});
 if(x.method==='tools/list')return mcpReply(x.id,{...(isModern?{resultType:'complete'}:{}),tools:tools.map(t=>({...t,securitySchemes:[{type:'oauth2',scopes:[]}]}))},isModern);
 if(x.method==='tools/call'){
  if(!(await owner(req,env,ctx)))return reply({error:'owner_auth_required'},401,{'www-authenticate':'Bearer resource_metadata="'+ORIGIN+'/.well-known/oauth-protected-resource/mcp"'});
  const name=x.params?.name,a=x.params?.arguments||{};
  if(!tools.some(t=>t.name===name))return reply({jsonrpc:'2.0',id:x.id,error:{code:-32601,message:'unknown_tool'}});
  try{
   const value=await toolCall(name,a,env.DB,env);
   if(name==='observatory_screenshot' && value?.ok===true && value?.result?.mimeType==='image/jpeg' &&
      typeof value?.result?.image==='string')
    return mcpReply(x.id,{...(isModern?{resultType:'complete'}:{}),
      content:[{type:'image',mimeType:'image/jpeg',data:value.result.image},
      {type:'text',text:JSON.stringify({ok:true,observedAt:value.result.observedAt||null})}]},isModern);
   return mcpReply(x.id,{...(isModern?{resultType:'complete'}:{}),
      content:[{type:'text',text:JSON.stringify(value)}],
      ...((isObservatoryTool(name)||isGoviewTool(name)||hubGroup(name))&&value?.ok===false?{isError:true}:{})},isModern);
  }catch(e){
   return mcpReply(x.id,{...(isModern?{resultType:'complete'}:{}),content:[{type:'text',text:e.message}],isError:true},isModern);
  }
 }
 return reply({jsonrpc:'2.0',id:x.id,error:{code:-32601,message:'method_not_found'}});
}
// Cloudflare Managed OAuth authenticates at the edge. The Asset router may
// strip ctx.access but preserves the Access-signed identity JWT header.
// No token content, user identity, or untrusted claim values are ever logged.
let accessJwks=null,accessJwksAt=0;
function ownerReject(stage){
 console.warn('go_brain_owner_verification',JSON.stringify({verified:false,stage}));
 return false;
}
function decodeJwtPart(v){
 const padded=v.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(v.length/4)*4,'=');
 return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
}
async function signedAccessOwner(req,env){
 const jwt=req.headers.get('Cf-Access-Jwt-Assertion')||'';
 if(!jwt)return ownerReject('jwt_missing');
 if(jwt.length>16384)return ownerReject('jwt_oversize');
 if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD||!env.OWNER_EMAIL)return ownerReject('config_missing');
 const parts=jwt.split('.');
 if(parts.length!==3)return ownerReject('jwt_format');
 try{
  const header=JSON.parse(new TextDecoder().decode(decodeJwtPart(parts[0])));
  const claims=JSON.parse(new TextDecoder().decode(decodeJwtPart(parts[1])));
  const now=Math.floor(Date.now()/1000);
  const issuer='https://'+env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//,'').replace(/\/+$/,'');
  if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid)return ownerReject('jwt_algorithm');
  if(claims.iss!==issuer)return ownerReject('issuer_mismatch');
  if(!([].concat(claims.aud||[]).includes(env.ACCESS_AUD)))return ownerReject('audience_mismatch');
  if(typeof claims.email!=='string'||claims.email.toLowerCase()!==env.OWNER_EMAIL.toLowerCase())return ownerReject('owner_mismatch');
  if(!Number.isFinite(claims.exp)||claims.exp<=now||(claims.nbf&&claims.nbf>now))return ownerReject('jwt_expired_or_early');
  let key=accessJwks?.keys?.find(k=>k.kid===header.kid);
  if(!key||Date.now()-accessJwksAt>300000){
   const res=await fetch(issuer+'/cdn-cgi/access/certs',{redirect:'manual',signal:AbortSignal.timeout(5000)});
   if(!res.ok)return ownerReject('jwks_fetch_failed');
   const jwks=await res.json();
   if(!Array.isArray(jwks?.keys))return ownerReject('jwks_invalid');
   accessJwks=jwks;accessJwksAt=Date.now();
   key=jwks.keys.find(k=>k.kid===header.kid);
  }
  if(!key)return ownerReject('jwt_key_not_found');
  const publicKey=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',publicKey,decodeJwtPart(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if(!ok)return ownerReject('signature_invalid');
  console.info('go_brain_owner_verification',JSON.stringify({verified:true,mode:'signed_access_jwt'}));
  return true;
 }catch{return ownerReject('jwt_validation_exception');}
}
async function owner(req,env,ctx){
 if(env.BRAIN_AUTH_MODE==='DIRECT' && new URL(req.url).pathname==='/mcp'){
  try{const identity=await verifyAccessToken(req,brainOAuthConfig(env));return identity.owner==='BIG' && identity.actor==='GO' && identity.scope==='brain-owner';}catch{return false;}
 }
 if(ctx?.access?.aud===env.ACCESS_AUD){
  try{
   const identity=await ctx.access.getIdentity();
   if(identity?.email){
    if(identity.email.toLowerCase()!==env.OWNER_EMAIL?.toLowerCase())return ownerReject('owner_mismatch');
    console.info('go_brain_owner_verification',JSON.stringify({verified:true,mode:'trusted_context'}));
    return true;
   }
  }catch{console.warn('go_brain_owner_verification',JSON.stringify({verified:false,stage:'ctx_identity_unavailable'}));}
 }else if(ctx?.access){
  console.warn('go_brain_owner_verification',JSON.stringify({verified:false,stage:'ctx_audience_mismatch'}));
 }
 return signedAccessOwner(req,env);
}
export default {async fetch(req,env,ctx){try{const url=new URL(req.url),p=url.pathname;
if(p==='/_release/acceptance'){
 if(req.method!=='POST'||!/^Bearer [A-Za-z0-9_.-]{1,16000}$/.test(req.headers.get('authorization')||''))return error(403,'RELEASE_CI_UNAUTHORIZED');
 try{const payload=await body(req,true,2048);return reply(await goCiAcceptance({authorization:req.headers.get('authorization'),body:payload},env));}
 catch{return error(403,'RELEASE_CI_ACCEPTANCE_DENIED');}
}
if(p.startsWith('/oauth/')||p.startsWith('/.well-known/oauth-'))return createOAuthHandler(brainOAuthConfig(env))(req);
if(p==='/api/health'){const v=await env.DB.prepare('SELECT 1 AS healthy').first();return reply({ok:v?.healthy===1,app:'GO-Together Personal Brain',storage:'Cloudflare D1',binding:'DB',memory_api_enabled:true,authentication:env.BRAIN_AUTH_MODE==='DIRECT'?'direct-cimd-pkce':'owner-only',source_sha:SOURCE_SHA},v?.healthy===1?200:503);}
if(p==='/auth/login')return (await owner(req,env,ctx))?Response.redirect(ORIGIN+'/',303):error(401,'owner_auth_required');
if(p==='/mcp')return await mcp(req,env,ctx);
if(p.startsWith('/api/'))return await api(req,env,url,ctx);
return env.ASSETS.fetch(req);
}catch(e){if(e instanceof Bad)return error(e.status,e.message);if(e instanceof FactoryApprovalError)return error(e.status,e.code);console.error('GO-Together error',e?.name);return error(500,'internal_error');}}};



// Standard MCP served only through AppTools, grouped by the source owner.
// Calls dispatch locally here to avoid GO -> Hub -> GO -> Hub recursion.
export async function appMcp(req,env){
 const group=new URL(req.url).pathname.match(/^\/hub-mcp\/(brain|factory|observatory|goview)$/)?.[1];
 if(!group)return error(404,'not_found');if(req.method!=='POST')return error(405,'method_not_allowed');
 const x=await body(req);
 const source=tools.filter(t=>hubGroup(t.name)===group);
 if(x.method==='notifications/initialized')return new Response(null,{status:202});
 if(x.method==='initialize')return rpc(x.id,{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'go-'+group,version:'1.0.0'}});
 if(x.method==='tools/list')return rpc(x.id,{tools:source});
 if(x.method==='tools/call'){
  if(!source.some(t=>t.name===x.params?.name))return rpc(x.id,{isError:true,content:[{type:'text',text:'UNKNOWN_TOOL'}]});
  try{return rpc(x.id,{content:[{type:'text',text:JSON.stringify(await toolCall(x.params.name,x.params.arguments,env.DB,env,true))}]});}
  catch(e){return rpc(x.id,{isError:true,content:[{type:'text',text:e.message}]});}
 }
 return reply({jsonrpc:'2.0',id:x.id,error:{code:-32601,message:'method_not_found'}});
}

