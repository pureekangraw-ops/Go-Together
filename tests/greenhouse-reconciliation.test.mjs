import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {hubGroup,hubTool} from '../worker/hub-client.mjs';
const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
const base={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com'};
const req=(method,name,args={})=>new Request('https://go-together.pureekangraw.workers.dev/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{name,arguments:args}})});
test('public catalog exposes only three explicit Greenhouse reads and exact Hub receipt lookup',async()=>{
 const x=await(await worker.fetch(req('tools/list'),base,ctx)).json();
 assert.deepEqual(x.result.tools.filter(t=>t.name.startsWith('greenhouse_')).map(t=>t.name).sort(),['greenhouse_delivery_get','greenhouse_delivery_list','greenhouse_result_get']);
 for(const t of x.result.tools.filter(t=>t.name.startsWith('greenhouse_')||t.name==='hub_delivery_receipt'))assert.equal(t.annotations.readOnlyHint,true);
});
test('Greenhouse reads route once through Hub with fresh read identities; invalid arguments never relay',async()=>{
 const calls=[];const env={...base,HUB_V2:{relay:async input=>{calls.push(input);return {receipt:{state:'UNKNOWN',messageId:input.messageId}};}}};
 assert.equal(hubGroup('greenhouse_delivery_get'),'greenhouse');assert.equal(hubGroup('greenhouse_submit'),null);
 for(let i=0;i<2;i++){
 const x=await(await worker.fetch(req('tools/call','greenhouse_delivery_get',{attemptId:'attempt-1'}),env,ctx)).json();
 assert.equal(JSON.parse(x.result.content[0].text)._hubReceipt.state,'UNKNOWN');
 }
 assert.equal(calls.length,2);assert.equal(calls[0].connectorId,'greenhouse');assert.notEqual(calls[0].messageId,calls[1].messageId);
 for(const args of [{limit:0},{limit:31},{limit:1.5},{limit:2,owner:'other'}])await worker.fetch(req('tools/call','greenhouse_delivery_list',args),env,ctx);
 assert.equal(calls.length,2);
});
test('exact Hub receipt tool calls receipt only, after owner authentication',async()=>{
 let n=0;const env={...base,HUB_V2:{receipt:async input=>{n++;assert.deepEqual(input,{connectorId:'brain',messageId:'exact-1'});return {status:'NOT_FOUND',receipt:null};},relay(){throw Error('MUST_NOT_RELAY');}}};
 const x=await(await worker.fetch(req('tools/call','hub_delivery_receipt',{connectorId:'brain',messageId:'exact-1'}),env,ctx)).json();
 assert.equal(JSON.parse(x.result.content[0].text).status,'NOT_FOUND');assert.equal(n,1);
 assert.equal((await worker.fetch(req('tools/call','hub_delivery_receipt',{connectorId:'brain',messageId:'exact-1'}),env,{})).status,401);assert.equal(n,1);
});
test('Greenhouse malformed MCP body preserves exact delivery receipt with no retry',async()=>{
 let n=0;const env={HUB_V2:{relay:async()=>{n++;return {receipt:{messageId:'bad-read',state:'RESPONDED',taskSuccess:null},response:{body:'broken-json'}};}}};
 const x=await hubTool(env,'greenhouse_delivery_get',{attemptId:'attempt-1'});
 assert.equal(x.ok,false);assert.equal(x.status,'INVALID_HUB_RESPONSE');assert.equal(x._hubReceipt.messageId,'bad-read');assert.equal(n,1);
});
test('attempt identity accepts exact PIXIE boundary and denies malformed or oversized values before Hub',async()=>{
 let n=0;const env={HUB_V2:{relay:async()=>{n++;return {receipt:{state:'UNKNOWN'}};}}};
 await hubTool(env,'greenhouse_delivery_get',{attemptId:'A'+'x'.repeat(127)});
 for(const attemptId of ['','-bad','.bad','A'+'x'.repeat(128),123])await assert.rejects(hubTool(env,'greenhouse_delivery_get',{attemptId}),/INVALID_GREENHOUSE_ARGUMENTS/);
 assert.equal(n,1);
});
test('Greenhouse safe source error codes retain receipt while arbitrary MCP error text stays private',async()=>{
 const cases=[
  [{code:'READ_NOT_AUTHORIZED'},'READ_NOT_AUTHORIZED'],
  [{code:'READER_UNAVAILABLE'},'READER_UNAVAILABLE'],
  [{code:'SOURCE_READBACK_REJECTED'},'SOURCE_READBACK_REJECTED'],
  [{code:'READ_ARGUMENTS_INVALID'},'READ_ARGUMENTS_INVALID'],
  [{code:'READ_NOT_AUTHORIZED',details:'secret-token'},'READ_NOT_AUTHORIZED'],
  [{code:'UNEXPECTED_PRIVATE_ERROR',details:'secret-token'},'UPSTREAM_TOOL_ERROR'],
  ['READ_NOT_AUTHORIZED secret-token','UPSTREAM_TOOL_ERROR'],
  [null,'UPSTREAM_TOOL_ERROR'],
 ];
 for(const [value,status] of cases){
  let n=0;const env={HUB_V2:{relay:async()=>{n++;return {receipt:{messageId:'denial',state:'RESPONDED',taskSuccess:null},response:{body:JSON.stringify({jsonrpc:'2.0',id:1,result:{isError:true,content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]}})}};}}};
  const x=await hubTool(env,'greenhouse_delivery_get',{attemptId:'a1'});
  assert.equal(x.status,status);assert.equal(x.ok,false);assert.equal(x._hubReceipt.messageId,'denial');assert.equal(n,1);
  assert.equal(JSON.stringify(x).includes('secret-token'),false);assert.equal(JSON.stringify(x).includes('UNEXPECTED_PRIVATE_ERROR'),false);
 }
 const env={HUB_V2:{relay:async()=>({receipt:{messageId:'rpc',state:'RESPONDED'},response:{body:JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32603,message:'secret-token'}})}})}};
 assert.deepEqual(await hubTool(env,'greenhouse_delivery_get',{attemptId:'a1'}),{ok:false,status:'UPSTREAM_TOOL_ERROR',_hubReceipt:{messageId:'rpc',state:'RESPONDED'}});
});
test('Greenhouse non-object domain result is rejected with exact receipt and no retry',async()=>{
 for(const value of [[],null,'unexpected',true,42]){
  let n=0;const env={HUB_V2:{relay:async()=>{n++;return {receipt:{messageId:'malformed-value',state:'RESPONDED'},response:{body:JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify(value)}]}})}};}}};
  assert.deepEqual(await hubTool(env,'greenhouse_delivery_get',{attemptId:'a1'}),{ok:false,status:'INVALID_HUB_RESPONSE',_hubReceipt:{messageId:'malformed-value',state:'RESPONDED'}});assert.equal(n,1);
 }
});
test('receipt catalog entry exists and invalid lookup never invokes any Hub method',async()=>{
 const {hubDeliveryReceipt}=await import('../worker/greenhouse-read.mjs');
 const x=await(await worker.fetch(req('tools/list'),base,ctx)).json();
 assert.equal(x.result.tools.find(t=>t.name==='hub_delivery_receipt')?.annotations.readOnlyHint,true);
 let calls=0;const env={HUB_V2:{receipt:async()=>{calls++;},relay:()=>{calls++;},refresh:()=>{calls++;}}};
 for(const args of [null,[],{}, {connectorId:'greenhouse',messageId:12},{connectorId:'greenhouse',messageId:'a/b'},{connectorId:'greenhouse',messageId:'exact-1',ownerId:'other'},{connectorId:'x'.repeat(101),messageId:'exact-1'}])await assert.rejects(hubDeliveryReceipt(env,args),/INVALID_RECEIPT_QUERY/);
 assert.equal(calls,0);
 await assert.rejects(hubDeliveryReceipt({}, {connectorId:'greenhouse',messageId:'exact-1'}),/HUB_RECEIPT_NOT_CONFIGURED/);
});
test('uncertain Greenhouse relay retains exact lookup identity without leaking transport exception or replay',async()=>{
 let input,calls=0;
 const env={HUB_V2:{relay:async x=>{input=x;calls++;throw Error('secret-transport-key');},receipt:async x=>{assert.deepEqual(x,{connectorId:'greenhouse',messageId:input.messageId});return {status:'NOT_FOUND',receipt:null};}}};
 const x=await hubTool(env,'greenhouse_delivery_get',{attemptId:'attempt1'});
 assert.equal(x.status,'DELIVERY_UNCERTAIN');assert.deepEqual(x.receiptLookup,{connectorId:'greenhouse',messageId:input.messageId});assert.equal('_hubReceipt' in x,false);assert.equal(JSON.stringify(x).includes('secret'),false);
 const {hubDeliveryReceipt}=await import('../worker/greenhouse-read.mjs');assert.equal((await hubDeliveryReceipt(env,x.receiptLookup)).status,'NOT_FOUND');assert.equal(calls,1);
});
test('non-object RPC envelopes retain receipt as invalid response',async()=>{
 for(const value of [null,[],true,42,'private-text']){
  const env={HUB_V2:{relay:async()=>({receipt:{messageId:'exact-id',state:'RESPONDED'},response:{body:JSON.stringify(value)}})}};
  assert.deepEqual(await hubTool(env,'greenhouse_delivery_get',{attemptId:'attempt1'}),{ok:false,status:'INVALID_HUB_RESPONSE',_hubReceipt:{messageId:'exact-id',state:'RESPONDED'}});
 }
});
test('malformed missing relay envelope keeps original lookup identity without fabricating receipt',async()=>{
 for(const result of [undefined,null,[]]){
  let input,calls=0;const env={HUB_V2:{relay:async x=>{input=x;calls++;return result;}}};
  const value=await hubTool(env,'greenhouse_delivery_get',{attemptId:'attempt1'});
  assert.deepEqual(value,{ok:false,status:'DELIVERY_UNCERTAIN',receiptLookup:{connectorId:'greenhouse',messageId:input.messageId}});assert.equal(calls,1);
 }
});
test('empty and receipt-less relay envelopes keep exact lookup identity',async()=>{
 for(const result of [{},{response:null},{receipt:null},{response:{body:'{}'}},{receipt:[]},{receipt:'private'}]){
  let input,calls=0;const env={HUB_V2:{relay:async x=>{input=x;calls++;return result;}}};
  const value=await hubTool(env,'greenhouse_delivery_get',{attemptId:'attempt1'});
  assert.deepEqual(value,{ok:false,status:'DELIVERY_UNCERTAIN',receiptLookup:{connectorId:'greenhouse',messageId:input.messageId}});assert.equal(calls,1);
 }
});
test('response-less delivery retains real receipt and exact lookup identity',async()=>{
 let input;const receipt={messageId:'known',state:'UNKNOWN',taskSuccess:null};
 const value=await hubTool({HUB_V2:{relay:async x=>{input=x;return {receipt,response:null};}}},'greenhouse_delivery_get',{attemptId:'attempt1'});
 assert.deepEqual(value,{ok:false,status:'UNKNOWN',_hubReceipt:receipt,receiptLookup:{connectorId:'greenhouse',messageId:input.messageId}});
});
