import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './hub-fixture.mjs';
import {goviewDirect} from '../worker/goview-direct.mjs';
const owner={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
const base={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com'};
const identity={mapId:'fixture',version:1,transferId:'fixture_transfer',sha256:'a'.repeat(64)};
const call=(env,ctx)=>worker.fetch(new Request('https://go-together.pureekangraw.workers.dev/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'goview_readback',arguments:identity}})}),env,ctx);
test('owner OAuth precedes map binding',async()=>{
 let calls=0;const env={...base,GOVIEW_GO:{invoke:async()=>{calls++;return {ok:true}}}};
 assert.equal((await call(env,{})).status,401);assert.equal(calls,0);
 assert.equal((await call(env,owner)).status,200);assert.equal(calls,1);
});
test('missing binding and uncertain response are explicit errors',async()=>{
 assert.equal((await goviewDirect({},'goview_readback',identity)).status,'GOVIEW_BINDING_NOT_CONFIGURED');
 assert.match((await goviewDirect({GOVIEW_GO:{invoke:async()=>{throw Error('secret')}}},'goview_publish',{...identity,package:'{}'})).status,/UNCERTAIN/);
 const r=await call(base,owner);assert.equal((await r.json()).result.isError,true);
});

test('caller boundary rejects missing and coerced identity without invoking binding',async()=>{
 let calls=0;const env={GOVIEW_GO:{invoke:async()=>{calls++;return {ok:true}}}};
 for(const args of [{},{...identity,transferId:123},{...identity,transferId:['fixture_transfer']},{...identity,sha256:['a'.repeat(64)]},{...identity,mapId:['fixture']}])
  assert.equal((await goviewDirect(env,'goview_readback',args)).status,'INVALID_ARTIFACT_IDENTITY');
 assert.equal(calls,0);
});

test('integrated GOVIEW commands retain owner boundary and dispatch through Hub app adapter',async()=>{
 const sent=[];const env={...base,GOVIEW_GO:{invoke:async(name,args)=>{sent.push({name,args});return {ok:true,status:'QUEUED',commandId:args.commandId};}}};
 const cases=[['goview_focus_point',{latitude:13,longitude:100}],['goview_propose_pin',{latitude:13,longitude:100,label:'Synthetic'}],['goview_command_status',{}]];
 for(const [name,extra] of cases){
  const args={commandId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',...extra};
  const req=()=>new Request('https://go-together.pureekangraw.workers.dev/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
  const before=sent.length;assert.equal((await worker.fetch(req(),env,{})).status,401);assert.equal(sent.length,before);
  const r=await (await worker.fetch(req(),env,owner)).json();assert.equal(r.result.isError,undefined);
  assert.equal(JSON.parse(r.result.content[0].text).status,'QUEUED');assert.deepEqual(sent.at(-1),{name,args});
 }
 const list=await (await worker.fetch(new Request('https://go-together.pureekangraw.workers.dev/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})}),env,owner)).json();
 for(const [name] of cases)assert.ok(list.result.tools.some(t=>t.name===name));
 assert.ok(list.result.tools.some(t=>t.name==='google_workspace_read'));
});
test('integrated map validation and uncertainty preserve original command identity',async()=>{
 const args={commandId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',latitude:13,longitude:100};let called=0;
 const bad={GOVIEW_GO:{invoke:async()=>{called++;throw Error('synthetic');}}};
 assert.equal((await goviewDirect(bad,'goview_focus_point',{...args,latitude:91})).status,'INVALID_DIRECT_MAP_COMMAND');assert.equal(called,0);
 assert.equal((await goviewDirect({},'goview_command_status',args)).status,'GOVIEW_BINDING_NOT_CONFIGURED');
 assert.equal((await goviewDirect(bad,'goview_focus_point',args)).status,'COMMAND_OUTCOME_UNCERTAIN_QUERY_ID');assert.equal(called,1);
});
