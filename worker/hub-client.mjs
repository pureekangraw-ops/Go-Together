export function hubGroup(name){
 if(name.startsWith('brain_'))return 'brain';
 if(name.startsWith('factory_direct_')||name==='factory_workshop_content')return 'factory';
 if(name.startsWith('observatory_'))return 'observatory';
 if(name.startsWith('goview_'))return 'goview';
 for(const p of ['github','cloudflare','notion','google'])if(name.startsWith(p+'_'))return p;
 return null;
}
export async function hubTool(env,name,payload){
 if(!env.HUB_V2)throw Error('HUB_V2_NOT_CONFIGURED');
 const retryIdentity=payload?.requestId||(name==='goview_publish'?payload?.transferId:null);
 const messageId=retryIdentity?'go_'+BufferlessHex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name+'\n'+retryIdentity))):crypto.randomUUID();
 // One attempt only. An ambiguous delivery is returned, never retried.
 const delivered=await env.HUB_V2.relay({connectorId:hubGroup(name),name,payload,messageId});
 if(!delivered.response)return {ok:false,status:delivered.receipt?.state||'DELIVERY_UNCERTAIN',_hubReceipt:delivered.receipt};
 let rpc;try{rpc=JSON.parse(delivered.response.body);}catch{throw Error('INVALID_HUB_RESPONSE');}
 if(rpc.error||rpc.result?.isError)throw Error(rpc.error?.message||rpc.result?.content?.[0]?.text||'UPSTREAM_TOOL_ERROR');
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
 for(const p of ['github','cloudflare','notion','google']){
  try{connections[p]=await hubTool(env,p+'_status',{});}catch{connections[p]={status:'UNAVAILABLE',connected:false};}
 }
 return {ok:true,status:'CATALOG_LOADED',source:inventory.source,connectors:inventory.connections,toolCount:inventory.tools,connections};
}

