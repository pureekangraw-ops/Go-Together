import {validRepositoryJob} from './factory-repository-job.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const DOMAINS=new Set(['CODE','VISUAL','LOGIC','PROOF']);
const SENSITIVE_KEY=/(?:password|secret|credential|api[_-]?key|private[_-]?key|authorization|cookie)/i;
const REPO=/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const SHA40=/^[a-f0-9]{40}$/;
const FILE_PATH=/^(?:src|scripts|examples|docs)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:js|mjs)$/;
function hasSensitiveKey(value){if(Array.isArray(value))return value.some(hasSensitiveKey);if(!value||typeof value!=='object')return false;return Object.entries(value).some(([key,item])=>SENSITIVE_KEY.test(key)||hasSensitiveKey(item));}
const SAFE_NO_EXECUTION=new Set([
  'GO_JOB_SPEC_INVALID','GO_REQUEST_ID_INVALID','GO_JOB_TOO_LARGE',
  'DIRECT_RAIL_NOT_CONFIGURED','FACTORY_NOT_READY','GO_FACTORY_AUTH_NOT_READY',
  'FACTORY_IMAGE_SPLIT_SOURCE_NOT_INSTALLED','FACTORY_WORKSHOP_NOT_READY'
]);
export class FactoryApprovalError extends Error {
  constructor(status,code){super(code);this.name='FactoryApprovalError';this.status=status;this.code=code;}
}
function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
async function digest(value){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function parseJson(value,fallback=null){try{return value?JSON.parse(value):fallback;}catch{return fallback;}}
function compact(value,depth=0){
  if(depth>8)return '[truncated]';
  if(typeof value==='string')return value.length>4000?value.slice(0,4000)+'…':value;
  if(Array.isArray(value))return value.slice(0,100).map(x=>compact(x,depth+1));
  if(value&&typeof value==='object'){
    const out={};for(const [k,v] of Object.entries(value)){
      if(k==='base64')continue;
      out[k]=compact(v,depth+1);
    }return out;
  }
  return value;
}
function view(row){
  if(!row)return null;
  return {
    id:row.id,requestId:row.request_id,domain:row.domain,
    payload:parseJson(row.payload_json,{}),payloadSha256:row.payload_sha256,
    status:row.status,createdBy:row.created_by,createdAt:row.created_at,
    approvedBy:row.approved_by||null,approvedAt:row.approved_at||null,
    approvedPayloadSha256:row.approved_payload_sha256||null,
    rejectedBy:row.rejected_by||null,rejectedAt:row.rejected_at||null,
    result:parseJson(row.result_json,null),updatedAt:row.updated_at
  };
}
async function rowById(db,id){return db.prepare('SELECT * FROM factory_approvals WHERE id=?').bind(id).first();}
export async function getFactoryApproval(db,id){
  if(!UUID.test(id||''))throw new FactoryApprovalError(400,'APPROVAL_ID_INVALID');
  return view(await rowById(db,id));
}
export async function listFactoryApprovals(db,limit=100){
  const n=Math.min(100,Math.max(1,Number(limit)||50));
  const [pending,recent]=await Promise.all([
    db.prepare("SELECT * FROM factory_approvals WHERE status='PENDING' ORDER BY created_at ASC").all(),
    db.prepare("SELECT * FROM factory_approvals WHERE status<>'PENDING' ORDER BY created_at DESC LIMIT ?").bind(n).all()
  ]);
  return [...(pending.results||[]),...(recent.results||[])].map(view);
}
export async function createFactoryApproval(db,{domain,spec,requestId,githubDelivery,createdBy}={}){
  if(!DOMAINS.has(domain)||!spec||typeof spec!=='object'||Array.isArray(spec))
    throw new FactoryApprovalError(400,'FACTORY_PROPOSAL_INVALID');
  if(!UUID.test(requestId||''))throw new FactoryApprovalError(400,'GO_REQUEST_ID_INVALID');
  if(hasSensitiveKey({spec,githubDelivery}))throw new FactoryApprovalError(400,'SENSITIVE_INPUT_NOT_ALLOWED');
  if(typeof createdBy!=='string'||!createdBy.trim())throw new FactoryApprovalError(403,'OWNER_IDENTITY_REQUIRED');
  if(githubDelivery!==undefined){
    if(domain!=='CODE'||!githubDelivery||typeof githubDelivery!=='object'||Array.isArray(githubDelivery)||
      Object.keys(githubDelivery).some(k=>!['repo','baseSha','filePath'].includes(k))||
      !REPO.test(githubDelivery.repo||'')||!SHA40.test(githubDelivery.baseSha||'')||
      !FILE_PATH.test(githubDelivery.filePath||'')||githubDelivery.filePath.split('/').includes('..'))
      throw new FactoryApprovalError(400,'FACTORY_GITHUB_DELIVERY_INVALID');
  }
  if(spec.repositoryJob!==undefined&&(domain!=='CODE'||githubDelivery!==undefined||Object.keys(spec).length!==1||!validRepositoryJob(spec.repositoryJob)))
    throw new FactoryApprovalError(400,'REPOSITORY_JOB_INVALID');
  const payload={domain,spec,requestId,...(githubDelivery===undefined?{}:{githubDelivery})};
  const payloadJson=canonical(payload);
  if(new TextEncoder().encode(payloadJson).length>65536)
    throw new FactoryApprovalError(413,'GO_JOB_TOO_LARGE');
  const payloadSha256=await digest(payloadJson);
  const prior=await db.prepare('SELECT * FROM factory_approvals WHERE request_id=?').bind(requestId).first();
  if(prior){
    if(prior.payload_sha256!==payloadSha256)throw new FactoryApprovalError(409,'REQUEST_ID_PAYLOAD_CONFLICT');
    return view(prior);
  }
  const id=crypto.randomUUID(),now=new Date().toISOString();
  try{
    await db.prepare(`INSERT INTO factory_approvals
      (id,request_id,domain,payload_json,payload_sha256,status,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,'PENDING',?,?,?)`).bind(id,requestId,domain,payloadJson,payloadSha256,createdBy.trim(),now,now).run();
  }catch{
    const raced=await db.prepare('SELECT * FROM factory_approvals WHERE request_id=?').bind(requestId).first();
    if(raced&&raced.payload_sha256===payloadSha256)return view(raced);
    if(raced)throw new FactoryApprovalError(409,'REQUEST_ID_PAYLOAD_CONFLICT');
    throw new FactoryApprovalError(500,'APPROVAL_PERSIST_FAILED');
  }
  const created=await rowById(db,id);
  if(!created)throw new FactoryApprovalError(500,'APPROVAL_PERSIST_FAILED');
  return view(created);
}
function nextAfterDispatch(result){
  if(result?.ok===true){
    if(['VISUAL_JOB_ACCEPTED','CODE_REPOSITORY_JOB_ACCEPTED'].includes(result.status)||['ACCEPTED','IN_PROGRESS','UNKNOWN'].includes(result.jobStatus))return 'RUNNING';
    if(result.executed===true||result.pullRequestUrl||result.prUrl||result.status==='GITHUB_PR_CREATED')return 'COMPLETED';
    return 'UNKNOWN';
  }
  return SAFE_NO_EXECUTION.has(result?.status)?'FAILED_NO_EXECUTION':'UNKNOWN';
}
export async function approveFactoryApproval(db,{id,payloadSha256,actor,dispatch,now=new Date().toISOString()}={}){
  if(!UUID.test(id||''))throw new FactoryApprovalError(400,'APPROVAL_ID_INVALID');
  if(!HASH.test(payloadSha256||''))throw new FactoryApprovalError(400,'APPROVAL_HASH_INVALID');
  if(typeof actor!=='string'||!actor.trim())throw new FactoryApprovalError(403,'OWNER_IDENTITY_REQUIRED');
  if(typeof dispatch!=='function')throw new FactoryApprovalError(500,'APPROVAL_DISPATCH_UNAVAILABLE');
  const row=await rowById(db,id);
  if(!row)throw new FactoryApprovalError(404,'APPROVAL_NOT_FOUND');
  if(row.status!=='PENDING')throw new FactoryApprovalError(409,'APPROVAL_NOT_PENDING');
  if(row.payload_sha256!==payloadSha256)throw new FactoryApprovalError(409,'APPROVAL_PAYLOAD_CHANGED');
  const claimed=await db.prepare(`UPDATE factory_approvals SET status='DISPATCHING',approved_by=?,approved_at=?,
      approved_payload_sha256=?,updated_at=? WHERE id=? AND status='PENDING' AND payload_sha256=? RETURNING *`)
    .bind(actor.trim(),now,payloadSha256,now,id,payloadSha256).first();
  if(!claimed)throw new FactoryApprovalError(409,'APPROVAL_ALREADY_HANDLED');
  const payload=parseJson(claimed.payload_json,{});
  let result;
  try{result=await dispatch(payload);}catch{result={ok:false,status:'GO_JOB_TRANSPORT_UNCERTAIN',executed:false,requestId:claimed.request_id};}
  const status=nextAfterDispatch(result),updatedAt=new Date().toISOString();
  const stored=JSON.stringify(compact(result));
  await db.prepare(`UPDATE factory_approvals SET status=?,result_json=?,updated_at=?
    WHERE id=? AND status='DISPATCHING'`).bind(status,stored,updatedAt,id).run();
  return {approval:await getFactoryApproval(db,id),dispatchResult:result};
}
export async function rejectFactoryApproval(db,{id,payloadSha256,actor,now=new Date().toISOString()}={}){
  if(!UUID.test(id||''))throw new FactoryApprovalError(400,'APPROVAL_ID_INVALID');
  if(!HASH.test(payloadSha256||''))throw new FactoryApprovalError(400,'APPROVAL_HASH_INVALID');
  if(typeof actor!=='string'||!actor.trim())throw new FactoryApprovalError(403,'OWNER_IDENTITY_REQUIRED');
  const rejected=await db.prepare(`UPDATE factory_approvals SET status='REJECTED',rejected_by=?,rejected_at=?,updated_at=?
    WHERE id=? AND status='PENDING' AND payload_sha256=? RETURNING *`)
    .bind(actor.trim(),now,now,id,payloadSha256).first();
  if(!rejected){
    const row=await rowById(db,id);
    if(!row)throw new FactoryApprovalError(404,'APPROVAL_NOT_FOUND');
    if(row.payload_sha256!==payloadSha256)throw new FactoryApprovalError(409,'APPROVAL_PAYLOAD_CHANGED');
    throw new FactoryApprovalError(409,'APPROVAL_NOT_PENDING');
  }
  return view(rejected);
}
export async function reconcileFactoryApproval(db,{id,statusReader}={}){
  const row=await rowById(db,id);
  if(!row)throw new FactoryApprovalError(404,'APPROVAL_NOT_FOUND');
  if(!['DISPATCHING','RUNNING','UNKNOWN'].includes(row.status))return view(row);
  if(typeof statusReader!=='function')throw new FactoryApprovalError(500,'APPROVAL_STATUS_UNAVAILABLE');
  let read;
  try{read=await statusReader(row.request_id,parseJson(row.payload_json,{}));}catch{return view(row);}
  let status=row.status;
  if(read?.ok&&read.jobStatus==='COMPLETED'&&read.verified===true)status='COMPLETED';
  else if(read?.ok&&['ACCEPTED','IN_PROGRESS'].includes(read.jobStatus))status='RUNNING';
  else if(read?.ok&&read.jobStatus==='FAILED'&&read.verified===true)status='FAILED';
  else if(row.status==='DISPATCHING'&&read?.status==='GO_JOB_STATUS_UNKNOWN')status='UNKNOWN';
  await db.prepare('UPDATE factory_approvals SET status=?,result_json=?,updated_at=? WHERE id=? AND status=?')
    .bind(status,JSON.stringify(compact(read)),new Date().toISOString(),id,row.status).run();
  return view(await rowById(db,id));
}

