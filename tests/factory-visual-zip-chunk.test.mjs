import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {factoryVisualZipChunk} from '../worker/factory-direct.mjs';
const key='FACTORY-LOCAL-GO-RAIL-SECRET-ABCDEFGHIJKLMN-0123456789';
const id='receipt-123e4567-e89b-42d3-a456-426614174000';
const job='GOJOB-'+'a'.repeat(32);
const ref='r2://factory/edge-results/'+job+'/CP-'+job+'/run1/visual-cutouts.zip';
const data=Buffer.from('PK\x03\x04fakezip-small-but-consistent');
const sha=x=>createHash('sha256').update(x).digest('hex');
const fileSha=sha(data);
function fake(){
 const env={GO_FACTORY_RAIL_SECRET:key,FACTORY_DIRECT:{fetch:async req=>{
  const path=new URL(req.url).pathname,body=req.method==='GET'?'':await req.text();
  const sign=createHmac('sha256',key)
   .update(req.headers.get('x-metropolis-factory-timestamp')+'.'+body).digest('hex');
  assert.equal(req.headers.get('x-metropolis-factory-signature'),sign);
  if(path==='/station/readback/'+id)return Response.json({
   receiptId:id,workId:job,checkpointId:'CP-'+job,originSystem:'go-together',
   actingActor:'GO',authorizationSource:'WORK_PASS',stationId:'FACTORY-STATION',
   sourceSha:'a'.repeat(40),domainCompleted:true,domainVerified:true,
   result:{ownerDomain:'VISUAL',artifactRefs:[ref]}});
  if(path==='/station/go-artifact-chunk'){
   const {offset,length}=JSON.parse(body),chunk=data.subarray(offset,offset+length);
   return Response.json({status:'ZIP_CHUNK_READ',receiptId:id,artifactRef:ref,
    offset,length:chunk.length,total:data.length,nextOffset:offset+chunk.length,
    complete:offset+chunk.length===data.length,fileSha256:fileSha,
    chunkSha256:sha(chunk),base64:chunk.toString('base64'),executed:false,readOnly:true});
  }
  throw Error('unexpected route');
 }}};
 return env;
}
test('GO checks exact ZIP digest and chunk bytes against receipt',async()=>{
 const resp=await factoryVisualZipChunk(fake(),{receiptId:id,artifactRef:ref,offset:0,length:9,expectedSha256:fileSha});
 assert.equal(resp.ok,true);assert.equal(resp.length,9);assert.equal(resp.total,data.length);
 assert.equal(sha(Buffer.from(resp.base64,'base64')),resp.chunkSha256);
 const remainder=await factoryVisualZipChunk(fake(),{receiptId:id,artifactRef:ref,offset:9,
  length:262144,expectedSha256:fileSha});
 assert.equal(remainder.complete,true);
 assert.equal(Buffer.concat([Buffer.from(resp.base64,'base64'),Buffer.from(remainder.base64,'base64')]).toString(),data.toString());
});
test('wrong expected hash, fake reference and oversized offset denied',async()=>{
 const env=fake();
 const mismatch=await factoryVisualZipChunk(env,{receiptId:id,artifactRef:ref,offset:0,length:9,expectedSha256:'f'.repeat(64)});
 assert.equal(mismatch.status,'GO_ZIP_CHUNK_READBACK_INVALID');
 const outsider=await factoryVisualZipChunk(env,{receiptId:id,artifactRef:'r2://factory/edge-results/other/job/run/visual-cutouts.zip',
  offset:0,length:5,expectedSha256:fileSha});
 assert.equal(outsider.status,'ZIP_NOT_IN_GO_RECEIPT');
 const huge=await factoryVisualZipChunk(env,{receiptId:id,artifactRef:ref,offset:0,length:300000,expectedSha256:fileSha});
 assert.equal(huge.status,'GO_ZIP_CHUNK_INPUT_INVALID');
});
