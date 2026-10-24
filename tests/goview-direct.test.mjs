import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
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
