import {PROVIDER_TOOLS} from './provider-catalog.mjs';
export function hubGroup(name){
 if(name.startsWith('brain_'))return 'brain';
 if(name.startsWith('factory_direct_')||name.startsWith('factory_visual_')||name==='factory_workshop_content')return 'factory';
 if(name.startsWith('observatory_'))return 'observatory';
 if(name.startsWith('goview_'))return 'goview';
 for(const p of ['github','cloudflare','notion','google','gitlab','slack'])if(name.startsWith(p+'_'))return p;
 return null;
}
export async function hubTool(env,name,payload){
 if(!env.HUB_V2)throw Error('HUB_V2_NOT_CONFIGURED');
 const definition=PROVIDER_TOOLS[hubGroup(name)]?.find(t=>t.name===name);
 if(definition?.annotations?.readOnlyHint===false&&(typeof payload?.requestId!=='string'||!payload.requestId.length||payload.requestId.length>120))throw Error('REQUEST_ID_REQUIRED');
 // Readback polls must observe changing source state, rather than deduplicate
 // forever against the first read of a given job/request ID.
 const polling=['factory_direct_job_status','factory_visual_upload_status','github_code_job_readback'].includes(name);
 const retryIdentity=polling?null:(payload?.requestId||(name==='goview_publish'?payload?.transferId:null));
 const messageId=retryIdentity?'go_'+BufferlessHex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name+'\n'+retryIdentity))):crypto.randomUUID();
 // One attempt only. An ambiguous delivery is returned, never retried.
 const delivered=await env.HUB_V2.relay({connectorId:hubGroup(name),name,payload,messageId});
 if(!delivered.response)return {ok:false,status:delivered.receipt?.state||'DELIVERY_UNCERTAIN',_hubReceipt:delivered.receipt};
 let rpc;try{rpc=JSON.parse(delivered.response.body);}catch{throw Error('INVALID_HUB_RESPONSE');}
 if(rpc.error||rpc.result?.isError){
  const error=rpc.error?.message||rpc.result?.content?.[0]?.text||'UPSTREAM_TOOL_ERROR';
  if(definition)return {ok:false,status:'UPSTREAM_TOOL_ERROR',error,_hubReceipt:delivered.receipt};
  throw Error(error);
 }
 const text=rpc.result?.content?.[0]?.text;if(typeof text!=='string')throw Error('INVALID_HUB_RESPONSE');
 const value=JSON.parse(text);
 if(value&&typeof value==='object'&&!Array.isArray(value))return {...value,_hubReceipt:delivered.receipt};
 return value;
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


