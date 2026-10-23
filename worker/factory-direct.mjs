// GO Brain -> Factory District: owner-only, private Service Binding discovery.
// No PANTHEON intermediary, bearer forwarding, task creation or remote execution.
// A configured-looking key is not proof of matching Factory-side credentials.
export async function factoryDirectStatus(env = {}) {
  const key = env.GO_FACTORY_RAIL_SECRET;
  const keyState = typeof key === 'string' && /^[a-f0-9]{64}$/i.test(key)
    ? 'OWNER_KEY_FORMAT_PRESENT_NOT_VERIFIED'
    : 'PENDING_OWNER_REPLACEMENT';
  const base = {
    route: 'GO_BRAIN_TO_FACTORY_DIRECT',
    transport: 'CLOUDFLARE_PRIVATE_SERVICE_BINDING',
    readOnly: true,
    commandReady: false,
    keyState,
  };
  if (!env.FACTORY_DIRECT || typeof env.FACTORY_DIRECT.fetch !== 'function')
    return {...base, ok: false, status: 'SERVICE_BINDING_NOT_CONFIGURED'};
  try {
    const response = await env.FACTORY_DIRECT.fetch(
      new Request('https://factory-district.internal/health', {method: 'GET'})
    );
    if (!response.ok)
      return {...base, ok: false, status: 'FACTORY_HTTP_ERROR', upstreamStatus: response.status};
    const health = await response.json();
    if (!health || health.service !== 'factory-district' || health.stationId !== 'FACTORY-STATION')
      return {...base, ok: false, status: 'FACTORY_IDENTITY_MISMATCH'};
    const machinery = Object.fromEntries(['CODE', 'VISUAL', 'LOGIC'].map(domain => [
      domain, health.machinery?.[domain]?.status === 'READY' ? 'READY' : 'UNKNOWN'
    ]));
    return {
      ...base, ok: true, status: 'CONNECTED',
      station: 'FACTORY-STATION',
      runtime: health.status === 'READY' ? 'READY' : 'UNKNOWN',
      transportStatus: health.transport?.status === 'READY' ? 'READY' : 'UNKNOWN',
      machinery,
      sourceSha: /^[a-f0-9]{40}$/i.test(health.sourceSha || '') ? health.sourceSha : null,
      note: 'READY only means registered machinery, not a successful job or permission to dispatch.',
    };
  } catch {
    return {...base, ok: false, status: 'DIRECT_FACTORY_UNAVAILABLE'};
  }
}


// The direct command rail is inert with placeholder keys. It can never
// synthesize a Work Pass or reinterpret a PANTHEON task as Factory work.
const RAIL_PROTOCOL = 'METROPOLIS_FACTORY_STATION_V2';
const directUrl = 'https://factory-district.internal';
const permitted = new Set(['workId','checkpointId','workPassRef','workPass',
  'ownerDomain','intent','scope','inputRefs','expectedSourceSha']);
function fail(reason) { return {ok:false,status:reason,route:'GO_BRAIN_TO_FACTORY_DIRECT',executed:false}; }
function configured(env) {
  return typeof env.GO_FACTORY_RAIL_SECRET === 'string' &&
    /^[a-f0-9]{64}$/i.test(env.GO_FACTORY_RAIL_SECRET) &&
    env.FACTORY_DIRECT && typeof env.FACTORY_DIRECT.fetch === 'function';
}
export function buildGoHandoff(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !permitted.has(key))) return null;
  if (typeof args.workId !== 'string' || !args.workId ||
      typeof args.checkpointId !== 'string' || !args.checkpointId ||
      typeof args.workPassRef !== 'string' || !args.workPassRef ||
      !/^[a-f0-9]{40}$/.test(args.expectedSourceSha || '') ||
      !args.workPass || args.workPass.actor !== 'GO' ||
      args.workPass.workId !== args.workId ||
      args.workPass.checkpointId !== args.checkpointId ||
      args.workPass.status !== 'ACTIVE' ||
      args.workPass.kind !== 'WORK_PASS' ||
      args.workPass.version !== 'WORK_PASS_V1' ||
      !args.workPass.passId || args.workPassRef !== 'work-pass://' + args.workPass.passId ||
      !Array.isArray(args.workPass.permissions?.actions) ||
      !args.workPass.permissions.actions.includes('handoff') ||
      !args.workPass.permissions?.handoff?.some(x => x.stationId === 'FACTORY_STATION')) return null;
  const domain = args.ownerDomain;
  const requiredScope = domain === 'CODE' ? ['EXECUTE:CODE','DEPLOY:CODE']
    : domain === 'VISUAL' ? ['EXECUTE:VISUAL'] : ['EXECUTE:LOGIC'];
  const intent = domain === 'CODE' ? 'EXECUTE_CODE'
    : domain === 'VISUAL' ? 'EXECUTE_VISUAL'
    : domain === 'LOGIC' ? 'PLACE_DWARF_LOGIC_TRAINEE' : null;
  const validScope = Array.isArray(args.scope) &&
    args.scope.length === requiredScope.length &&
    requiredScope.every(s => args.scope.includes(s));
  const validRefs = Array.isArray(args.inputRefs) &&
    (domain === 'LOGIC' ? args.inputRefs.length === 0
      : args.inputRefs.length === 1 &&
        /^r2:\/\/factory\/edge-inputs\/[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.json#sha256=[a-f0-9]{64}$/.test(args.inputRefs[0]));
  if (!intent || args.intent !== intent || !validScope || !validRefs) return null;
  return {
    workId:args.workId,checkpointId:args.checkpointId,
    workPassRef:args.workPassRef,workPass:args.workPass,
    ownerDomain:domain,intent,scope:[...args.scope],inputRefs:[...args.inputRefs],
    expectedSourceSha:args.expectedSourceSha,
    requestedAt:new Date().toISOString(),
    source:{system:'go-together',stationId:'GO-BRAIN'},
    target:{system:'factory-district',stationId:'FACTORY-STATION',component:'FACTORY_HALL'},
  };
}
async function sign(secret, timestamp, body) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,
    new TextEncoder().encode(timestamp + '.' + body)));
  return [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function directRequest(env, path, method='GET', payload=null) {
  const body = payload === null ? '' : JSON.stringify(payload);
  const timestamp = String(Date.now());
  const headers = {
    'x-factory-client':'GO',
    'x-metropolis-factory-protocol':RAIL_PROTOCOL,
    'x-metropolis-factory-timestamp':timestamp,
    'x-metropolis-factory-signature':await sign(env.GO_FACTORY_RAIL_SECRET,timestamp,body),
    ...(payload === null ? {} : {'content-type':'application/json'}),
  };
  const response = await env.FACTORY_DIRECT.fetch(new Request(directUrl+path,
    {method,headers,...(payload===null?{}:{body})}));
  let result;
  try{result=await response.json();}catch{return {ok:false,status:'INVALID_FACTORY_RESPONSE',httpStatus:response.status};}
  if(!result || typeof result !== 'object' || Array.isArray(result))
    return {ok:false,status:'INVALID_FACTORY_RESPONSE',httpStatus:response.status};
  return {ok:response.ok,httpStatus:response.status,result};
}
async function preflight(env,handoff) {
  const r=await directRequest(env,'/station/preflight','POST',handoff);
  if(!r.ok || r.result?.status!=='READY' || r.result.allowed!==true ||
     r.result.workId!==handoff.workId || r.result.checkpointId!==handoff.checkpointId ||
     r.result.workPassRef!==handoff.workPassRef ||
     r.result.sourceSha!==handoff.expectedSourceSha ||
     r.result.validationScope!=='FACTORY_BOUNDARY_PREFLIGHT')
    return fail('DIRECT_PREFLIGHT_NOT_VERIFIED');
  return {ok:true,status:'PREFLIGHT_READY',verificationScope:r.result.validationScope,
    workId:handoff.workId,checkpointId:handoff.checkpointId,
    sourceSha:r.result.sourceSha,executed:false};
}
function sameReceipt(r,handoff,receiptId) {
  return r?.receiptId===receiptId && r.workId===handoff.workId &&
    r.checkpointId===handoff.checkpointId &&
    r.workPassRef===handoff.workPassRef &&
    r.actingActor==='GO' && r.authorizationSource==='WORK_PASS' && r.originSystem==='go-together' &&
    r.sourceSha===handoff.expectedSourceSha && r.stationId==='FACTORY-STATION';
}
export async function factoryDirectPreflight(env,args={}) {
  const handoff=buildGoHandoff(args);
  if(!handoff) return fail('INVALID_SCOPED_GO_WORK');
  if(!configured(env)) return fail('DIRECT_RAIL_NOT_CONFIGURED');
  try{return await preflight(env,handoff);}
  catch{return fail('DIRECT_FACTORY_UNAVAILABLE');}
}
export async function factoryDirectExecute(env,args={},approved=false) {
  if(approved!==true) return fail('OWNER_APPROVAL_REQUIRED');
  const handoff=buildGoHandoff(args);
  if(!handoff) return fail('INVALID_SCOPED_GO_WORK');
  if(!configured(env)) return fail('DIRECT_RAIL_NOT_CONFIGURED');
  try{
    const ready=await preflight(env,handoff);
    if(!ready.ok) return ready;
    const response=await directRequest(env,'/station/receive','POST',handoff);
    // A timeout/unknown response must not be retried automatically.
    if(!response.ok || !response.result?.receipt?.receiptId)
      return {...fail('DIRECT_EFFECT_NOT_VERIFIED'),httpStatus:response.httpStatus};
    const receiptId=response.result.receipt.receiptId;
    if(!/^receipt-[a-zA-Z0-9-]{8,80}$/.test(receiptId))
      return fail('FACTORY_RECEIPT_INVALID');
    const read=await directRequest(env,'/station/readback/'+encodeURIComponent(receiptId));
    if(!read.ok || !sameReceipt(read.result,handoff,receiptId) ||
      read.result.domainVerified!==true || read.result.domainCompleted!==true)
      return {...fail('DIRECT_READBACK_NOT_VERIFIED'),receiptId};
    const refs=Array.isArray(read.result.result?.artifactRefs)
      ? read.result.result.artifactRefs.filter(x=>typeof x==='string'): [];
    const domain=handoff.ownerDomain;
    const isTraining=domain==='LOGIC';
    if(!isTraining && refs.length===0)
      return {...fail('ARTIFACT_NOT_RETURNED'),receiptId};
    return {ok:true,status:isTraining?'LOGIC_TRAINING_PLACED':'DOMAIN_ARTIFACT_RECORDED',
      readOnly:false,executed:true,verified:true,domain,
      taskWorkId:handoff.workId,checkpointId:handoff.checkpointId,
      receiptId,sourceSha:handoff.expectedSourceSha,
      artifactRefs:refs,
      evidenceRefs:read.result.result?.evidenceRefs || [],
      artifactDownloaded:false,
      warning:isTraining?'LOGIC supports trainee placement, not general calculation':'Artifact reference verified by Factory; binary download is a separate acceptance step'};
  }catch{return fail('DIRECT_FACTORY_UNAVAILABLE_OR_EFFECT_UNCERTAIN');}
}
export async function factoryDirectReadback(env,{receiptId,workId,checkpointId,workPassRef,expectedSourceSha}={}) {
  if(typeof receiptId!=='string'||!/^receipt-[a-zA-Z0-9-]{8,80}$/.test(receiptId)||
    !workId||!checkpointId||!workPassRef||!/^[a-f0-9]{40}$/.test(expectedSourceSha||''))
    return fail('INVALID_READBACK_CONTEXT');
  if(!configured(env)) return fail('DIRECT_RAIL_NOT_CONFIGURED');
  try{
    const r=await directRequest(env,'/station/readback/'+encodeURIComponent(receiptId));
    if(!r.ok || !sameReceipt(r.result,{workId,checkpointId,workPassRef,expectedSourceSha},receiptId))
      return fail('DIRECT_READBACK_NOT_VERIFIED');
    return {ok:true,status:'DIRECT_RECEIPT_READ',verified:r.result.domainVerified===true,
      executed:false,readOnly:true,receiptId,workId,checkpointId,
      sourceSha:r.result.sourceSha,domainVerified:r.result.domainVerified===true,
      artifactRefs:r.result.result?.artifactRefs || [],
      evidenceRefs:r.result.result?.evidenceRefs || []};
  }catch{return fail('DIRECT_FACTORY_UNAVAILABLE');}
}

export async function factoryDirectArtifact(env,{
  receiptId,artifactRef,workId,checkpointId,workPassRef,expectedSourceSha
}={}) {
  const context={receiptId,workId,checkpointId,workPassRef,expectedSourceSha};
  if(typeof artifactRef!=='string'||artifactRef.length>900||
    !artifactRef.startsWith('r2://factory/edge-results/'))
    return fail('INVALID_ARTIFACT_REF');
  const scoped=await factoryDirectReadback(env,context);
  if(!scoped.ok || scoped.domainVerified!==true ||
    !Array.isArray(scoped.artifactRefs) || !scoped.artifactRefs.includes(artifactRef))
    return fail('ARTIFACT_NOT_IN_VERIFIED_RECEIPT');
  if(!configured(env))return fail('DIRECT_RAIL_NOT_CONFIGURED');
  try{
    const raw=JSON.stringify({receiptId,artifactRef}),timestamp=String(Date.now());
    const response=await env.FACTORY_DIRECT.fetch(new Request(directUrl+'/station/go-artifact',{
      method:'POST',headers:{
        'content-type':'application/json',
        'x-factory-client':'GO',
        'x-metropolis-factory-protocol':RAIL_PROTOCOL,
        'x-metropolis-factory-timestamp':timestamp,
        'x-metropolis-factory-signature':await sign(env.GO_FACTORY_RAIL_SECRET,timestamp,raw),
      },body:raw}));
    if(!response.ok)return {...fail('DIRECT_ARTIFACT_UNAVAILABLE'),httpStatus:response.status};
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength>524288)return fail('ARTIFACT_EXCEEDS_MCP_LIMIT');
    const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
      .map(b=>b.toString(16).padStart(2,'0')).join('');
    if(response.headers.get('x-factory-artifact-sha256')!==actual ||
      response.headers.get('x-factory-receipt-id')!==receiptId ||
      response.headers.get('x-factory-source-sha')!==expectedSourceSha)
      return fail('ARTIFACT_INTEGRITY_MISMATCH');
    const mime=response.headers.get('content-type');
    const allowedMime=['image/png','text/javascript; charset=utf-8',
      'text/html; charset=utf-8','application/octet-stream'];
    if(!allowedMime.includes(mime))return fail('ARTIFACT_MIME_UNEXPECTED');
    let binary='';
    const view=new Uint8Array(bytes);
    for(let i=0;i<view.length;i+=16384)
      binary+=String.fromCharCode(...view.slice(i,i+16384));
    return {ok:true,status:'ARTIFACT_BYTES_DELIVERED',readOnly:true,executed:false,
      receiptId,workId,checkpointId,artifactRef,mime,
      bytes:view.byteLength,sha256:actual,base64:btoa(binary)};
  } catch {return fail('DIRECT_ARTIFACT_UNAVAILABLE');}
}

const inputKeys=new Set(['workId','checkpointId','workPassRef','workPass',
  'ownerDomain','expectedSourceSha','spec']);
export async function factoryDirectPrepare(env,input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!inputKeys.has(k)))
    return fail('GO_INPUT_INVALID');
  if(!['CODE','VISUAL'].includes(input.ownerDomain) ||
    !input.workId||!input.checkpointId||!input.workPassRef||
    input.workPass?.issuedBy!=='CITY_HALL'||
    input.workPass?.actor!=='GO'||
    input.workPass?.workId!==input.workId||
    input.workPass?.checkpointId!==input.checkpointId||
    !/^[a-f0-9]{40}$/.test(input.expectedSourceSha||'') ||
    !input.spec||typeof input.spec!=='object'||Array.isArray(input.spec))
    return fail('GO_INPUT_WORK_CONTEXT_INVALID');
  if(!configured(env))return fail('DIRECT_RAIL_NOT_CONFIGURED');
  try{
    const response=await directRequest(env,'/station/go-input','POST',input);
    if(!response.ok || response.result?.status!=='INPUT_PREPARED' ||
      response.result.workId!==input.workId||
      response.result.checkpointId!==input.checkpointId||
      response.result.domain!==input.ownerDomain||
      response.result.sourceSha!==input.expectedSourceSha||
      typeof response.result.ref!=='string'||
      !/^r2:\/\/factory\/edge-inputs\/go-[a-f0-9]{64}\.json#sha256=[a-f0-9]{64}$/.test(response.result.ref)||
      !/^[a-f0-9]{64}$/.test(response.result.sha256||'')||
      !response.result.ref.endsWith('#sha256='+response.result.sha256))
      return fail('GO_INPUT_NOT_VERIFIED');
    return {ok:true,...response.result,executed:false};
  }catch{return fail('GO_INPUT_UNAVAILABLE');}
}
// One owner-approved outcome operation: prepare immutable input, execute the
// scoped Work, fetch the real bytes and return source-owned evidence.
// No coordinator-generated artifact is substituted if any step is unavailable.
export async function factoryDirectSubmit(env,{work,spec}={},approved=false){
  if(approved!==true)return fail('OWNER_APPROVAL_REQUIRED');
  if(!work||typeof work!=='object'||Array.isArray(work)||
    typeof spec!=='object'||!spec||Array.isArray(spec))
    return fail('INVALID_SCOPED_GO_WORK');
  const ownerDomain=work.ownerDomain;
  if(!['CODE','VISUAL'].includes(ownerDomain))
    return fail('DIRECT_SUBMIT_DOMAIN_UNSUPPORTED');
  const input={workId:work.workId,checkpointId:work.checkpointId,
    workPassRef:work.workPassRef,workPass:work.workPass,
    expectedSourceSha:work.expectedSourceSha,ownerDomain,spec};
  const prepared=await factoryDirectPrepare(env,input);
  if(!prepared.ok)return prepared;
  const scope=ownerDomain==='CODE'?['EXECUTE:CODE','DEPLOY:CODE']:['EXECUTE:VISUAL'];
  const intent=ownerDomain==='CODE'?'EXECUTE_CODE':'EXECUTE_VISUAL';
  const run=await factoryDirectExecute(env,{
    ...work,intent,scope,inputRefs:[prepared.ref]
  },true);
  if(!run.ok)return {...run,preparedRef:prepared.ref};
  const suffix=ownerDomain==='VISUAL'?'/render.png':'/main.js';
  const ref=run.artifactRefs?.find(x=>typeof x==='string'&&
    x.startsWith('r2://factory/edge-results/')&&x.endsWith(suffix));
  if(!ref)return {...fail('DOMAIN_ARTIFACT_MISSING'),receiptId:run.receiptId,preparedRef:prepared.ref};
  const file=await factoryDirectArtifact(env,{
    receiptId:run.receiptId,artifactRef:ref,workId:run.taskWorkId,
    checkpointId:run.checkpointId,workPassRef:work.workPassRef,
    expectedSourceSha:work.expectedSourceSha
  });
  if(!file.ok)return {...file,receiptId:run.receiptId,
    artifactRef:ref,preparedRef:prepared.ref};
  return {ok:true,status:'GO_FACTORY_DELIVERABLE_READY',domain:ownerDomain,
    workId:run.taskWorkId,checkpointId:run.checkpointId,
    receiptId:run.receiptId,sourceSha:run.sourceSha,
    inputRef:prepared.ref,
    artifactRef:file.artifactRef,
    artifact:{mime:file.mime,bytes:file.bytes,sha256:file.sha256,base64:file.base64},
    evidenceRefs:run.evidenceRefs,executed:true,deliveredBytes:true};
}
