import test from 'node:test';
import assert from 'node:assert/strict';
import {hubTool} from '../worker/hub-client.mjs';
import {PROVIDER_TOOLS} from '../worker/provider-catalog.mjs';
test('provider write requires owner request identity before entering Hub',async()=>{
 let calls=0;
 await assert.rejects(hubTool({HUB_V2:{relay:async()=>{calls++;return {};}}},'slack_post_message',{channel:'C1234567',text:'hello'}),/REQUEST_ID_REQUIRED/);
 assert.equal(calls,0);
 const t=PROVIDER_TOOLS.slack.find(t=>t.name==='slack_post_message');
 assert.ok(t.inputSchema.required.includes('requestId'));
});
test('provider retries reuse receipt identity; new owner request remains possible',async()=>{
 const ids=[];const env={HUB_V2:{relay:async input=>{ids.push(input.messageId);return {receipt:{state:'UNKNOWN',messageId:input.messageId}};}}};
 const a={channel:'C1234567',text:'hello',requestId:'owner-1'};
 const first=await hubTool(env,'slack_post_message',a);
 const retry=await hubTool(env,'slack_post_message',a);
 await hubTool(env,'slack_post_message',{...a,requestId:'owner-2'});
 assert.equal(first.status,'UNKNOWN');assert.equal(retry._hubReceipt.messageId,first._hubReceipt.messageId);
 assert.equal(ids[0],ids[1]);assert.notEqual(ids[1],ids[2]);
});
test('provider denial keeps receipt available to caller',async()=>{
 const env={HUB_V2:{relay:async()=>({receipt:{state:'RESPONDED',messageId:'denied'},response:{body:JSON.stringify({jsonrpc:'2.0',id:1,result:{isError:true,content:[{type:'text',text:'PROVIDER_OPERATION_FAILED'}]}})}})}};
 const r=await hubTool(env,'slack_post_message',{channel:'C1234567',text:'hello',requestId:'owner-1'});
 assert.equal(r.ok,false);assert.equal(r._hubReceipt.messageId,'denied');
});
