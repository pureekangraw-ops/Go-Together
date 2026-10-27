import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
  FactoryApprovalError,createFactoryApproval,getFactoryApproval,listFactoryApprovals,
  approveFactoryApproval,rejectFactoryApproval,reconcileFactoryApproval
} from '../worker/factory-approvals.mjs';

class Statement {
  constructor(statement){this.statement=statement;this.args=[];}
  bind(...args){this.args=args;return this;}
  async first(){return this.statement.get(...this.args)||null;}
  async all(){return {results:this.statement.all(...this.args)};}
  async run(){return this.statement.run(...this.args);}
}
class D1 {
  constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../migrations/0002_factory_approvals.sql',import.meta.url),'utf8'));}
  prepare(sql){return new Statement(this.db.prepare(sql));}
}
const ACTOR='pureekangraw@gmail.com';
const REQUEST='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SPEC={baseSource:'export default "before"',patch:{find:'before',replace:'after'},tests:[{path:'/',status:200,body:'after'}]};
const sha=/^[a-f0-9]{64}$/;
async function propose(db,overrides={}){
  return createFactoryApproval(db,{domain:'CODE',spec:SPEC,requestId:REQUEST,createdBy:ACTOR,...overrides});
}
test('proposal persists exact immutable payload and does not execute',async()=>{
  const db=new D1();let executed=0;
  const proposal=await propose(db);
  assert.equal(proposal.status,'PENDING');assert.equal(proposal.requestId,REQUEST);
  assert.match(proposal.payloadSha256,sha);assert.deepEqual(proposal.payload.spec,SPEC);
  assert.equal(executed,0);
  const events=db.db.prepare('SELECT action,actor,payload_sha256 FROM factory_approval_events WHERE approval_id=?').all(proposal.id);
  assert.deepEqual(events.map(x=>x.action),['PROPOSED']);assert.equal(events[0].actor,ACTOR);
  assert.equal((await listFactoryApprovals(db)).length,1);
});
test('identical proposal request IDs are idempotent; changed payload conflicts',async()=>{
  const db=new D1(),one=await propose(db),two=await propose(db);
  assert.equal(two.id,one.id);
  await assert.rejects(()=>propose(db,{spec:{...SPEC,patch:{find:'before',replace:'danger'}}}),
    e=>e instanceof FactoryApprovalError&&e.code==='REQUEST_ID_PAYLOAD_CONFLICT');
});
test('owner click binds to payload hash, stamps actor/time, then dispatches exactly once',async()=>{
  const db=new D1(),proposal=await propose(db);let dispatches=0;
  await assert.rejects(()=>approveFactoryApproval(db,{id:proposal.id,payloadSha256:'0'.repeat(64),actor:ACTOR,dispatch:async()=>{dispatches++;}}),
    e=>e instanceof FactoryApprovalError&&e.code==='APPROVAL_PAYLOAD_CHANGED');
  assert.equal(dispatches,0);
  const out=await approveFactoryApproval(db,{id:proposal.id,payloadSha256:proposal.payloadSha256,actor:ACTOR,
    now:'2026-10-27T10:00:00.000Z',dispatch:async payload=>{dispatches++;assert.equal(payload.requestId,REQUEST);return {ok:true,status:'GO_FACTORY_DELIVERABLE_READY',executed:true,artifact:{base64:'private-bytes',sha256:'a'.repeat(64)}};}});
  assert.equal(dispatches,1);assert.equal(out.approval.status,'COMPLETED');
  assert.equal(out.approval.approvedBy,ACTOR);assert.equal(out.approval.approvedAt,'2026-10-27T10:00:00.000Z');
  assert.equal(out.approval.approvedPayloadSha256,proposal.payloadSha256);
  assert.equal(out.approval.result.artifact.base64,undefined);
  const events=db.db.prepare('SELECT action,actor FROM factory_approval_events WHERE approval_id=? ORDER BY id').all(proposal.id);
  assert.deepEqual(events.map(x=>x.action),['PROPOSED','DISPATCHING','COMPLETED']);
  await assert.rejects(()=>approveFactoryApproval(db,{id:proposal.id,payloadSha256:proposal.payloadSha256,actor:ACTOR,dispatch:async()=>{dispatches++;}}),
    e=>e instanceof FactoryApprovalError&&e.code==='APPROVAL_NOT_PENDING');
  assert.equal(dispatches,1);
});
test('concurrent approval clicks cannot start a duplicate Factory job',async()=>{
  const db=new D1(),proposal=await propose(db);let dispatches=0;
  const args={id:proposal.id,payloadSha256:proposal.payloadSha256,actor:ACTOR,dispatch:async()=>{dispatches++;await new Promise(r=>setTimeout(r,10));return {ok:true,status:'GO_FACTORY_DELIVERABLE_READY',executed:true};}};
  const results=await Promise.allSettled([approveFactoryApproval(db,args),approveFactoryApproval(db,args)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.equal(dispatches,1);
});
test('reject closes the proposal and it can never dispatch',async()=>{
  const db=new D1(),proposal=await propose(db);
  const rejected=await rejectFactoryApproval(db,{id:proposal.id,payloadSha256:proposal.payloadSha256,actor:ACTOR});
  assert.equal(rejected.status,'REJECTED');assert.equal(rejected.rejectedBy,ACTOR);
  await assert.rejects(()=>approveFactoryApproval(db,{id:proposal.id,payloadSha256:proposal.payloadSha256,actor:ACTOR,dispatch:async()=>assert.fail('must not dispatch')}),
    e=>e instanceof FactoryApprovalError&&e.code==='APPROVAL_NOT_PENDING');
});
test('ambiguous dispatch is recorded UNKNOWN and reconciliation is read-only',async()=>{
  const db=new D1(),proposal=await propose(db);let submissions=0,reads=0;
  const dispatched=await approveFactoryApproval(db,{id:proposal.id,payloadSha256:proposal.payloadSha256,actor:ACTOR,
    dispatch:async()=>{submissions++;return {ok:false,status:'GO_JOB_TRANSPORT_UNCERTAIN',requestId:REQUEST};}});
  assert.equal(dispatched.approval.status,'UNKNOWN');
  const read=await reconcileFactoryApproval(db,{id:proposal.id,statusReader:async id=>{reads++;assert.equal(id,REQUEST);return {ok:true,status:'GO_JOB_STATUS_READ',jobStatus:'COMPLETED',verified:true};}});
  assert.equal(read.status,'COMPLETED');assert.equal(reads,1);assert.equal(submissions,1);
});
test('known pre-dispatch failure is explicit and does not become a blind retry',async()=>{
  const db=new D1(),proposal=await propose(db);let submissions=0;
  const out=await approveFactoryApproval(db,{id:proposal.id,payloadSha256:proposal.payloadSha256,actor:ACTOR,
    dispatch:async()=>{submissions++;return {ok:false,status:'FACTORY_NOT_READY',executed:false};}});
  assert.equal(out.approval.status,'FAILED_NO_EXECUTION');assert.equal(submissions,1);
  await assert.rejects(()=>approveFactoryApproval(db,{id:proposal.id,payloadSha256:proposal.payloadSha256,actor:ACTOR,dispatch:async()=>{submissions++;}}),
    e=>e instanceof FactoryApprovalError&&e.code==='APPROVAL_NOT_PENDING');
  assert.equal(submissions,1);
});
test('proposal validates domain, request ID and CODE-only GitHub handoff',async()=>{
  const db=new D1();
  await assert.rejects(()=>propose(db,{domain:'UNKNOWN'}),e=>e.code==='FACTORY_PROPOSAL_INVALID');
  await assert.rejects(()=>propose(db,{requestId:'not-a-uuid'}),e=>e.code==='GO_REQUEST_ID_INVALID');
  await assert.rejects(()=>propose(db,{domain:'VISUAL',githubDelivery:{repo:'owner/repo',baseSha:'a'.repeat(40),filePath:'src/a.js'}}),
    e=>e.code==='FACTORY_GITHUB_DELIVERY_INVALID');
  await assert.rejects(()=>propose(db,{requestId:'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee',githubDelivery:{repo:'owner/repo',baseSha:'bad',filePath:'src/../main.js'}}),
    e=>e.code==='FACTORY_GITHUB_DELIVERY_INVALID');
  await assert.rejects(()=>propose(db,{requestId:'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',spec:{workshop:{password:'do-not-store'}}}),
    e=>e.code==='SENSITIVE_INPUT_NOT_ALLOWED');
});
