import test from 'node:test';
import assert from 'node:assert/strict';
import {factoryDirectJobStatus,factoryDirectSubmit} from '../worker/factory-direct.mjs';
const SHA='a'.repeat(40),KEY='synthetic-queue-rail-key-0123456789abcdef',requestId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',jobId='GOJOB-'+'b'.repeat(32),receiptId='receipt-11111111-2222-4333-8444-555555555555';
const metadata={executor:'FACTORY_VISUAL_QUEUE_V1',domain:'VISUAL',requestId,jobId,sourceSha:SHA,admittedAt:1000000,deadlineAt:1300000,executed:false};
function fixture(response,rawObservedAt=new Date(1190000).toISOString()){
 const paths=[];
 const env={GO_FACTORY_RAIL_SECRET:KEY,FACTORY_DIRECT:{async fetch(req){
  const path=new URL(req.url).pathname;paths.push(path);
  if(path==='/health')return Response.json({service:'factory-district',stationId:'FACTORY-STATION',sourceSha:SHA,status:'READY',storage:{status:'READY'},transport:{status:'READY'},machinery:{VISUAL:{status:'READY'}}});
  if(path==='/station/go-auth-probe'){
   const body=await req.json(),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const proof=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body.purpose+'\n'+body.nonce+'\n'+SHA+'\nFACTORY-STATION'))).toString('hex');
   return Response.json({status:'AUTHENTICATED',service:'factory-district',stationId:'FACTORY-STATION',sourceSha:SHA,nonce:body.nonce,readOnly:true,executed:false,proof});
  }
  if(path.startsWith('/station/readback/'))return Response.json({receiptId,observedAt:rawObservedAt,workId:jobId,checkpointId:'CP-'+jobId,originSystem:'go-together',actingActor:'GO',authorizationSource:'WORK_PASS',stationId:'FACTORY-STATION',sourceSha:SHA,domainCompleted:true,domainVerified:true,result:{ownerDomain:'VISUAL',artifactRefs:[]}});
  return Response.json(response,{status:path==='/station/go-job'?202:200});
 }}};
 return {env,paths};
}
test('queued admission is acknowledged without inventing completion or Receipt',async()=>{
 const f=fixture({...metadata,status:'ACCEPTED'}),r=await factoryDirectSubmit(f.env,{requestId,domain:'VISUAL',spec:{}},true);
 assert.equal(r.ok,true);assert.equal(r.status,'VISUAL_JOB_ACCEPTED');assert.equal(r.verified,false);assert.equal(r.executed,false);assert.equal(r.receiptId,null);assert.equal(r.requestId,requestId);
 assert.equal(f.paths.some(p=>p.startsWith('/station/readback/')),false);
});
for(const status of ['ACCEPTED','IN_PROGRESS','UNKNOWN'])test('queued '+status+' remains read-only and never promotes a raw late Receipt',async()=>{
 const f=fixture({...metadata,status,receiptId,reason:'VISUAL_DEADLINE_UNPROVEN'}),r=await factoryDirectJobStatus(f.env,{requestId});
 assert.equal(r.ok,true);assert.equal(r.jobStatus,status);assert.equal(r.verified,false);assert.equal(r.executed,false);assert.equal(r.readOnly,true);
 assert.equal(f.paths.length,1);
});
test('queued completion needs bounded settlement and independent matching Receipt',async()=>{
 const good=await factoryDirectJobStatus(fixture({...metadata,status:'COMPLETED',receiptId,settledAt:1200000,receiptObservedAt:1190000}).env,{requestId});assert.equal(good.verified,true);assert.equal(good.executor,metadata.executor);
 for(const change of [{settledAt:1300001},{settledAt:999999},{deadlineAt:1400000},{sourceSha:'invalid'},{domain:'CODE'},{status:'FAILED'},{receiptObservedAt:1300001},{executor:'FACTORY_VISUAL_QUEUE_V2'}]){
  const r=await factoryDirectJobStatus(fixture({...metadata,status:'COMPLETED',receiptId,settledAt:1200000,receiptObservedAt:1190000,...change}).env,{requestId});assert.equal(r.verified,false,JSON.stringify(change));assert.notEqual(r.jobStatus,'COMPLETED');
 }
});
test('queued admission rejects mismatched source and domain',async()=>{
 for(const change of [{sourceSha:'c'.repeat(40)},{domain:'CODE'},{deadlineAt:1300001}]){
  assert.equal((await factoryDirectSubmit(fixture({...metadata,status:'ACCEPTED',...change}).env,{requestId,domain:'VISUAL',spec:{}},true)).ok,false);
 }
});

test('queue proof timestamp must match independently fetched durable Receipt',async()=>{
 for(const observedAt of [undefined,'invalid',new Date(1300001).toISOString(),new Date(1180000).toISOString()]){
  const f=fixture({...metadata,status:'COMPLETED',receiptId,settledAt:1200000,receiptObservedAt:1190000},observedAt===undefined?null:observedAt);
  const r=await factoryDirectJobStatus(f.env,{requestId});assert.equal(r.verified,false);assert.equal(r.jobStatus,'UNKNOWN');
 }
});
test('duplicate queued completion cannot bypass settlement checks through synchronous submit',async()=>{
 for(const change of [{},{settledAt:1300001},{receiptObservedAt:1300001}]){
  const f=fixture({...metadata,status:'COMPLETED',receiptId,...change});
  const r=await factoryDirectSubmit(f.env,{requestId,domain:'VISUAL',spec:{}},true);
  assert.equal(r.status,'GO_QUEUE_READBACK_REQUIRED');assert.equal(r.verified,false);assert.equal(r.executed,false);assert.equal(r.jobStatus,'UNKNOWN');
  assert.equal(f.paths.some(p=>p.startsWith('/station/readback/')),false);
 }
});
