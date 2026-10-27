import test from 'node:test';
import assert from 'node:assert/strict';
import {hubTool} from '../worker/hub-client.mjs';
import {factoryDirectJobStatus,factoryDirectReadback,factoryDirectArtifact} from '../worker/factory-direct.mjs';
const requestId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',jobId='GOJOB-'+'a'.repeat(32);
const receiptId='receipt-11111111-2222-4333-8444-555555555555',sourceSha='b'.repeat(40);
const artifactRef='r2://factory/edge-results/'+jobId+'/CP-'+jobId+'/run/render.png';
function receipt(overrides={}){return {receiptId,workId:jobId,checkpointId:'CP-'+jobId,originSystem:'go-together',actingActor:'GO',authorizationSource:'WORK_PASS',stationId:'FACTORY-STATION',sourceSha,domainVerified:false,domainCompleted:false,...overrides};}
test('repeated read-only status bypasses relay dedup cache but mutation identity stays stable',async()=>{
  const cache=new Map(),calls=[];let current='UNKNOWN';
  const env={HUB_V2:{async relay(input){
    calls.push(input);if(!cache.has(input.messageId))cache.set(input.messageId,{receipt:{state:'RESPONDED'},response:{body:JSON.stringify({result:{content:[{text:JSON.stringify({jobStatus:current})}]}})}});
    return cache.get(input.messageId);
  }}};
  const first=await hubTool(env,'factory_direct_job_status',{requestId});current='COMPLETED';
  const next=await hubTool(env,'factory_direct_job_status',{requestId});
  assert.equal(first.jobStatus,'UNKNOWN');assert.equal(next.jobStatus,'COMPLETED');
  assert.notEqual(calls[0].messageId,calls[1].messageId);
  await hubTool(env,'factory_direct_submit',{requestId});await hubTool(env,'factory_direct_submit',{requestId});
  assert.equal(calls[2].messageId,calls[3].messageId);
});
for(const jobStatus of ['IN_PROGRESS','UNKNOWN','FAILED'])test('job status preserves '+jobStatus+' without execution',async()=>{
  const seen=[];const back=jobStatus==='FAILED'?receipt({status:'FAILED',reason:'EDGE_BROWSER_RENDER_FAILED'}):{reason:'RECEIPT_NOT_FOUND'};
  const env={GO_FACTORY_RAIL_SECRET:'e'.repeat(64),FACTORY_DIRECT:{async fetch(req){
    const path=new URL(req.url).pathname;seen.push(path);
    if(path==='/station/go-job-status')return Response.json({status:jobStatus,requestId,jobId,receiptId,reason:jobStatus==='IN_PROGRESS'?'EXECUTION_ACTIVE_IN_THIS_ISOLATE':'EDGE_BROWSER_RENDER_FAILED',readback:back,executed:false});
    if(path==='/station/readback/'+receiptId)return Response.json(back,{status:jobStatus==='FAILED'?200:404});
    throw Error('Execution is forbidden');
  }}};
  const value=await factoryDirectJobStatus(env,{requestId});
  assert.equal(value.jobStatus,jobStatus);assert.equal(value.verified,false);assert.equal(value.executed,false);assert.equal(value.readOnly,true);
  if(jobStatus==='FAILED')assert.equal(value.reason,'EDGE_BROWSER_RENDER_FAILED');
  assert.ok(!seen.includes('/station/go-job'));
});
test('receipt manifest survives readback and rejects artifact bytes that disagree',async()=>{
  const bytes=new Uint8Array([1,2,3]),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const manifest={ref:artifactRef,sha256:'0'.repeat(64),bytes:3,width:640,height:360};
  const env={GO_FACTORY_RAIL_SECRET:'e'.repeat(64),FACTORY_DIRECT:{async fetch(req){
    if(new URL(req.url).pathname==='/station/readback/'+receiptId)return Response.json(receipt({domainVerified:true,domainCompleted:true,result:{ownerDomain:'VISUAL',artifactRefs:[artifactRef],artifacts:[manifest],evidenceRefs:[]}}));
    return new Response(bytes,{headers:{'content-type':'image/png','x-factory-artifact-sha256':hash,'x-factory-receipt-id':receiptId,'x-factory-source-sha':sourceSha}});
  }}};
  assert.deepEqual((await factoryDirectReadback(env,{receiptId})).artifacts,[manifest]);
  const value=await factoryDirectArtifact(env,{receiptId,artifactRef});
  assert.equal(value.status,'ARTIFACT_INTEGRITY_MISMATCH');assert.equal(value.ok,false);
});
