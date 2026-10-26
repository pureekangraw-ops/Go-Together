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
function canonicalContent(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonicalContent).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalContent(value[key])).join(',')+'}';
}
export async function signedFactoryRequest(env,method,path,value,signal){
  const body=value===undefined?'':JSON.stringify(value),timestamp=String(Date.now());
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GO_FACTORY_RAIL_SECRET),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode(timestamp+'.'+body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  return env.FACTORY_DIRECT.fetch(new Request(HOST+path,{method,...(signal?{signal}:{}),headers:{
    'x-factory-client':'GO','x-metropolis-factory-protocol':PROTO,
    'x-metropolis-factory-timestamp':timestamp,'x-metropolis-factory-signature':sig,
    ...(value===undefined?{}:{'content-type':'application/json'})},
    ...(value===undefined?{}:{body})}));
}
const signed=signedFactoryRequest;
async function jsonRequest(env,method,path,value){
  const r=await signed(env,method,path,value);
  let data;try{data=await r.json();}catch{return {ok:false,httpStatus:r.status,data:{status:'INVALID_FACTORY_RESPONSE'}};}
  return {ok:r.ok,httpStatus:r.status,data};
}
function validReceipt(v,id){return v?.receiptId===id&&JOB.test(v.workId||'')&&
  v.checkpointId==='CP-'+v.workId&&v.originSystem==='go-together'&&
  v.actingActor==='GO'&&v.authorizationSource==='WORK_PASS'&&
  v.stationId==='FACTORY-STATION'&&/^[a-f0-9]{40}$/.test(v.sourceSha||'');}
const safeJobReason=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,95}$/.test(value)?value:null;
const QUEUE_EXECUTOR='FACTORY_VISUAL_QUEUE_V1';
function queueMetadata(x,requestId){
  if(x?.executor!==QUEUE_EXECUTOR||x.domain!=='VISUAL'||x.requestId!==requestId||
    !JOB.test(x.jobId||'')||!/^[a-f0-9]{40}$/.test(x.sourceSha||'')||
    !Number.isSafeInteger(x.admittedAt)||x.admittedAt<0||
    !Number.isSafeInteger(x.deadlineAt)||x.deadlineAt-x.admittedAt!==300000)return null;
  return {executor:QUEUE_EXECUTOR,sourceSha:x.sourceSha,admittedAt:x.admittedAt,deadlineAt:x.deadlineAt};
}
function receiptArtifacts(x){
  const artifacts=x.result?.artifacts;
  if(artifacts===undefined)return undefined; // Legacy receipts have no manifest.
  if(!Array.isArray(artifacts)||artifacts.length>64)return null;
  const refs=x.result?.artifactRefs;
  if(!Array.isArray(refs)||artifacts.some(a=>!object(a)||!refs.includes(a.ref)||
    !/^[a-f0-9]{64}$/.test(a.sha256||'')||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>8*1024*1024||
    ((a.width!==undefined||a.height!==undefined)&&(!Number.isSafeInteger(a.width)||a.width<1||a.width>4096||!Number.isSafeInteger(a.height)||a.height<1||a.height>4096))))return null;
  return artifacts.map(a=>({ref:a.ref,sha256:a.sha256,bytes:a.bytes,
    ...(a.width===undefined?{}:{width:a.width,height:a.height})}));
}
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
    const machinery=Object.fromEntries(['CODE','VISUAL','LOGIC','PROOF'].map(domain=>[
      domain,x.machinery?.[domain]?.status==='READY'?'READY':'UNKNOWN']));
    const probe=await factoryDirectAuthProbe(env);
    const authenticated=probe.authenticated===true && probe.sourceSha===x.sourceSha;
    const up=x.status==='READY'&&x.storage?.status==='READY'&&
      x.transport?.status==='READY'&&Object.values(machinery).some(v=>v==='READY');
    return {...base,ok:true,status:'CONNECTED',runtime:x.status==='READY'?'READY':'UNKNOWN',
      sourceSha:/^[a-f0-9]{40}$/.test(x.sourceSha||'')?x.sourceSha:null,
      machinery,capabilities:{CODE:'BOUNDED_EDGE_JS',
        VISUAL:Array.isArray(x.machinery?.VISUAL?.intents)&&
          x.machinery.VISUAL.intents.includes('ALPHA_CUTOUT_V1')
          ?'STATIC_CARD_AND_ALPHA_CUTOUT_SOURCE_INSTALLED':'STATIC_CARD_PNG',
        LOGIC:x.machinery?.LOGIC?.genericRunner?.status==='READY'?'BOUNDED_WORKSHOP_AND_DWARF':'DWARF_TRAINING_ONLY',
        PROOF:'FACTORY_RECEIPT_CHECK_AND_HISTORICAL_CATALOG'},
      workshopReady:x.machinery?.LOGIC?.genericRunner?.status==='READY',
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
    const artifacts=receiptArtifacts(x);
    if(artifacts===null)return failure('DIRECT_RECEIPT_UNVERIFIED',{httpStatus:r.httpStatus});
    const verified=x.domainVerified===true&&x.domainCompleted===true;
    return {ok:true,status:'GO_RECEIPT_READ',readOnly:true,executed:false,
      verified,jobStatus:verified?'COMPLETED':x.status==='FAILED'?'FAILED':'UNKNOWN',
      reason:safeJobReason(x.reason),
      jobId:x.workId,receiptId,domain:x.result?.ownerDomain||null,sourceSha:x.sourceSha,
      ...(typeof x.observedAt==='string'&&Number.isFinite(Date.parse(x.observedAt))?{observedAt:x.observedAt}:{}),
      artifactRefs:x.result?.artifactRefs||[],evidenceRefs:x.result?.evidenceRefs||[],
      ...(artifacts===undefined?{}:{artifacts}),
      ...(x.machineResult?.workshopResult?{workshopResult:x.machineResult.workshopResult}:{}),
      ...(x.machineResult?.proofResult?{proofResult:x.machineResult.proofResult,reportRef:x.machineResult.reportRef}:{}),
      ...(x.jobStamp?{jobStamp:x.jobStamp}:{}),
      deliveryAuthorized:x.jobStamp?.status==='PASS'};
  }catch{return failure('DIRECT_FACTORY_UNAVAILABLE');}
}
export async function factoryDirectJobStatus(env,{requestId}={}){
  if(!UUID.test(requestId||''))return failure('GO_REQUEST_ID_INVALID');
  if(!configured(env))return failure('DIRECT_RAIL_NOT_CONFIGURED',{requestId});
  try{
    const r=await jsonRequest(env,'POST','/station/go-job-status',{requestId});
    if(!r.ok||r.data?.requestId!==requestId||!JOB.test(r.data.jobId||''))
      return failure('GO_JOB_STATUS_UNKNOWN',{requestId,jobStatus:'UNKNOWN',readOnly:true,verified:false,httpStatus:r.httpStatus});
    if(r.data.executor!==undefined&&r.data.executor!==QUEUE_EXECUTOR)
      return failure('GO_QUEUE_STATUS_UNVERIFIED',{requestId,jobId:r.data.jobId,jobStatus:'UNKNOWN',readOnly:true,verified:false});
    if(r.data.executor===QUEUE_EXECUTOR){
      const x=r.data,meta=queueMetadata(x,requestId);
      const uncertain=()=>failure('GO_QUEUE_STATUS_UNVERIFIED',{requestId,jobId:x.jobId,jobStatus:'UNKNOWN',readOnly:true,verified:false});
      if(!meta)return uncertain();
      if(['ACCEPTED','IN_PROGRESS','UNKNOWN'].includes(x.status))return {
        ok:true,status:'GO_JOB_STATUS_READ',requestId,jobId:x.jobId,...meta,
        receiptId:RECEIPT.test(x.receiptId||'')?x.receiptId:null,jobStatus:x.status,
        verified:false,executed:false,readOnly:true,reason:safeJobReason(x.reason)};
      // A raw Receipt can exist after the SLA expired. Only the coordinator's
      // timely settlement plus independent correlated readback proves completion.
      if(!['COMPLETED','FAILED'].includes(x.status)||!RECEIPT.test(x.receiptId||'')||
        !Number.isSafeInteger(x.settledAt)||x.settledAt<meta.admittedAt||x.settledAt>meta.deadlineAt||
        !Number.isSafeInteger(x.receiptObservedAt)||x.receiptObservedAt<meta.admittedAt||x.receiptObservedAt>x.settledAt)return uncertain();
      const back=await factoryDirectReadback(env,{receiptId:x.receiptId});
      if(!back.ok||back.jobId!==x.jobId||back.sourceSha!==meta.sourceSha||
        Date.parse(back.observedAt||'')!==x.receiptObservedAt||
        back.jobStatus!==x.status||(x.status==='COMPLETED'&&back.domain!=='VISUAL'))return uncertain();
      return {...back,...meta,settledAt:x.settledAt,receiptObservedAt:x.receiptObservedAt,requestId,status:'GO_JOB_STATUS_READ'};
    }
    const rid=r.data.receiptId;
    if(!RECEIPT.test(rid||''))return failure('GO_JOB_STATUS_UNCERTAIN',{requestId,jobId:r.data.jobId,jobStatus:'UNKNOWN',readOnly:true,verified:false});
    const pending={ok:true,status:'GO_JOB_STATUS_READ',requestId,jobId:r.data.jobId,receiptId:rid,
      jobStatus:'UNKNOWN',verified:false,executed:false,readOnly:true,reason:safeJobReason(r.data.reason)};
    if(r.data.status==='IN_PROGRESS')return {...pending,jobStatus:'IN_PROGRESS'};
    const receipt=await factoryDirectReadback(env,{receiptId:rid});
    if(!receipt.ok||receipt.jobId!==r.data.jobId)
      return {...pending,status:'GO_JOB_READBACK_UNVERIFIED',ok:false};
    return {...receipt,requestId,status:'GO_JOB_STATUS_READ'};
  }catch{return failure('GO_JOB_STATUS_UNAVAILABLE',{requestId,jobStatus:'UNKNOWN',readOnly:true,verified:false});}
}
// Read one existing stamped GO receipt. It cannot trigger a job or deliver bytes.
export async function factoryJobStampStatus(env,{receiptId}={}){
  if(!RECEIPT.test(receiptId||''))return failure('RECEIPT_ID_INVALID');
  if(!configured(env))return failure('DIRECT_RAIL_NOT_CONFIGURED');
  try{
    const r=await jsonRequest(env,'POST','/station/go-job-stamp-status',{receiptId});
    const x=r.data||{};
    if(!r.ok||x.status!=='PASS'||x.stamp?.receiptId!==receiptId||
       x.stamp.status!=='PASS'||x.stamp.dispatchState!=='AVAILABLE_NOT_DELIVERED'||
       x.stamp.appAcceptanceVerified!==false||
       x.stampRef!=='r2://factory/records/factory/job-stamp/v1/'+receiptId||
       !Array.isArray(x.stamp.files)||x.stamp.files.length<1)
      return {ok:false,status:'JOB_STAMP_NOT_VERIFIED',receiptId,readOnly:true,httpStatus:r.httpStatus};
    return {ok:true,status:'JOB_STAMP_READ',receiptId,stamp:x.stamp,
      stampRef:x.stampRef,deliveryAuthorized:true,readOnly:true,executed:false};
  }catch{return failure('JOB_STAMP_UNAVAILABLE',{receiptId,readOnly:true});}
}
export async function factoryDirectArtifact(env,{receiptId,artifactRef}={}){
  if(typeof artifactRef!=='string'||artifactRef.length>900||
    !(artifactRef.startsWith('r2://factory/edge-results/')||/^r2:\/\/factory\/records\/logic\/workshop\/v1\/content\/[a-f0-9]{64}$/.test(artifactRef)||
      /^r2:\/\/factory\/records\/proof\/reports\/GOJOB-[a-f0-9]{32}$/.test(artifactRef)))
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
    const manifest=receipt.artifacts?.find(a=>a.ref===artifactRef);
    if(response.headers.get('x-factory-artifact-sha256')!==hash||
      response.headers.get('x-factory-receipt-id')!==receiptId||
      response.headers.get('x-factory-source-sha')!==receipt.sourceSha||
      (manifest&&(manifest.sha256!==hash||manifest.bytes!==bytes.byteLength)))
      return failure('ARTIFACT_INTEGRITY_MISMATCH');
    const mime=response.headers.get('content-type');
    if(!['image/png','text/javascript; charset=utf-8','text/html; charset=utf-8','application/octet-stream','application/json'].includes(mime))
      return failure('ARTIFACT_MIME_UNEXPECTED');
    if(artifactRef.startsWith('r2://factory/records/logic/workshop/')) {
      let delivery;try{delivery=JSON.parse(new TextDecoder().decode(bytes));}catch{return failure('WORKSHOP_PACKAGE_INVALID');}
      const expected=artifactRef.split('/').at(-1);
      if(mime!=='application/json'||delivery.artifactRef!==artifactRef||delivery.sha256!==expected||delivery.receipt?.receiptId!==receiptId||delivery.readback?.receiptId!==receiptId
        ||delivery.readback?.workId!==receipt.jobId||delivery.readback?.domainVerified!==true||delivery.package?.workId!==receipt.jobId
        ||delivery.package?.checkpointId!=='CP-'+receipt.jobId||await digest(new TextEncoder().encode(canonicalContent(delivery.package)))!==expected) return failure('WORKSHOP_PACKAGE_INVALID');
    }
    if(artifactRef.startsWith('r2://factory/records/proof/reports/')) {
      if(mime!=='application/json')return failure('PROOF_REPORT_MIME_INVALID');
      let delivered;
      try{delivered=JSON.parse(new TextDecoder().decode(bytes));}
      catch{return failure('PROOF_REPORT_INVALID');}
      if(delivered?.schema!=='FACTORY_PROOF_REPORT_V1'||
         delivered.workId!==receipt.jobId||
         delivered.checkpointId!=='CP-'+receipt.jobId||
         delivered.factorySourceSha!==receipt.sourceSha||
         delivered.appAcceptanceVerified!==false||
         (delivered.externalTestExecuted===true&&
           (delivered.mode!=='TOOLKIT'||delivered.toolkitAction!=='RUN_CASE'||
            delivered.toolkitResult?.executed!==true))||
         !['PASS','UNVERIFIED','REFERENCE_ONLY'].includes(delivered.verdict)||
         canonicalContent(delivered)!==canonicalContent(receipt.proofResult))
        return failure('PROOF_REPORT_INTEGRITY_MISMATCH');
    }
    const u=new Uint8Array(bytes);let bin='';
    for(let i=0;i<u.length;i+=16384)bin+=String.fromCharCode(...u.slice(i,i+16384));
    return {ok:true,status:'ARTIFACT_BYTES_DELIVERED',executed:false,readOnly:true,
      receiptId,jobId:receipt.jobId,artifactRef,mime,bytes:u.length,sha256:hash,base64:btoa(bin)};
  }catch{return failure('DIRECT_ARTIFACT_UNAVAILABLE');}
}
export async function factoryDirectSubmit(env,{domain,spec,requestId}={},approved=false){
  if(approved!==true)return failure('OWNER_APPROVAL_REQUIRED');
  if(!['CODE','VISUAL','LOGIC','PROOF'].includes(domain)||!object(spec))
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
    const imageSplitRequested=domain==='VISUAL'&&object(spec.imageSplit);
    if(imageSplitRequested&&h.capabilities?.VISUAL!=='STATIC_CARD_AND_ALPHA_CUTOUT_SOURCE_INSTALLED')
      return failure('FACTORY_IMAGE_SPLIT_SOURCE_NOT_INSTALLED',{requestId:id});
    const workshop=domain==='LOGIC'&&object(spec.workshop);
    if(workshop&&!h.workshopReady)return failure('FACTORY_WORKSHOP_NOT_READY',{requestId:id});
    const input={requestId:id,domain,spec,expectedSourceSha:h.sourceSha};
    if(new TextEncoder().encode(JSON.stringify(input)).length>65536)
      return failure('GO_JOB_TOO_LARGE',{requestId:id});
    const r=await jsonRequest(env,'POST','/station/go-job',input),x=r.data||{};
    const queued=queueMetadata(x,id);
    if(r.ok&&x.status==='ACCEPTED'&&queued&&domain==='VISUAL'&&queued.sourceSha===h.sourceSha&&x.executed===false&&!x.receiptId)
      return {ok:true,status:'VISUAL_JOB_ACCEPTED',requestId:id,jobId:x.jobId,...queued,
        receiptId:null,jobStatus:'ACCEPTED',verified:false,executed:false};
    // A duplicate queued admission can return a settled result. Never feed it
    // into the legacy synchronous completion path: reconcile by read-only status.
    if(x.executor!==undefined)return failure('GO_QUEUE_READBACK_REQUIRED',{
      requestId:id,jobId:JOB.test(x.jobId||'')?x.jobId:null,
      receiptId:RECEIPT.test(x.receiptId||'')?x.receiptId:null,
      jobStatus:'UNKNOWN',verified:false,httpStatus:r.httpStatus});
    if(!r.ok||x.status!=='COMPLETED'||x.requestId!==id||
      !JOB.test(x.jobId||'')||!RECEIPT.test(x.receiptId||''))
      return failure('GO_JOB_EFFECT_UNVERIFIED',{requestId:id,
        jobId:JOB.test(x.jobId||'')?x.jobId:null,
        receiptId:RECEIPT.test(x.receiptId||'')?x.receiptId:null,
        httpStatus:r.httpStatus,reason:x.reason||x.status,
        ...(x.readback?.machineResult?.workshopResult?{workshopResult:x.readback.machineResult.workshopResult}:{})});
    const back=await factoryDirectReadback(env,{receiptId:x.receiptId});
    if(!back.ok||!back.verified||back.jobId!==x.jobId||
      back.sourceSha!==h.sourceSha||back.domain!==domain)
      return failure('GO_RECEIPT_UNVERIFIED',{requestId:id,jobId:x.jobId,receiptId:x.receiptId});
    if(domain==='PROOF') {
      const report=back.proofResult,ref=back.reportRef;
      if(report?.schema!=='FACTORY_PROOF_REPORT_V1'||
         report.workId!==x.jobId||report.checkpointId!=='CP-'+x.jobId||
         report.factorySourceSha!==h.sourceSha||report.mode!==spec.mode||
         report.appAcceptanceVerified!==false||
         report.externalTestExecuted!==(spec.mode==='TOOLKIT'&&
           spec.action==='RUN_CASE'&&report.toolkitResult?.executed===true)||
         !['PASS','UNVERIFIED','REFERENCE_ONLY'].includes(report.verdict)||
         ref!=='r2://factory/records/proof/reports/'+x.jobId||
         !back.artifactRefs.includes(ref))
        return failure('GO_PROOF_REPORT_UNVERIFIED',{requestId:id,jobId:x.jobId,receiptId:x.receiptId});
      const artifact=await factoryDirectArtifact(env,{receiptId:x.receiptId,artifactRef:ref});
      if(!artifact.ok)return {...artifact,requestId:id,jobId:x.jobId,receiptId:x.receiptId};
      return {ok:true,status:'PROOF_REPORT_READY',requestId:id,jobId:x.jobId,
        receiptId:x.receiptId,sourceSha:h.sourceSha,verdict:report.verdict,
        verificationScope:report.verificationScope,appAcceptanceVerified:false,
        reportRef:ref,report,artifact,executed:true,deliveredBytes:true};
    }
    if(workshop) {
      if(back.workshopResult?.operation!==spec.workshop.operation||back.workshopResult?.operationId!==spec.workshop.operationId||back.workshopResult?.subjectId!==spec.workshop.subjectId||back.workshopResult?.status!=='PASS') return failure('GO_WORKSHOP_RESULT_MISMATCH',{requestId:id,jobId:x.jobId,receiptId:x.receiptId});
      const result={ok:true,status:'LOGIC_WORKSHOP_COMPLETED',requestId:id,jobId:x.jobId,receiptId:x.receiptId,sourceSha:h.sourceSha,workshopResult:back.workshopResult,executed:true,deliveredBytes:false};
      if(spec.workshop.operation==='EXPORT_PACKAGE') {
        const artifact=await factoryDirectArtifact(env,{receiptId:x.receiptId,artifactRef:back.workshopResult.output?.ref});
        if(!artifact.ok)return {...artifact,requestId:id,jobId:x.jobId,receiptId:x.receiptId};
        return {...result,artifact,deliveredBytes:true};
      }
      return result;
    }
    if(domain==='LOGIC')return {ok:true,status:'LOGIC_TRAINING_PLACED',
      requestId:id,jobId:x.jobId,receiptId:x.receiptId,
      sourceSha:h.sourceSha,evidenceRefs:back.evidenceRefs,executed:true,
      deliveredBytes:false,capability:'DWARF_TRAINING_ONLY'};
    const imageSplit=domain==='VISUAL'&&object(spec.imageSplit);
    const suffix=domain==='CODE'?'/main.js':imageSplit?'/split-manifest.json':'/render.png';
    const ref=back.artifactRefs.find(v=>typeof v==='string'&&
      v.startsWith('r2://factory/edge-results/')&&v.endsWith(suffix));
    if(!ref)return failure('GO_ARTIFACT_REF_MISSING',{requestId:id,jobId:x.jobId,receiptId:x.receiptId});
    const artifact=await factoryDirectArtifact(env,{receiptId:x.receiptId,artifactRef:ref});
    if(!artifact.ok)return {...artifact,requestId:id,jobId:x.jobId,receiptId:x.receiptId};
    if(imageSplit){
      let manifest;
      try{manifest=JSON.parse(atob(artifact.base64));}
      catch{return failure('GO_IMAGE_MANIFEST_INVALID',{requestId:id,receiptId:x.receiptId});}
      if(manifest?.schema!=='FACTORY_VISUAL_SPLIT_MANIFEST_V1'||
         manifest.count!==spec.imageSplit.count||manifest.canvas!==spec.imageSplit.canvas||
         !Array.isArray(manifest.files)||manifest.files.length!==manifest.count||
         !/^[a-f0-9]{64}$/.test(manifest.zipSha256||'')||
         typeof manifest.zipRef!=='string'||!back.artifactRefs.includes(manifest.zipRef)||
         manifest.sourceSha256!==spec.imageSplit.sourceRef.split('/').at(-1).slice(0,64)||
         manifest.files.some((f,i)=>f.name!==spec.imageSplit.names[i]||
            !back.artifactRefs.includes(f.ref)||!/^[a-f0-9]{64}$/.test(f.sha256||'')))
        return failure('GO_IMAGE_MANIFEST_UNVERIFIED',{requestId:id,receiptId:x.receiptId});
      return {ok:true,status:'GO_FACTORY_IMAGE_PACK_READY',domain:'VISUAL',
        requestId:id,jobId:x.jobId,receiptId:x.receiptId,sourceSha:h.sourceSha,
        inputSha256:manifest.sourceSha256,manifestRef:ref,
        files:manifest.files,zipRef:manifest.zipRef,zipSha256:manifest.zipSha256,
        zipBytes:manifest.archiveBytes,evidenceRefs:back.evidenceRefs,
        executed:true,deliveredBytes:false};
    }
    return {ok:true,status:'GO_FACTORY_DELIVERABLE_READY',requestId:id,
      jobId:x.jobId,receiptId:x.receiptId,domain,sourceSha:h.sourceSha,
      artifactRef:ref,evidenceRefs:back.evidenceRefs,
      artifact:{mime:artifact.mime,bytes:artifact.bytes,sha256:artifact.sha256,
        base64:artifact.base64},executed:true,deliveredBytes:true};
  }catch{return failure('GO_JOB_TRANSPORT_UNCERTAIN',{requestId:id});}
}

// Owner-approved input transport only; content hashing makes retries idempotent.
export async function factoryWorkshopContent(env,{content}={},approved=false) {
  if(approved!==true)return failure('OWNER_APPROVAL_REQUIRED');
  try {
    const h=await factoryDirectStatus(env);
    if(!h.commandReady||!h.workshopReady)return failure('FACTORY_WORKSHOP_NOT_READY');
    const body={content,expectedSourceSha:h.sourceSha};
    if(new TextEncoder().encode(JSON.stringify(body)).length>65536)return failure('GO_WORKSHOP_CONTENT_TOO_LARGE');
    const expected=await digest(new TextEncoder().encode(canonicalContent(content)));
    const r=await jsonRequest(env,'POST','/station/go-workshop-content',body),x=r.data;
    if(!r.ok||x?.status!=='WORKSHOP_CONTENT_STORED'||!/^r2:\/\/factory\/records\/logic\/workshop\/v1\/content\/[a-f0-9]{64}$/.test(x.ref||'')||x.ref.split('/').at(-1)!==x.sha256||x.sha256!==expected)return failure('GO_WORKSHOP_CONTENT_UNVERIFIED',{reason:x?.reason,httpStatus:r.httpStatus});
    return {ok:true,status:x.status,ref:x.ref,sha256:x.sha256,executed:false};
  } catch {return failure('GO_WORKSHOP_CONTENT_UNCERTAIN');}
}


/** Owner-approved GO -> Factory RGBA sprite-sheet upload.
 * This is a data transport ONLY. It never invokes VISUAL machinery or
 * declares an asset produced before a separate verified Factory job.
 */
export async function factoryVisualUploadStatus(env,{requestId}={}){
 if(!UUID.test(requestId||''))return failure('GO_IMAGE_REQUEST_ID_INVALID');
 if(!configured(env))return failure('DIRECT_RAIL_NOT_CONFIGURED',{requestId});
 try{
  const r=await jsonRequest(env,'POST','/station/go-asset-status',{requestId});
  const x=r.data||{};
  if(!r.ok||x.status!=='STORED_NOT_PROCESSED'||x.requestId!==requestId.toLowerCase()||
     !/^[a-f0-9]{64}$/.test(x.sha256||'')||
     x.ref!=='r2://factory/edge-source/go/'+x.sha256+'.png#sha256='+x.sha256||
     x.executed!==false||!Number.isSafeInteger(x.bytes)||x.bytes<40||x.bytes>4*1024*1024)
    return failure('GO_IMAGE_READBACK_UNVERIFIED',{requestId,httpStatus:r.httpStatus});
  return {ok:true,status:'STORED_NOT_PROCESSED',requestId:x.requestId,ref:x.ref,
    sha256:x.sha256,bytes:x.bytes,width:x.width,height:x.height,executed:false};
 }catch{return failure('GO_IMAGE_STATUS_TRANSPORT_UNAVAILABLE',{requestId});}
}
export async function factoryVisualUpload(env,{requestId,pngBase64,sha256}={},approved=false){
 if(approved!==true)return failure('OWNER_APPROVAL_REQUIRED');
 const id=requestId===undefined?crypto.randomUUID():requestId;
 if(!UUID.test(id||'')||!/^[a-f0-9]{64}$/.test(sha256||'')||
    typeof pngBase64!=='string'||pngBase64.length<80||pngBase64.length>5_592_408||
    pngBase64.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(pngBase64))
   return failure('GO_IMAGE_INPUT_INVALID');
 if(!configured(env))return failure('DIRECT_RAIL_NOT_CONFIGURED',{requestId:id});
 try{
  const binary=atob(pngBase64);
  if(binary.length>4*1024*1024)return failure('GO_IMAGE_TOO_LARGE',{requestId:id});
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  if(await digest(bytes)!==sha256)return failure('GO_IMAGE_SHA_MISMATCH',{requestId:id});
  const h=await factoryDirectStatus(env);
  if(!h.ok||!h.commandReady)return failure('GO_FACTORY_AUTH_NOT_READY',{requestId:id});
  const body={schema:'FACTORY_GO_PNG_INPUT_V1',requestId:id,sha256,pngBase64};
  const r=await jsonRequest(env,'POST','/station/go-asset-upload',body),x=r.data||{};
  if(!r.ok||x.status!=='STORED_NOT_PROCESSED'||x.requestId!==id.toLowerCase()||
     x.sha256!==sha256||x.executed!==false)
    return failure('GO_IMAGE_UPLOAD_UNVERIFIED',{requestId:id,httpStatus:r.httpStatus,reason:x.reason||x.status});
  const back=await factoryVisualUploadStatus(env,{requestId:id});
  if(!back.ok||back.sha256!==sha256||back.bytes!==bytes.length)
    return failure('GO_IMAGE_READBACK_UNVERIFIED',{requestId:id,reason:back.status});
  return back;
 }catch{return failure('GO_IMAGE_UPLOAD_TRANSPORT_UNCERTAIN',{requestId:id});}
}


/** Read a single owner receipt-bound Factory ZIP chunk.
 * The caller provides ZIP SHA-256 from previously verified manifest.
 */
export async function factoryVisualZipChunk(env,{receiptId,artifactRef,offset,expectedSha256,length=262144}={}){
 if(!RECEIPT.test(receiptId||'')||typeof artifactRef!=='string'||
    !/^r2:\/\/factory\/edge-results\/[A-Za-z0-9%_-]+\/[A-Za-z0-9%_-]+\/[A-Za-z0-9%_-]+\/visual-cutouts\.zip$/.test(artifactRef)||
    !/^[a-f0-9]{64}$/.test(expectedSha256||'')||
    !Number.isSafeInteger(offset)||offset<0||
    !Number.isSafeInteger(length)||length<1||length>262144)
   return failure('GO_ZIP_CHUNK_INPUT_INVALID');
 const receipt=await factoryDirectReadback(env,{receiptId});
 if(!receipt.ok||!receipt.verified||receipt.domain!=='VISUAL'||!receipt.artifactRefs.includes(artifactRef))
   return failure('ZIP_NOT_IN_GO_RECEIPT');
 try{
  const r=await jsonRequest(env,'POST','/station/go-artifact-chunk',
    {receiptId,artifactRef,offset,length});
  const x=r.data||{};
  if(!r.ok||x.status!=='ZIP_CHUNK_READ'||x.receiptId!==receiptId||
     x.artifactRef!==artifactRef||x.offset!==offset||
     x.fileSha256!==expectedSha256||x.readOnly!==true||x.executed!==false||
     !Number.isSafeInteger(x.total)||x.total<=0||x.total>8*1024*1024||
     !Number.isSafeInteger(x.length)||x.length<=0||x.length>length||
     x.nextOffset!==offset+x.length||x.complete!==(x.nextOffset===x.total)||
     !/^[a-f0-9]{64}$/.test(x.chunkSha256||'')||
     typeof x.base64!=='string'||x.base64.length>350000)
    return failure('GO_ZIP_CHUNK_READBACK_INVALID',{receiptId,httpStatus:r.httpStatus});
  const binary=atob(x.base64),bytes=new Uint8Array(binary.length);
  for(let i=0;i<bytes.length;i++)bytes[i]=binary.charCodeAt(i);
  if(bytes.length!==x.length||await digest(bytes)!==x.chunkSha256)
    return failure('GO_ZIP_CHUNK_DIGEST_MISMATCH',{receiptId});
  return {ok:true,status:'ZIP_CHUNK_VERIFIED',receiptId,artifactRef,
    offset:x.offset,length:x.length,total:x.total,nextOffset:x.nextOffset,
    complete:x.complete,fileSha256:x.fileSha256,chunkSha256:x.chunkSha256,
    base64:x.base64,executed:false,readOnly:true};
 }catch{return failure('GO_ZIP_CHUNK_UNAVAILABLE',{receiptId});}
}
