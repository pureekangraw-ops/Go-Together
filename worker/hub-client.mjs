import {validateFactoryTemp,factoryTempMutates} from './factory-temp.mjs';
import {PROVIDER_TOOLS} from './provider-catalog.mjs';
import {validateGreenhouseRead} from './greenhouse-read.mjs';
const GREENHOUSE_SAFE_ERROR_CODES=new Set(['READ_ARGUMENTS_INVALID','READ_NOT_AUTHORIZED','READER_UNAVAILABLE','SOURCE_READBACK_REJECTED']);
export function hubGroup(name){
 if(['greenhouse_delivery_list','greenhouse_delivery_get','greenhouse_result_get'].includes(name))return 'greenhouse';
 if(name.startsWith('brain_'))return 'brain';
 if(name.startsWith('factory_direct_')||name.startsWith('factory_visual_')||name==='factory_workshop_content')return 'factory';
 if(name.startsWith('observatory_'))return 'observatory';
 if(name.startsWith('goview_'))return 'goview';
 for(const p of ['github','cloudflare','notion','google','gitlab','slack'])if(name.startsWith(p+'_'))return p;
 return null;
}
export async function hubTool(env,name,payload){
 if(!env.HUB_V2)throw Error('HUB_V2_NOT_CONFIGURED');
 if(name==='factory_visual_temp')validateFactoryTemp(payload);
 if(hubGroup(name)==='greenhouse')validateGreenhouseRead(name,payload);
 const definition=PROVIDER_TOOLS[hubGroup(name)]?.find(t=>t.name===name);
 if(definition?.annotations?.readOnlyHint===false&&(typeof payload?.requestId!=='string'||!payload.requestId.length||payload.requestId.length>120))throw Error('REQUEST_ID_REQUIRED');
 // Readback polls must observe changing source state, rather than deduplicate
 // forever against the first read of a given job/request ID.
 const polling=['factory_direct_job_status','factory_visual_upload_status'].includes(name)||(name==='factory_visual_temp'&&!factoryTempMutates(payload.operation));
 const retryIdentity=polling?null:(payload?.requestId||(name==='goview_publish'?payload?.transferId:null));
 const messageId=retryIdentity?'go_'+BufferlessHex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name+'\n'+retryIdentity))):crypto.randomUUID();
 // One attempt only. An ambiguous delivery is returned, never retried.
 let delivered;
 try{delivered=await env.HUB_V2.relay({connectorId:hubGroup(name),name,payload,messageId});}
 catch(error){
  if(hubGroup(name)==='greenhouse'||name==='factory_visual_temp')return {ok:false,status:'DELIVERY_UNCERTAIN',receiptLookup:{connectorId:hubGroup(name),messageId}};
  throw error;
 }
 if((hubGroup(name)==='greenhouse'||name==='factory_visual_temp')&&(!delivered||typeof delivered!=='object'||Array.isArray(delivered)))
  return {ok:false,status:'DELIVERY_UNCERTAIN',receiptLookup:{connectorId:hubGroup(name),messageId}};
 if((hubGroup(name)==='greenhouse'||name==='factory_visual_temp')&&(!delivered.receipt||typeof delivered.receipt!=='object'||Array.isArray(delivered.receipt)))
  return {ok:false,status:'DELIVERY_UNCERTAIN',receiptLookup:{connectorId:hubGroup(name),messageId}};
 if(!delivered.response)return {ok:false,status:delivered.receipt?.state||'DELIVERY_UNCERTAIN',_hubReceipt:delivered.receipt,
  ...((hubGroup(name)==='greenhouse'||name==='factory_visual_temp')?{receiptLookup:{connectorId:hubGroup(name),messageId}}:{})};
 try{
 let rpc;try{rpc=JSON.parse(delivered.response.body);}catch{throw Error('INVALID_HUB_RESPONSE');}
 if(hubGroup(name)==='greenhouse'&&(!rpc||typeof rpc!=='object'||Array.isArray(rpc)))throw Error('INVALID_HUB_RESPONSE');
 if(rpc.error||rpc.result?.isError){
  if(hubGroup(name)==='greenhouse'){
   let code;try{code=JSON.parse(rpc.result?.content?.[0]?.text)?.code;}catch{}
   return {ok:false,status:GREENHOUSE_SAFE_ERROR_CODES.has(code)?code:'UPSTREAM_TOOL_ERROR',_hubReceipt:delivered.receipt};
  }
  const error=rpc.error?.message||rpc.result?.content?.[0]?.text||'UPSTREAM_TOOL_ERROR';
  if(definition)return {ok:false,status:'UPSTREAM_TOOL_ERROR',error,_hubReceipt:delivered.receipt};
  throw Error(error);
 }
 const text=rpc.result?.content?.[0]?.text;if(typeof text!=='string')throw Error('INVALID_HUB_RESPONSE');
 const value=JSON.parse(text);
 if((hubGroup(name)==='greenhouse'||name==='factory_visual_temp')&&(!value||typeof value!=='object'||Array.isArray(value)))throw Error('INVALID_HUB_RESPONSE');
 if(value&&typeof value==='object'&&!Array.isArray(value))return {...value,_hubReceipt:delivered.receipt};
 return value;
 }catch(error){
  if(name==='factory_visual_temp')return {ok:false,status:'UNKNOWN',_hubReceipt:delivered?.receipt,receiptLookup:{connectorId:'factory',messageId}};
  if(hubGroup(name)==='greenhouse')return {ok:false,status:error.message==='INVALID_HUB_RESPONSE'||error instanceof SyntaxError?'INVALID_HUB_RESPONSE':'UPSTREAM_TOOL_ERROR',_hubReceipt:delivered.receipt};
  throw error;
 }
}
function BufferlessHex(value){return [...new Uint8Array(value)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function hubConnections(env){
 if(!env.HUB_V2)return {ok:false,status:'HUB_V2_NOT_CONFIGURED',source:'YGG_CONNECTION_HUB_V2'};
 const inventory=await env.HUB_V2.connections();
 const connections={};
 for(const p of ['github','cloudflare','notion','google','gitlab','slack']){
  try{connections[p]=await hubTool(env,p+'_status',{});}catch{connections[p]={status:'UNAVAILABLE',connected:false};}
 }
 return {ok:true,status:'CATALOG_LOADED',source:inventory.source,connectors:inventory.connections,toolCount:inventory.tools,connections};
}

