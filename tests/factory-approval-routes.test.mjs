import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from './hub-fixture.mjs';

const ROOT='https://go-together.pureekangraw.workers.dev';
const OWNER={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
const REQUEST='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SPEC={baseSource:'export default "before"',patch:{find:'before',replace:'after'},tests:[{path:'/',status:200,body:'after'}]};
class Statement{constructor(statement){this.statement=statement;this.args=[];}bind(...args){this.args=args;return this;}async first(){return this.statement.get(...this.args)||null;}async all(){return {results:this.statement.all(...this.args)};}async run(){return this.statement.run(...this.args);}}
class D1{constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../migrations/0002_factory_approvals.sql',import.meta.url),'utf8'));}prepare(sql){return new Statement(this.db.prepare(sql));}}
function setup(){
 const paths=[],DB=new D1();
 const env={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',DB,GO_FACTORY_RAIL_SECRET:'b'.repeat(64),
  FACTORY_DIRECT:{async fetch(req){const path=new URL(req.url).pathname;paths.push(path);
    if(path==='/health')return Response.json({service:'factory-district',stationId:'FACTORY-STATION',status:'NOT_READY',sourceSha:'a'.repeat(40),storage:{status:'READY'},transport:{status:'READY'},machinery:{CODE:{status:'READY'},VISUAL:{status:'READY'},LOGIC:{status:'READY'},PROOF:{status:'READY'}}});
    if(path==='/station/go-auth-probe')return new Response('{}',{status:401});
    throw Error('Unexpected Factory effect '+path);
  }}};
 return {env,paths};
}
async function mcp(env,name,args){
 const response=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env,OWNER);
 const body=await response.json(),text=body.result?.content?.[0]?.text;
 return {status:response.status,data:text?JSON.parse(text):body};
}
test('proposal tool persists a pending item without touching the Factory; legacy submit is gone',async()=>{
 const {env,paths}=setup();
 const staged=await mcp(env,'factory_direct_propose',{domain:'CODE',spec:SPEC,requestId:REQUEST});
 assert.equal(staged.data.status,'PENDING_OWNER_APPROVAL');assert.equal(staged.data.executionStarted,false);
 assert.ok(staged.data.workId);assert.ok(staged.data.checkpointId);
 assert.match(staged.data.payloadSha256,/^[a-f0-9]{64}$/);assert.equal(paths.length,0);
 const old=await mcp(env,'factory_direct_submit',{domain:'CODE',spec:SPEC,requestId:REQUEST,approved:true});
 assert.equal(old.data.error?.message,'unknown_tool');assert.equal(paths.length,0);
 const list=await worker.fetch(new Request(ROOT+'/api/factory-approvals'),env,OWNER);
 assert.equal(list.status,200);assert.equal((await list.json()).items[0].id,staged.data.approvalId);
});
test('only the owner same-origin click can dispatch, and stamp binds the exact hash',async()=>{
 const {env,paths}=setup();
 const staged=await mcp(env,'factory_direct_propose',{domain:'CODE',spec:SPEC,requestId:REQUEST});
 const id=staged.data.approvalId,hash=staged.data.payloadSha256;
 const wrong=await worker.fetch(new Request(`${ROOT}/api/factory-approvals/${id}/approve`,{method:'POST',headers:{'content-type':'application/json',origin:ROOT},body:JSON.stringify({payloadSha256:'0'.repeat(64)})}),env,OWNER);
 assert.equal(wrong.status,409);assert.equal(paths.length,0);
 const noOrigin=await worker.fetch(new Request(`${ROOT}/api/factory-approvals/${id}/approve`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({payloadSha256:hash})}),env,OWNER);
 assert.equal(noOrigin.status,403);assert.equal(paths.length,0);
 const approved=await worker.fetch(new Request(`${ROOT}/api/factory-approvals/${id}/approve`,{method:'POST',headers:{'content-type':'application/json',origin:ROOT},body:JSON.stringify({payloadSha256:hash})}),env,OWNER);
 assert.equal(approved.status,200);const out=await approved.json();
 assert.equal(out.approval.payload.workId,staged.data.workId);
 assert.equal(out.approval.payload.checkpointId,staged.data.checkpointId);
 assert.equal(out.approval.status,'FAILED_NO_EXECUTION');assert.equal(out.approval.approvedBy,'owner@example.com');
 assert.equal(out.approval.approvedPayloadSha256,hash);assert.ok(out.approval.approvedAt);
 assert.equal(out.result.status,'FACTORY_NOT_READY');assert.deepEqual(paths,['/health','/station/go-auth-probe']);assert.ok(!paths.includes('/station/go-job'));
 const trail=env.DB.db.prepare('SELECT action,actor FROM factory_approval_events WHERE approval_id=? ORDER BY id').all(id);
 assert.deepEqual(trail.map(x=>x.action),['PROPOSED','DISPATCHING','FAILED_NO_EXECUTION']);
 assert.ok(trail.slice(1).every(x=>x.actor==='owner@example.com'));
});
test('approval API refuses anonymous users',async()=>{
 const {env}=setup();
 const response=await worker.fetch(new Request(ROOT+'/api/factory-approvals'),env,{});
 assert.equal(response.status,401);
});
