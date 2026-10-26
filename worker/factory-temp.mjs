import {goRailSecretConfigured,signedFactoryRequest} from './factory-direct.mjs';
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const check=(ok)=>{if(!ok)throw Error('INVALID_FACTORY_TEMP_ARGUMENTS');};
const limits={requests:18,browserActions:36,artifactBytes:10485760,concurrency:1,caseMs:360000,ttlMs:3600000};
const operations=['register','capabilities','inventory','quota','create','remove'];
export const factoryTempMutates=operation=>['register','create','remove'].includes(operation);
export function validateFactoryTemp(a){
 check(object(a)&&Object.keys(a).every(k=>['expectedSourceSha','manifest','operation','input','requestId','approved'].includes(k)));
 const m=a.manifest;check(operations.includes(a.operation)&&/^[a-f0-9]{40}$/.test(a.expectedSourceSha||''));
 check(exact(m,['schema','accountId','namespace','ownerToken','sourceSha','approvalId','cleanupApproved','createdAt','expiresAt','budget']));
 check(m.schema==='FACTORY_VISUAL_TEMP_V1'&&/^[a-f0-9]{32}$/.test(m.accountId)&&/^factory-visual54-[a-f0-9]{12}$/.test(m.namespace)&&/^[a-f0-9]{32}$/.test(m.ownerToken)&&m.sourceSha===a.expectedSourceSha&&/^[A-Za-z0-9_.:-]{8,100}$/.test(m.approvalId)&&m.cleanupApproved===true);
 check(Number.isSafeInteger(m.createdAt)&&Number.isSafeInteger(m.expiresAt)&&m.createdAt>=0&&m.createdAt<=Date.now()&&m.expiresAt>m.createdAt&&m.expiresAt-m.createdAt<=limits.ttlMs);
 check(exact(m.budget,Object.keys(limits))&&Object.entries(limits).every(([k,v])=>Number.isSafeInteger(m.budget[k])&&m.budget[k]>0&&m.budget[k]<=v)&&m.budget.ttlMs===m.expiresAt-m.createdAt);
 if(factoryTempMutates(a.operation)){check(a.approved===true&&typeof a.requestId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a.requestId));}
 else check(a.approved===undefined&&a.requestId===undefined);
 if(['register','capabilities','inventory','quota'].includes(a.operation))check(a.input===null);
 else {check(object(a.input));const i=a.input;
 if(a.operation==='create'){check(exact(i,['kind','name','ownerToken','sourceSha','accountId','namespace','budget','expiresAt'])&&['bucket','queue','worker'].includes(i.kind)&&i.name===m.namespace+'-'+i.kind&&i.ownerToken===m.ownerToken&&i.sourceSha===m.sourceSha&&i.accountId===m.accountId&&i.namespace===m.namespace&&i.expiresAt===m.expiresAt&&exact(i.budget,Object.keys(limits))&&Object.keys(limits).every(k=>i.budget[k]===m.budget[k]));}
 else {check(exact(i,['resource','accountId','namespace','requireEmpty','requireInactive'])&&i.accountId===m.accountId&&i.namespace===m.namespace&&i.requireEmpty===true&&i.requireInactive===true);const r=i.resource;check(object(r)&&Object.keys(r).every(k=>['kind','name','id','ownerToken','sourceSha','incarnation','providerRevision','empty','activeJobs','codeUploaded','deployed','bindingsActive'].includes(k))&&['bucket','queue','worker'].includes(r.kind)&&r.name===m.namespace+'-'+r.kind&&r.ownerToken===m.ownerToken&&r.sourceSha===m.sourceSha&&typeof r.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(r.id)&&r.empty===true&&r.activeJobs===0);}
 }
 check(new TextEncoder().encode(JSON.stringify(a)).length<=8192);
 return a;
}
export const FACTORY_TEMP_TOOL={name:'factory_visual_temp',description:'Operate only the preconfigured temporary Factory namespace through the signed private rail. register/create/remove require owner approval and stable requestId. Reads never execute jobs; uncertain mutations are never retried. This creates empty resource entities only, not a hosted test deployment.',inputSchema:{type:'object',properties:{expectedSourceSha:{type:'string',pattern:'^[a-f0-9]{40}$'},manifest:{type:'object'},operation:{type:'string',enum:operations},input:{type:['object','null']},requestId:{type:'string'},approved:{type:'boolean',const:true}},required:['expectedSourceSha','manifest','operation','input'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false}};
async function readJson(r){const reader=r.body?.getReader();if(!reader)throw Error();let size=0,text='';const decoder=new TextDecoder();try{for(;;){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>65536){reader.cancel().catch(()=>{});throw Error();}text+=decoder.decode(x.value,{stream:true});}return JSON.parse(text+decoder.decode());}finally{reader.releaseLock();}}
function projectResult(operation,x,m){
 const keys={register:['registered','namespace','sourceSha','readyForJobs','quotaEvidenceRef'],capabilities:['schema','durableOwnershipCAS','emptyWorkerEntity','exclusiveNamespace','boundedObservedDelete','nativeConditionalDelete','outOfBandAdminProtection'],inventory:['accountId','namespace','complete','observedAt','resources'],quota:['confirmed','approvalId','accountId','namespace','ownerToken','sourceSha','validUntil','available','evidenceRef'],create:['kind','name','id','ownerToken','sourceSha','incarnation','providerRevision','empty','activeJobs','codeUploaded','deployed','bindingsActive'],remove:['absent','id']};
 if(!object(x)||Object.keys(x).some(k=>!keys[operation].includes(k)))throw Error();
 const r=structuredClone(x);
 if(operation==='inventory'){
 if(r.accountId!==m.accountId||r.namespace!==m.namespace||r.complete!==true||!Array.isArray(r.resources)||r.resources.length>3)throw Error();
 r.resources=r.resources.map(v=>projectResult('create',v,m));
 }
 if(operation==='create'&&(!['bucket','queue','worker'].includes(r.kind)||r.name!==m.namespace+'-'+r.kind||r.ownerToken!==m.ownerToken||r.sourceSha!==m.sourceSha||typeof r.id!=='string'))throw Error();
 if(operation==='register'&&(r.registered!==true||r.namespace!==m.namespace||r.sourceSha!==m.sourceSha||r.readyForJobs!==false))throw Error();
 if(operation==='quota'&&(r.confirmed!==true||r.approvalId!==m.approvalId||r.accountId!==m.accountId||r.namespace!==m.namespace||r.ownerToken!==m.ownerToken||r.sourceSha!==m.sourceSha||!exact(r.available,Object.keys(limits))))throw Error();
 if(operation==='capabilities'&&(r.schema!=='FACTORY_VISUAL_LIFECYCLE_CAPABILITIES_V1'||r.durableOwnershipCAS!==true||r.emptyWorkerEntity!==true||r.exclusiveNamespace!==true||r.boundedObservedDelete!==true))throw Error();
 if(operation==='remove'&&(r.absent!==true||typeof r.id!=='string'))throw Error();
 return r;
}
export async function factoryVisualTemp(env,a){
 validateFactoryTemp(a);
 const base={operation:a.operation,namespace:a.manifest.namespace,sourceSha:a.expectedSourceSha,executed:false};
 if(!goRailSecretConfigured(env.GO_FACTORY_RAIL_SECRET)||typeof env.FACTORY_DIRECT?.fetch!=='function')return {...base,ok:false,status:'FACTORY_TEMP_NOT_CONFIGURED'};
 const body={schema:'FACTORY_VISUAL_TEMP_OPERATION_V1',expectedSourceSha:a.expectedSourceSha,manifest:a.manifest,operation:a.operation,input:a.input};
 try{
 const response=await signedFactoryRequest(env,'POST','/station/go-visual-temp',body,AbortSignal.timeout(30000));
 const x=await readJson(response);
 if(!response.ok)return {...base,ok:false,status:response.status>=500||x?.status==='UNKNOWN'?'UNKNOWN':'DENIED',httpStatus:response.status};
 if(!exact(x,['schema','sourceSha','namespace','operation','result'])||x.schema!=='FACTORY_VISUAL_TEMP_RESULT_V1'||x.sourceSha!==a.expectedSourceSha||x.namespace!==a.manifest.namespace||x.operation!==a.operation||!object(x.result))throw Error();
 const result=projectResult(a.operation,x.result,a.manifest);
 if(a.operation==='create'&&result.kind!==a.input.kind||a.operation==='remove'&&result.id!==a.input.resource.id)throw Error();
 return {...base,ok:true,status:'OBSERVED',result};
 }catch{return {...base,ok:false,status:'UNKNOWN'};}
}
