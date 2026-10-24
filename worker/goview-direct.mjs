export const isGoviewTool=name=>['goview_publish','goview_readback','goview_propose_pin','goview_focus_point','goview_command_status'].includes(name);
export async function goviewDirect(env,name,args={}) {
 if(!isGoviewTool(name))return {ok:false,status:'UNSUPPORTED'};
 if(!args||typeof args!=='object'||Array.isArray(args))return {ok:false,status:'INVALID_ARGUMENTS'};
 if(typeof args.mapId!=='string'||!/^[a-zA-Z0-9_-]{1,70}$/.test(args.mapId)||
    !Number.isInteger(args.version)||args.version<1||args.version>999999||
    typeof args.transferId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(args.transferId)||
    typeof args.sha256!=='string'||!/^[a-f0-9]{64}$/.test(args.sha256)||
    (name==='goview_publish'&&(typeof args.package!=='string'||new TextEncoder().encode(args.package).length>1048832)))
   return {ok:false,status:'INVALID_ARTIFACT_IDENTITY'};
 if(!env?.GOVIEW_GO||typeof env.GOVIEW_GO.invoke!=='function')return {ok:false,status:'GOVIEW_BINDING_NOT_CONFIGURED'};
 try {
  const result=await env.GOVIEW_GO.invoke(name,args);
  if(!result||typeof result.ok!=='boolean')return {ok:false,status:'INVALID_GOVIEW_RESPONSE'};
  return result;
 }catch{return {ok:false,status:'TRANSFER_UNCERTAIN_READ_EXACT_VERSION_BEFORE_RETRY'};}
}
