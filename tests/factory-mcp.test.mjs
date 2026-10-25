import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
const root='https://go-together.pureekangraw.workers.dev/mcp';
const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
test('PANTHEON tools are absent and cached calls cannot touch old bindings',async()=>{
 let calls=0;const env={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',PANTHEON:{fetch(){calls++;throw Error('must not call');}},PANTHEON_OWNER:{ownerCall(){calls++;throw Error('must not call');}}};
 const req=x=>new Request(root,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,...x})});
 const list=await (await worker.fetch(req({method:'tools/list'}),env,ctx)).json();
 assert.ok(list.result.tools.some(t=>t.name==='factory_direct_status'));
 assert.ok(!list.result.tools.some(t=>t.name.startsWith('pantheon_')||t.name==='factory_report'));
 for(const name of ['pantheon_health','pantheon_tasks','pantheon_command','pantheon_factory','factory_report']){
 const out=await (await worker.fetch(req({method:'tools/call',params:{name,arguments:{}}}),env,ctx)).json();assert.equal(out.error.message,'unknown_tool');
 }assert.equal(calls,0);
});
test('missing Hub does not fall back to app direct bindings',async()=>{
 let calls=0;const env={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',FACTORY_DIRECT:{fetch(){calls++;}}};
 const req=new Request(root,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'factory_direct_status',arguments:{}}})});
 const out=await (await worker.fetch(req,env,ctx)).json();assert.equal(out.result.isError,true);assert.equal(out.result.content[0].text,'HUB_V2_NOT_CONFIGURED');assert.equal(calls,0);
});

