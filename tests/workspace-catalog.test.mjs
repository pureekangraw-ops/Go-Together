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
