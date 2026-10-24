// GO Brain uses its existing OAuth token and Cloudflare RPC Service Binding.
// No Observatory bearer secret is copied into GO Brain or this codebase.
export const isObservatoryTool=(name)=>[
 "observatory_session","observatory_observe","observatory_screenshot",
 "observatory_action","observatory_run","observatory_job","observatory_note"
].includes(name);
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export async function observatoryDirect(env,name,args={}){
 if(!isObservatoryTool(name))return {ok:false,status:"UNSUPPORTED"};
 if(!args||typeof args!=="object"||Array.isArray(args))
  return {ok:false,status:"INVALID_ARGUMENTS"};
 if(name==="observatory_run"&&!uuid.test(args.requestId||""))
  return {ok:false,status:"INVALID_REQUEST_ID_UUID"};
 if(!env?.OBSERVATORY_GO||typeof env.OBSERVATORY_GO.invoke!=="function")
  return {ok:false,status:"OBSERVATORY_BINDING_NOT_CONFIGURED"};
 try{
  const result=await env.OBSERVATORY_GO.invoke(name,args);
  if(!result||typeof result!=="object"||typeof result.ok!=="boolean")
   return {ok:false,status:"INVALID_OBSERVATORY_RPC_RESPONSE"};
  return result;
 }catch{return {ok:false,status:"OBSERVATORY_RPC_UNAVAILABLE"};}
}
