// Real pinned Hub deduplication and SQLite journal, synthetic source only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import worker,{appMcp} from '../worker/index.js';
const root=process.env.HUB_SOURCE;if(!root)throw Error('HUB_SOURCE_REQUIRED');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),'3da763a3083654fe69945da0e8e6d5e86eb706e3');
const {privateHub}=await import(pathToFileURL(root+'/src/private.js'));
const {database}=await import(pathToFileURL(root+'/test/db.js'));
const endpoint='https://synthetic.example/hub-mcp/factory',seen=[];let sourceStatus='PENDING';
const hub=privateHub({HUB_DB:database(),ALLOWED_ORIGINS:'https://synthetic.example',
 MANAGED_CONNECTORS:JSON.stringify([{id:'factory',name:'Factory',protocol:'mcp',endpoint}]),
 SERVICE_ENDPOINTS:JSON.stringify({[endpoint]:'SOURCE'}),SOURCE:{fetch:async req=>{
  const rpc=await req.clone().json();
  if(rpc.method!=='tools/call')return appMcp(req,{});
  seen.push(rpc.params);return Response.json({jsonrpc:'2.0',id:rpc.id,result:{content:[{type:'text',text:JSON.stringify({ok:true,status:sourceStatus,observation:seen.length,requestId:rpc.params.arguments.requestId})}]}});
 }}},()=>{throw Error('NO_NETWORK');});
await hub.connections();
const env={HUB_V2:hub,ACCESS_AUD:'fixture-aud',OWNER_EMAIL:'owner@example.test'};
const owner={access:{aud:'fixture-aud',getIdentity:async()=>({email:'owner@example.test'})}};
async function call(name,args){
 const req=new Request('https://go-together.pureekangraw.workers.dev/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
 const rpc=await (await worker.fetch(req,env,owner)).json();
 assert.ok(!rpc.result.isError,JSON.stringify(rpc));return JSON.parse(rpc.result.content[0].text);
}
const requestId='123e4567-e89b-42d3-a456-426614174000';
for(const name of ['factory_visual_upload_status','factory_direct_job_status']){
 sourceStatus='PENDING';const before=seen.length,first=await call(name,{requestId});
 sourceStatus='COMPLETED';const second=await call(name,{requestId});
 assert.equal(first.status,'PENDING');assert.equal(second.status,'COMPLETED');
 assert.equal(second.observation,first.observation+1);assert.equal(seen.length,before+2);
 assert.notEqual(first._hubReceipt.messageId,second._hubReceipt.messageId);
 assert.equal(seen.at(-1).arguments.requestId,requestId);
}
const args={requestId,pngBase64:'A'.repeat(80),sha256:'a'.repeat(64),approved:true};
const before=seen.length,first=await call('factory_visual_upload',args),duplicate=await call('factory_visual_upload',args);
assert.equal(seen.length,before+1);assert.equal(duplicate.ok,false);
assert.equal(duplicate._hubReceipt.messageId,first._hubReceipt.messageId);
assert.equal(duplicate._hubReceipt.state,'RESPONDED');
console.log('PASS: fresh status observations through pinned Hub; upload mutation remains deduplicated; synthetic source only');
