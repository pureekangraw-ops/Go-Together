import test from 'node:test';
import assert from 'node:assert/strict';
import {readOwnerDashboard} from '../worker/owner-control.mjs';

test('private owner snapshot reads existing approvals and never dispatches work',async()=>{
 const sqls=[];const id='187e2e08-52f6-4cf6-afec-5baa663446d1';
 const row={id,request_id:'8e4a56a9-9144-4c40-a848-e8ae8830ae41',domain:'VISUAL',status:'PENDING',
  payload_json:'{"secret":"DO_NOT_EXPOSE"}',payload_sha256:'a'.repeat(64),created_by:'owner',created_at:'2026-10-27',updated_at:'2026-10-27'};
 const env={CF_VERSION_METADATA:{id:'runtime-version'},DB:{prepare(sql){sqls.push(sql);assert.match(sql,/^SELECT/);return {
  bind(){return this;},first:async()=>({healthy:1}),all:async()=>({results:sql.includes('factory_approval_events')?[
   {approval_id:id,action:'PROPOSED',actor:'owner',event_at:'2026-10-27',details_json:JSON.stringify({requestId:row.request_id,secret:'HIDDEN'})}
  ]:sql.includes("status='PENDING'")?[row]:[]})};}},
  FACTORY_DIRECT:{fetch:async req=>{assert.equal(req.method,'GET');assert.equal(new URL(req.url).pathname,'/health');return Response.json({service:'factory-district',stationId:'FACTORY-STATION',status:'READY',sourceSha:'a'.repeat(40),machinery:{CODE:{status:'READY'}}});}},
  OBSERVATORY_GO:{invoke:async(name,args)=>{assert.equal(name,'observatory_session');assert.deepEqual(args,{});return {ok:true,status:'OWNER_HAS_NOT_INVITED_GO',token:'HIDDEN'};}}
 };
 const out=await readOwnerDashboard(env);
 assert.equal(out.version.id,'runtime-version');assert.equal(out.factory.approvals[0].id,id);
 assert.equal(out.factory.approvals[0].status,'PENDING');assert.equal(out.factory.approvals[0].receiptId,null);
 assert.equal(out.systems.find(x=>x.id==='go').status,'READY');
 assert.equal(out.systems.find(x=>x.id==='factory').status,'CONNECTED');
 assert.equal(out.systems.find(x=>x.id==='goview').status,'UNKNOWN');
 assert.equal(out.goAudit[0].actor,'owner');assert.equal(out.goAudit[0].requestId,row.request_id);
 assert.ok(!JSON.stringify(out).includes('HIDDEN'));assert.ok(!JSON.stringify(out).includes('DO_NOT_EXPOSE'));
 assert.ok(sqls.every(s=>s.startsWith('SELECT')));
});
test('unavailable sources remain explicit gaps; one failure does not erase other source state',async()=>{
 const out=await readOwnerDashboard({});
 assert.equal(out.systems.find(x=>x.id==='go').status,'ERROR');
 assert.equal(out.systems.find(x=>x.id==='factory').status,'UNKNOWN');
 assert.equal(out.factory.approvalsAvailable,false);assert.equal(out.version.id,null);
 assert.ok(out.gaps.length);assert.deepEqual(out.factory.approvals,[]);
});
