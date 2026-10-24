export const isGoviewTool=name=>['goview_publish','goview_readback'].includes(name);
export async function goviewDirect(env,name,args={}) {
 if(!isGoviewTool(name))return {ok:false,status:'UNSUPPORTED'};
 if(!args||typeof args!=='object'||Array.isArray(args))return {ok:false,status:'INVALID_ARGUMENTS'};
 if(!env?.GOVIEW_GO||typeof env.GOVIEW_GO.invoke!=='function')return {ok:false,status:'GOVIEW_BINDING_NOT_CONFIGURED'};
 try {
  const result=await env.GOVIEW_GO.invoke(name,args);
  if(!result||typeof result.ok!=='boolean')return {ok:false,status:'INVALID_GOVIEW_RESPONSE'};
  return result;
 }catch{return {ok:false,status:'TRANSFER_UNCERTAIN_READ_EXACT_VERSION_BEFORE_RETRY'};}
}
