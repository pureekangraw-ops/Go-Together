import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './hub-fixture.mjs';
import {factoryVisualTemp,validateFactoryTemp} from '../worker/factory-temp.mjs';
import {hubTool} from '../worker/hub-client.mjs';
const now=Date.now(),sha='d'.repeat(40),m={schema:'FACTORY_VISUAL_TEMP_V1',accountId:'a'.repeat(32),namespace:'factory-visual54-'+ 'b'.repeat(12),ownerToken:'c'.repeat(32),sourceSha:sha,approvalId:'owner-test-approval',cleanupApproved:true,createdAt:now-1000,expiresAt:now+599000,budget:{requests:18,browserActions:36,artifactBytes:10485760,concurrency:1,caseMs:360000,ttlMs:600000}};
const args=(operation='inventory')=>({expectedSourceSha:sha,manifest:structuredClone(m),operation,input:null,...(['register','create','remove'].includes(operation)?{approved:true,requestId:'7d17139a-9868-4577-927b-9abec72af417'}:{})});
const response=(operation,result,extra={})=>Response.json({schema:'FACTORY_VISUAL_TEMP_RESULT_V1',sourceSha:sha,namespace:m.namespace,operation,result,...extra});
const inventory={accountId:m.accountId,namespace:m.namespace,complete:true,observedAt:now,resources:[]};
const env=fetch=>({GO_FACTORY_RAIL_SECRET:'x'.repeat(48),FACTORY_DIRECT:{fetch}});
test('fixed signed scope and bounded envelope are sent once; receipt is not job completion',async()=>{
 let calls=0;const out=await factoryVisualTemp(env(async req=>{calls++;assert.equal(new URL(req.url).pathname,'/station/go-visual-temp');assert.equal(req.headers.get('x-factory-client'),'GO');assert.match(req.headers.get('x-metropolis-factory-signature'),/^[a-f0-9]{64}$/);const x=await req.json();assert.deepEqual(Object.keys(x).sort(),['expectedSourceSha','input','manifest','operation','schema']);return response('inventory',inventory);}),args());assert.equal(calls,1);assert.equal(out.ok,true);assert.equal(out.executed,false);
});
test('scope mismatch, arbitrary fields, overbudget and mutation without approval fail before transport',async()=>{
 for(const mutate of [a=>a.manifest.sourceSha='e'.repeat(40),a=>a.url='https://evil.test',a=>a.manifest.budget.requests=19,a=>{a.operation='register';},a=>a.manifest.namespace='production']){const a=args();mutate(a);let calls=0;await assert.rejects(factoryVisualTemp(env(async()=>{calls++;}),a),/INVALID/);assert.equal(calls,0);}
});
test('lost response, malformed, oversized and cross-source result remain UNKNOWN without retry',async()=>{
 for(const fetch of [async()=>{throw Error('private-token');},async()=>new Response('broken'),async()=>new Response('x'.repeat(65537)),async()=>response('inventory',inventory,{sourceSha:'f'.repeat(40)}),async()=>response('inventory',{...inventory,secret:'private-token'})]){let calls=0;const out=await factoryVisualTemp(env(async r=>{calls++;return fetch(r);}),args());assert.equal(out.status,'UNKNOWN');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(out),/private-token/);}
});
test('409 uncertain mutation stays UNKNOWN and private upstream error is omitted',async()=>{const out=await factoryVisualTemp(env(async()=>Response.json({status:'UNKNOWN',reason:'private-token'},{status:409})),args('register'));assert.equal(out.status,'UNKNOWN');assert.doesNotMatch(JSON.stringify(out),/private-token/);});
test('read polls are fresh, mutations deduplicate at Hub, relay loss preserves exact lookup',async()=>{
 const messages=[];const e={HUB_V2:{relay:async x=>{messages.push(x.messageId);throw Error('private-token');}}};
 const a=await hubTool(e,'factory_visual_temp',args());const b=await hubTool(e,'factory_visual_temp',args());assert.notEqual(a.receiptLookup.messageId,b.receiptLookup.messageId);
 const c=await hubTool(e,'factory_visual_temp',args('register'));const d=await hubTool(e,'factory_visual_temp',args('register'));assert.equal(c.receiptLookup.messageId,d.receiptLookup.messageId);assert.equal(messages.length,4);
});
test('Hub malformed response retains real delivery receipt and never retries',async()=>{let calls=0;const receipt={state:'UNKNOWN',messageId:'actual'};const out=await hubTool({HUB_V2:{relay:async()=>{calls++;return {receipt,response:{body:'bad json'}};}}},'factory_visual_temp',args());assert.deepEqual(out._hubReceipt,receipt);assert.equal(out.status,'UNKNOWN');assert.equal(calls,1);});
test('owner MCP auth blocks lifecycle before any Hub or Factory access',async()=>{let calls=0;const r=await worker.fetch(new Request('https://go.test/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'factory_visual_temp',arguments:args('register')}})}),{ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',HUB_V2:{relay:async()=>{calls++;}}},{});assert.equal(r.status,401);assert.equal(calls,0);});
test('malformed Hub envelopes and nonobject values preserve lookup rather than accepting data',async()=>{
 for(const delivered of [null,{}, {receipt:{state:'RESPONDED'},response:{body:JSON.stringify({result:{content:[{text:'null'}]}})}}]){
 let calls=0;const out=await hubTool({HUB_V2:{relay:async()=>{calls++;return delivered;}}},'factory_visual_temp',args());assert.ok(['UNKNOWN','DELIVERY_UNCERTAIN'].includes(out.status));assert.equal(out.receiptLookup.connectorId,'factory');assert.equal(calls,1);
 }
});
