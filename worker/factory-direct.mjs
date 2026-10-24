// GO->Factory: authenticated owner MCP + private binding + dedicated HMAC.
// Factory derives Job ID and its internal machine ticket; no caller Work Pass.
const HOST='https://factory-district.internal', PROTO='METROPOLIS_FACTORY_STATION_V2';
const JOB=/^GOJOB-[a-f0-9]{32}$/,RECEIPT=/^receipt-[A-Za-z0-9-]{8,80}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure=(status,extra={})=>({ok:false,status,executed:false,...extra});
export const GO_AUTH_PROBE_PURPOSE='GO_FACTORY_AUTH_PROBE_V1';
export function goRailSecretConfigured(secret){
  if(typeof secret!=='string'||secret!==secret.trim()||
    /[\u0000-\u001f\u007f]/.test(secret)||
    /^(?:PENDING[_-]|PLACEHOLDER|DUMMY|CHANGE[_-]?ME|REPLACE[_-]?ME|TEST[_-]?ONLY)/i.test(secret))
    return false;
  const bytes=new TextEncoder().encode(secret).length;
  return bytes>=32&&bytes<=1024;
}
const configured=e=>goRailSecretConfigured(e?.GO_FACTORY_RAIL_SECRET)
  &&typeof e?.FACTORY_DIRECT?.fetch==='function';
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
async function digest(buffer){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function signed(env,method,path,value){
  const body=value===undefined?'':JSON.stringify(value),timestamp=String(Date.now());
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GO_FACTORY_RAIL_SECRET),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode(timestamp+'.'+body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  return env.FACTORY_DIRECT.fetch(new Request(HOST+path,{method,headers:{
    'x-factory-client':'GO','x-metropolis-factory-protocol':PROTO,
    'x-metropolis-factory-timestamp':timestamp,'x-metropolis-factory-signature':sig,
    ...(value===undefined?{}:{'content-type':'application/json'})},
    ...(value===undefined?{}:{body})}));
}
async function jsonRequest(env,method,path,value){
  const r=await signed(env,method,path,value);
  let data;try{data=await r.json();}catch{return {ok:false,httpStatus:r.status,data:{status:'INVALID_FACTORY_RESPONSE'}};}
  return {ok:r.ok,httpStatus:r.status,data};
}
function validReceipt(v,id){return v?.receiptId===id&&JOB.test(v.workId||'')&&
  v.checkpointId==='CP-'+v.workId&&v.originSystem==='go-together'&&
  v.actingActor==='GO'&&v.authorizationSource==='WORK_PASS'&&
  v.stationId==='FACTORY-STATION'&&/^[a-f0-9]{40}$/.test(v.sourceSha||'');}
async function boundedProbeJson(response){
  if(!response.body)return null;
  const reader=response.body.getReader(),chunks=[];
  let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>4096){await reader.cancel();return null;}
      chunks.push(value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder().decode(bytes));
  }catch{return null;}finally{reader.releaseLock();}
}
// Challenge is HMAC authenticated both directions; it is never a work
// request and never returns an HMAC proof or secret material to MCP callers.
export async function factoryDirectAuthProbe(env={}){
  const base={readOnly:true,executed:false,authenticated:false,
    transport:'CLOUDFLARE_PRIVATE_SERVICE_BINDING',commandReady:false};
  if(typeof env.FACTORY_DIRECT?.fetch!=='function')
    return {...base,...failure('SERVICE_BINDING_NOT_CONFIGURED')};
  if(!goRailSecretConfigured(env.GO_FACTORY_RAIL_SECRET))
    return {...base,...failure('GO_KEY_UNSUPPORTED_OR_PLACEHOLDER')};
  try{
    const nonce=[...crypto.getRandomValues(new Uint8Array(16))]
      .map(x=>x.toString(16).padStart(2,'0')).join('');
    const response=await signed(env,'POST','/station/go-auth-probe',
      {purpose:GO_AUTH_PROBE_PURPOSE,nonce});
    if(!response.ok){
      const error=response.status===503?await boundedProbeJson(response):null;
      const status=response.status===401?'FACTORY_SIGNATURE_REJECTED'
        :response.status===503&&error?.reason==='GO_FACTORY_RAIL_KEY_NOT_CONFIGURED'
          ?'FACTORY_GO_KEY_NOT_CONFIGURED'
        :response.status===503&&error?.reason==='DURABLE_STORAGE_NOT_CONFIGURED'
          ?'FACTORY_STORAGE_NOT_CONFIGURED'
        :response.status===404?'FACTORY_AUTH_PROBE_NOT_DEPLOYED'
        :'FACTORY_AUTH_PROBE_REJECTED';
      return {...base,...failure(status,{upstreamStatus:response.status})};
    }
    const probe=await boundedProbeJson(response);
    if(probe?.status!=='AUTHENTICATED'||probe.service!=='factory-district'||
      probe.stationId!=='FACTORY-STATION'||probe.nonce!==nonce||
      probe.readOnly!==true||probe.executed!==false||
      !/^[a-f0-9]{40}$/.test(probe.sourceSha||'')||
      !/^[a-f0-9]{64}$/.test(probe.proof||''))
      return {...base,...failure('FACTORY_AUTH_RESPONSE_INVALID')};
    const key=await crypto.subtle.importKey('raw',
      new TextEncoder().encode(env.GO_FACTORY_RAIL_SECRET),
      {name:'HMAC',hash:'SHA-256'},false,['verify']);
    const bytes=Uint8Array.from(probe.proof.match(/../g),h=>parseInt(h,16));
    const msg=GO_AUTH_PROBE_PURPOSE+'\n'+nonce+'\n'+probe.sourceSha+'\nFACTORY-STATION';
    const verified=await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(msg));
    if(!verified)return {...base,...failure('FACTORY_AUTH_PROOF_MISMATCH')};
    return {...base,ok:true,status:'AUTHENTICATED',authenticated:true,
      keyState:'AUTHENTICATED',sourceSha:probe.sourceSha};
  }catch{return {...base,...failure('FACTORY_AUTH_PROBE_UNAVAILABLE')};}
}
export async function factoryDirectStatus(env={}){
  const base={route:'GO_BRAIN_TO_FACTORY_DIRECT',readOnly:true,
    keyState:goRailSecretConfigured(env.GO_FACTORY_RAIL_SECRET)
      ?'KEY_PRESENT_NOT_AUTHENTICATED':'KEY_UNSUPPORTED_OR_PLACEHOLDER',
    commandReady:false};
  if(typeof env.FACTORY_DIRECT?.fetch!=='function')
    return {...base,...failure('SERVICE_BINDING_NOT_CONFIGURED')};
  try{
    const response=await env.FACTORY_DIRECT.fetch(new Request(HOST+'/health'));
    if(!response.ok)return {...base,...failure('FACTORY_HTTP_ERROR',{httpStatus:response.status})};
    const x=await response.json();
    if(x?.service!=='factory-district'||x.stationId!=='FACTORY-STATION')
      return {...base,...failure('FACTORY_IDENTITY_MISMATCH')};
    const machinery=Object.fromEntries(['CODE','VISUAL','LOGIC'].map(domain=>[
      domain,x.machinery?.[domain]?.status==='READY'?'READY':'UNKNOWN']));
    const probe=await factoryDirectAuthProbe(env);
    const authenticated=probe.authenticated===true && probe.sourceSha===x.sourceSha;
    const up=x.status==='READY'&&x.storage?.status==='READY'&&
      x.transport?.status==='READY'&&Object.values(machinery).some(v=>v==='READY');
    return {...base,ok:true,status:'CONNECTED',runtime:x.status==='READY'?'READY':'UNKNOWN',
      sourceSha:/^[a-f0-9]{40}$/.test(x.sourceSha||'')?x.sourceSha:null,
      machinery,capabilities:{CODE:'BOUNDED_EDGE_JS',VISUAL:'STATIC_CARD_PNG',
        LOGIC:'DWARF_TRAINING_ONLY'},
      keyState:authenticated?'AUTHENTICATED':base.keyState,
      authStatus:probe.authenticated===true&&!authenticated
        ?'FACTORY_AUTH_SOURCE_MISMATCH':probe.status,
      commandReady:authenticated&&up};
  }catch{return {...base,...failure('DIRECT_FACTORY_UNAVAILABLE')};}
}
export async function factoryDirectReadback(env,{receiptId}={}){
  if(!RECEIPT.test(receiptId||''))return failure('RECEIPT_ID_INVALID');
  if(!configured(env))return failure('DIRECT_RAIL_NOT_CONFIGURED');
  try{
    const r=await jsonRequest(env,'GET','/station/readback/'+encodeURIComponent(receiptId));
    if(!r.ok||!validReceipt(r.data,receiptId))return failure('DIRECT_RECEIPT_UNVERIFIED',{httpStatus:r.httpStatus});
    const x=r.data;
    return {ok:true,status:'GO_RECEIPT_READ',readOnly:true,executed:false,
      verified:x.domainVerified===true&&x.domainCompleted===true,
      jobId:x.workId,receiptId,domain:x.result?.ownerDomain||null,sourceSha:x.sourceSha,
      artifactRefs:x.result?.artifactRefs||[],evidenceRefs:x.result?.evidenceRefs||[]};
  }catch{return failure('DIRECT_FACTORY_UNAVAILABLE');}
}
export async function factoryDirectJobStatus(env,{requestId}={}){
  if(!UUID.test(requestId||''))return failure('GO_REQUEST_ID_INVALID');
  if(!configured(env))return failure('DIRECT_RAIL_NOT_CONFIGURED',{requestId});
  try{
    const r=await jsonRequest(env,'POST','/station/go-job-status',{requestId});
    if(!r.ok||r.data?.requestId!==requestId||!JOB.test(r.data.jobId||''))
      return failure('GO_JOB_STATUS_UNKNOWN',{requestId,httpStatus:r.httpStatus});
    const rid=r.data.receiptId;
    if(!RECEIPT.test(rid||''))return failure('GO_JOB_STATUS_UNCERTAIN',{requestId,jobId:r.data.jobId});
    const receipt=await factoryDirectReadback(env,{receiptId:rid});
    if(!receipt.ok||receipt.jobId!==r.data.jobId)
      return failure('GO_JOB_READBACK_UNVERIFIED',{requestId,jobId:r.data.jobId,receiptId:rid});
    return {...receipt,requestId,status:'GO_JOB_STATUS_READ'};
  }catch{return failure('GO_JOB_STATUS_UNAVAILABLE',{requestId});}
}
export async function factoryDirectArtifact(env,{receiptId,artifactRef}={}){
  if(typeof artifactRef!=='string'||artifactRef.length>900||
    !artifactRef.startsWith('r2://factory/edge-results/'))
    return failure('ARTIFACT_REF_INVALID');
  const receipt=await factoryDirectReadback(env,{receiptId});
  if(!receipt.ok||!receipt.verified||!receipt.artifactRefs.includes(artifactRef))
    return failure('ARTIFACT_NOT_IN_GO_RECEIPT');
  try{
    const response=await signed(env,'POST','/station/go-artifact',{receiptId,artifactRef});
    if(!response.ok)return failure('DIRECT_ARTIFACT_UNAVAILABLE',{httpStatus:response.status});
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength>524288)return failure('ARTIFACT_EXCEEDS_MCP_LIMIT');
    const hash=await digest(bytes);
    if(response.headers.get('x-factory-artifact-sha256')!==hash||
      response.headers.get('x-factory-receipt-id')!==receiptId||
      response.headers.get('x-factory-source-sha')!==receipt.sourceSha)
      return failure('ARTIFACT_INTEGRITY_MISMATCH');
    const mime=response.headers.get('content-type');
    if(!['image/png','text/javascript; charset=utf-8','text/html; charset=utf-8','application/octet-stream'].includes(mime))
      return failure('ARTIFACT_MIME_UNEXPECTED');
    const u=new Uint8Array(bytes);let bin='';
    for(let i=0;i<u.length;i+=16384)bin+=String.fromCharCode(...u.slice(i,i+16384));
    return {ok:true,status:'ARTIFACT_BYTES_DELIVERED',executed:false,readOnly:true,
      receiptId,jobId:receipt.jobId,artifactRef,mime,bytes:u.length,sha256:hash,base64:btoa(bin)};
  }catch{return failure('DIRECT_ARTIFACT_UNAVAILABLE');}
}
export async function factoryDirectSubmit(env,{domain,spec,requestId}={},approved=false){
  if(approved!==true)return failure('OWNER_APPROVAL_REQUIRED');
  if(!['CODE','VISUAL','LOGIC'].includes(domain)||!object(spec))
    return failure('GO_JOB_SPEC_INVALID');
  const id=requestId===undefined?crypto.randomUUID():requestId;
  if(!UUID.test(id))return failure('GO_REQUEST_ID_INVALID');
  if(!configured(env))return failure('DIRECT_RAIL_NOT_CONFIGURED',{requestId:id});
  try{
    const h=await factoryDirectStatus(env);
    if(!h.ok||!h.sourceSha||h.runtime!=='READY'||h.machinery?.[domain]!=='READY')
      return failure('FACTORY_NOT_READY',{requestId:id});
    if(h.commandReady!==true)
      return failure('GO_FACTORY_AUTH_NOT_READY',{requestId:id,authStatus:h.authStatus});
    const input={requestId:id,domain,spec,expectedSourceSha:h.sourceSha};
    if(new TextEncoder().encode(JSON.stringify(input)).length>65536)
      return failure('GO_JOB_TOO_LARGE',{requestId:id});
    const r=await jsonRequest(env,'POST','/station/go-job',input),x=r.data||{};
    if(!r.ok||x.status!=='COMPLETED'||x.requestId!==id||
      !JOB.test(x.jobId||'')||!RECEIPT.test(x.receiptId||''))
      return failure('GO_JOB_EFFECT_UNVERIFIED',{requestId:id,
        jobId:JOB.test(x.jobId||'')?x.jobId:null,
        receiptId:RECEIPT.test(x.receiptId||'')?x.receiptId:null,
        httpStatus:r.httpStatus,reason:x.reason||x.status});
    const back=await factoryDirectReadback(env,{receiptId:x.receiptId});
    if(!back.ok||!back.verified||back.jobId!==x.jobId||
      back.sourceSha!==h.sourceSha||back.domain!==domain)
      return failure('GO_RECEIPT_UNVERIFIED',{requestId:id,jobId:x.jobId,receiptId:x.receiptId});
    if(domain==='LOGIC')return {ok:true,status:'LOGIC_TRAINING_PLACED',
      requestId:id,jobId:x.jobId,receiptId:x.receiptId,
      sourceSha:h.sourceSha,evidenceRefs:back.evidenceRefs,executed:true,
      deliveredBytes:false,capability:'DWARF_TRAINING_ONLY'};
    const suffix=domain==='CODE'?'/main.js':'/render.png';
    const ref=back.artifactRefs.find(v=>typeof v==='string'&&
      v.startsWith('r2://factory/edge-results/')&&v.endsWith(suffix));
    if(!ref)return failure('GO_ARTIFACT_REF_MISSING',{requestId:id,jobId:x.jobId,receiptId:x.receiptId});
    const artifact=await factoryDirectArtifact(env,{receiptId:x.receiptId,artifactRef:ref});
    if(!artifact.ok)return {...artifact,requestId:id,jobId:x.jobId,receiptId:x.receiptId};
    return {ok:true,status:'GO_FACTORY_DELIVERABLE_READY',requestId:id,
      jobId:x.jobId,receiptId:x.receiptId,domain,sourceSha:h.sourceSha,
      artifactRef:ref,evidenceRefs:back.evidenceRefs,
      artifact:{mime:artifact.mime,bytes:artifact.bytes,sha256:artifact.sha256,
        base64:artifact.base64},executed:true,deliveredBytes:true};
  }catch{return failure('GO_JOB_TRANSPORT_UNCERTAIN',{requestId:id});}
}
