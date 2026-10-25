import test from 'node:test';
import assert from 'node:assert/strict';
import {goviewDirect,isGoviewTool} from '../worker/goview-direct.mjs';
test('selected typed transfer tools are recognized',()=>{
 for(const name of ['goview_transfer_read','goview_transfer_publish','goview_transfer_receipt'])assert.equal(isGoviewTool(name),true);
});
import worker from '../worker/index.js';
import {snapshot,proposal,studio,receipt,hash} from './goview-transfer-fixtures.mjs';
const owner={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
function fixture(handler){
 const calls=[];return {calls,env:{GOVIEW_GO:{invoke:async(name,args)=>{calls.push({name,args:structuredClone(args)});return handler(name,args)}}}};
}
const ok=envelope=>({ok:true,envelope});
const read=s=>({transferId:s.transferId,sha256:s.sha256});
const mcp=(env,ctx,method,params={})=>worker.fetch(new Request('https://go-together.pureekangraw.workers.dev/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),{ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',...env},ctx);
test('owner authentication precedes typed transfer binding; tools list preserves legacy tools',async()=>{
 const s=snapshot(),f=fixture(()=>ok(s));
 const params={name:'goview_transfer_read',arguments:read(s)};
 assert.equal((await mcp(f.env,{},'tools/call',params)).status,401);assert.equal(f.calls.length,0);
 assert.equal((await mcp(f.env,owner,'tools/call',params)).status,200);assert.equal(f.calls.length,1);
 const listed=await (await mcp(f.env,owner,'tools/list')).json();
 for(const name of ['goview_publish','goview_readback','goview_focus_point','goview_propose_pin','goview_command_status','goview_transfer_read','goview_transfer_publish','goview_transfer_receipt'])assert.ok(listed.result.tools.find(t=>t.name===name));
 const schema=listed.result.tools.find(t=>t.name==='goview_transfer_publish').inputSchema;
 assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,['envelope']);
});
test('read independently validates digest and minimization, preserves original payload bytes',async()=>{
 const s=snapshot(),f=fixture(()=>({...ok(s),privateExtra:'PRIVATE'}));
 assert.deepEqual((await goviewDirect(f.env,'goview_transfer_read',read(s))).envelope,s);
 for(const mutate of [e=>e.sha256='0'.repeat(64),e=>e.transferId='different-transfer',e=>e.extra='PRIVATE',e=>{const p=JSON.parse(e.payload);p.gps={latitude:1};e.payload=JSON.stringify(p);e.sha256=hash(e.payload)},e=>{const p=JSON.parse(e.payload);p.features[0].properties.goviewRecord.note='PRIVATE';e.payload=JSON.stringify(p);e.sha256=hash(e.payload)}]){
  const bad=structuredClone(s);mutate(bad);
  const result=await goviewDirect(fixture(()=>ok(bad)).env,'goview_transfer_read',read(s));assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
});
test('malformed or broad arguments fail before binding and GO cannot upload snapshots',async()=>{
 const s=snapshot(),f=fixture(()=>ok(s));
 for(const a of [{},{transferId:s.transferId},{...read(s),list:true},{...read(s),transferId:['synthetic']},{...read(s),sha256:'A'.repeat(64)}])assert.equal((await goviewDirect(f.env,'goview_transfer_read',a)).ok,false);
 assert.equal((await goviewDirect(f.env,'goview_transfer_receipt',{transferId:s.transferId,all:true})).ok,false);
 assert.equal((await goviewDirect(f.env,'goview_transfer_publish',{envelope:s})).status,'DEVICE_UPLOAD_ROLE_REQUIRED');
 const p=proposal();for(const e of [{...p,extra:true},{...p,payload:'x'.repeat(1048577)},{...p,sha256:'0'.repeat(64)}])assert.equal((await goviewDirect(f.env,'goview_transfer_publish',{envelope:e})).ok,false);
 assert.equal(f.calls.length,0);
});
test('proposal preflight binds source digest/revision before one immutable publish',async()=>{
 const s=snapshot(),p=proposal(s),f=fixture(name=>ok(name==='goview_transfer_read'?s:p));
 const result=await goviewDirect(f.env,'goview_transfer_publish',{envelope:p});
 assert.equal(result.ok,true);assert.equal(result.androidStatus,'NOT_OBSERVED_OWNER_APPROVAL_REQUIRED');assert.deepEqual(result.envelope,p);
 assert.deepEqual(f.calls.map(x=>x.name),['goview_transfer_read','goview_transfer_publish']);assert.deepEqual(f.calls[0].args,read(s));
 const wrong=structuredClone(s),doc=JSON.parse(wrong.payload);wrong.identity.baseVersion=4;doc.goview.version=4;doc.captureReceipt.version=4;wrong.payload=JSON.stringify(doc);wrong.sha256=hash(wrong.payload);
 const basedOnWrongHash=structuredClone(p);basedOnWrongHash.identity.snapshotSha256=wrong.sha256;
 const g=fixture(()=>ok(wrong));assert.equal((await goviewDirect(g.env,'goview_transfer_publish',{envelope:basedOnWrongHash})).status,'SNAPSHOT_BASE_MISMATCH');assert.equal(g.calls.length,1);
 const badDigest=proposal(s);badDigest.identity.snapshotSha256='0'.repeat(64);
 const h=fixture(()=>ok(s));assert.equal((await goviewDirect(h.env,'goview_transfer_publish',{envelope:badDigest})).status,'SNAPSHOT_BASE_MISMATCH');assert.equal(h.calls.length,1);
});
test('publish verifies every envelope field and original bytes; uncertainty never repeats mutation',async()=>{
 const p=studio();
 for(const handler of [()=>{throw Error('PRIVATE')},()=>({ok:true}),()=>ok({...p,transferId:'different-transfer'}),()=>ok({...p,payload:p.payload.trim(),sha256:hash(p.payload.trim())}),()=>({ok:false,status:'TRANSFER_PUT_REJECTED_OR_UNCERTAIN',httpStatus:503})]){
  const f=fixture(handler),r=await goviewDirect(f.env,'goview_transfer_publish',{envelope:p});
  assert.equal(r.ok,false);assert.equal(r.readbackRequired,true);assert.equal(r.transferId,p.transferId);assert.equal(r.sha256,p.sha256);assert.equal(f.calls.length,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
 }
});
test('Studio stays separate, validates its codec and identity, and preserves exact trailing newline',async()=>{
 const s=studio(),f=fixture(()=>ok(s));assert.equal((await goviewDirect(f.env,'goview_transfer_publish',{envelope:s})).envelope.payload,s.payload);
 assert.deepEqual(f.calls.map(x=>x.name),['goview_transfer_publish']);
 const bad=structuredClone(s),p=JSON.parse(bad.payload);p.map.roads[0].to='missing';bad.payload=JSON.stringify(p);bad.sha256=hash(bad.payload);
 const g=fixture(()=>ok(bad));assert.equal((await goviewDirect(g.env,'goview_transfer_publish',{envelope:bad})).ok,false);assert.equal(g.calls.length,0);
});
test('receipt is a validated device report, never independently verified or inferred from missing',async()=>{
 const r=receipt();
 for(const status of ['SAVED','DUPLICATE','COMMITTED_READBACK_UNAVAILABLE']){
  const value={...r,status,readbackVerified:status!=='COMMITTED_READBACK_UNAVAILABLE'};
  const f=fixture(()=>({ok:true,receipt:value,independentlyVerified:true}));
  const out=await goviewDirect(f.env,'goview_transfer_receipt',{transferId:r.transferId});assert.equal(out.ok,true);assert.equal(out.independentlyVerified,false);assert.equal(out.status,'DEVICE_REPORTED_RECEIPT');
 }
 for(const bad of [{...r,transferId:'other-transfer'},{...r,readbackVerified:false},{...r,extra:'PRIVATE'},{...r,revision:'4'}])assert.equal((await goviewDirect(fixture(()=>({ok:true,receipt:bad})).env,'goview_transfer_receipt',{transferId:r.transferId})).ok,false);
 const missing=await goviewDirect(fixture(()=>({ok:false,status:'NOT_OBSERVED',httpStatus:404})).env,'goview_transfer_receipt',{transferId:r.transferId});assert.equal(missing.status,'NOT_OBSERVED');assert.equal(missing.ok,false);
});
test('missing binding and provider rejection remain explicit and sanitized',async()=>{
 const s=snapshot();assert.equal((await goviewDirect({},'goview_transfer_read',read(s))).status,'GOVIEW_BINDING_NOT_CONFIGURED');
 const result=await goviewDirect(fixture(()=>({ok:false,status:'PRIVATE_TOKEN',payload:'PRIVATE'})).env,'goview_transfer_read',read(s));assert.equal(result.status,'TRANSFER_UPSTREAM_REJECTED');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});

test('publish rejects changed snapshot identity even when payload bytes and digest are unchanged',async()=>{
 const s=snapshot(),p=proposal(s),other={...p,identity:{...p.identity,snapshotSha256:'a'.repeat(64)}};
 const f=fixture(name=>ok(name==='goview_transfer_read'?s:other));
 const result=await goviewDirect(f.env,'goview_transfer_publish',{envelope:p});
 assert.equal(result.ok,false);assert.equal(result.readbackRequired,true);
 assert.equal(result.transferId,p.transferId);assert.equal(result.sha256,p.sha256);
 assert.deepEqual(f.calls.map(x=>x.name),['goview_transfer_read','goview_transfer_publish']);
});
