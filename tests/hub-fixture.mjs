// Isolates the existing app/auth tests from Hub storage. The real Hub MCP,
// D1 journal and named bindings are verified by Hubstation's workerd suite.
import worker,{appMcp} from '../worker/index.js';
import {hubGroup} from '../worker/hub-client.mjs';
export default {fetch(req,env,ctx){
 const fixture={...env};
 if(!fixture.HUB_V2)fixture.HUB_V2={relay:async({connectorId,name,payload})=>{
  const response=await appMcp(new Request('https://go-together.pureekangraw.workers.dev/hub-mcp/'+connectorId,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:'fixture',method:'tools/call',params:{name,arguments:payload}})}),fixture);
  return {receipt:{state:'RESPONDED'},response:{body:await response.text()}};
 }};
 return worker.fetch(req,fixture,ctx);
}};
