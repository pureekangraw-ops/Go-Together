import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {WORKSPACE_TOOLS} from '../worker/workspace-catalog.mjs';
import {hubTool} from '../worker/hub-client.mjs';
test('Workspace discovery and owner auth use existing GO rail without touching provider',async()=>{
 let calls=0;const env={HUB_V2:{relay(){calls++;throw Error('NO_CALL');}}};
 const req=(method,params)=>new Request('https://go-together.pureekangraw.workers.dev/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 const list=await (await worker.fetch(req('tools/list'),env,{})).json();
 for(const t of WORKSPACE_TOOLS)assert.deepEqual(list.result.tools.find(x=>x.name===t.name).inputSchema,t.inputSchema);
 const r=await worker.fetch(req('tools/call',{name:'google_workspace_write',arguments:{approved:true}}),env,{});assert.equal(r.status,401);assert.equal(calls,0);
});
test('Workspace source retry IDs stay in payload; fresh transport IDs allow reconciliation and safe source replay',async()=>{
 const sent=[];const env={HUB_V2:{relay:async x=>{sent.push(x);return {receipt:{state:'RESPONDED'},response:{body:JSON.stringify({result:{content:[{type:'text',text:'{}'}]}})}}}}};
 await hubTool(env,'google_workspace_write',{writeRequestId:'one'});await hubTool(env,'google_workspace_write',{writeRequestId:'one'});
 await hubTool(env,'google_workspace_receipt',{writeRequestId:'one'});await hubTool(env,'google_workspace_receipt',{writeRequestId:'one'});
 assert.notEqual(sent[0].messageId,sent[1].messageId);assert.equal(sent[0].payload.writeRequestId,sent[1].payload.writeRequestId);assert.notEqual(sent[2].messageId,sent[3].messageId);assert.ok(sent.every(x=>x.connectorId==='google'));
});
test('Workspace read advertises and forwards known receipt lower bound',async()=>{
 assert.deepEqual(WORKSPACE_TOOLS.find(t=>t.name==='google_workspace_read').inputSchema.properties.minimumVersion,{type:'integer',minimum:0});
 let sent;const env={HUB_V2:{relay:async x=>{sent=x;return {receipt:{state:'RESPONDED'},response:{body:JSON.stringify({result:{content:[{type:'text',text:'{"status":"UNKNOWN"}'}]}})}}}}};
 const result=await hubTool(env,'google_workspace_read',{workId:'WORK-ONE',minimumVersion:2});
 assert.equal(sent.payload.minimumVersion,2);assert.equal(result.status,'UNKNOWN');
});

test('latest main visual tools retain public and private Hub schema/dispatch parity',async()=>{
 const {appMcp}=await import('../worker/index.js');
 const {hubGroup}=await import('../worker/hub-client.mjs');
 const request=(path,method,params)=>new Request('https://go-together.pureekangraw.workers.dev'+path,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 const publicList=await (await worker.fetch(request('/mcp','tools/list'),{},{})).json();
 const privateList=await (await appMcp(request('/hub-mcp/factory','tools/list'),{})).json();
 const sent=[];const env={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.test',HUB_V2:{relay:async x=>{sent.push(x);const r=await appMcp(request('/hub-mcp/factory','tools/call',{name:x.name,arguments:x.payload}),{});return {receipt:{state:'RESPONDED'},response:{body:await r.text()}};}}};
 const owner={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.test'})}};
 for(const name of ['factory_visual_upload','factory_visual_upload_status','factory_visual_zip_chunk']){
  assert.equal(hubGroup(name),'factory');
  assert.deepEqual(privateList.result.tools.find(t=>t.name===name).inputSchema,publicList.result.tools.find(t=>t.name===name).inputSchema);
  const args={};const before=sent.length;
  assert.equal((await worker.fetch(request('/mcp','tools/call',{name,arguments:args}),env,{})).status,401);assert.equal(sent.length,before);
  await worker.fetch(request('/mcp','tools/call',{name,arguments:args}),env,owner);
  assert.equal(sent.at(-1).connectorId,'factory');assert.equal(sent.at(-1).name,name);
 }
 const submit=privateList.result.tools.find(t=>t.name==='factory_direct_submit');
 assert.ok(JSON.stringify(submit.inputSchema).includes('imageSplit'));
});

 test('private Factory adapter preserves the bounded large-upload exception',async()=>{
 const {appMcp}=await import('../worker/index.js');
 const req=name=>new Request('https://go-together.pureekangraw.workers.dev/hub-mcp/factory',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{pngBase64:'A'.repeat(1000100)}}})});
 const result=await (await appMcp(req('factory_visual_upload'),{})).json();
 assert.match(JSON.stringify(result),/explicit_owner_approval_required/);
 await assert.rejects(()=>appMcp(req('factory_visual_upload_status'),{}),/large_mcp_body_not_allowed/);
 });

test('status correlation stays in payload while mutation retry identities remain stable',async()=>{
 const sent=[];const env={HUB_V2:{relay:async x=>{sent.push(x);return {receipt:{state:'RESPONDED'},response:{body:JSON.stringify({result:{content:[{type:'text',text:'{}'}]}})}}}}};
 for(const name of ['factory_visual_upload_status','factory_direct_job_status','factory_visual_upload','factory_direct_submit','observatory_run','goview_publish']){
  const payload=name==='goview_publish'?{transferId:'synthetic'}:{requestId:'synthetic'};
  await hubTool(env,name,payload);await hubTool(env,name,payload);
  const [a,b]=sent.slice(-2);assert.deepEqual(a.payload,b.payload);
  if(name.endsWith('_status'))assert.notEqual(a.messageId,b.messageId);
  else assert.equal(a.messageId,b.messageId);
 }
});
