import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {factoryDirectSubmit} from '../worker/factory-direct.mjs';
const secret='FACTORY-TEST-RAIL-SECRET-ABCDEFGHIJK-12345678901234';
const sourceSha='a'.repeat(40),jobId='GOJOB-'+'b'.repeat(32);
const requestId='123e4567-e89b-42d3-a456-426614174000';
const receiptId='receipt-123e4567-e89b-42d3-a456-426614174011';
const pngSha='e'.repeat(64),zipSha='f'.repeat(64);
const sourceRef='r2://factory/edge-source/go/'+pngSha+'.png#sha256='+pngSha;
const prefix='r2://factory/edge-results/'+jobId+'/CP-'+jobId+'/run-123';
const ref=prefix+'/split-manifest.json',one=prefix+'/ONE.png',zip=prefix+'/visual-cutouts.zip';
const sha=b=>createHash('sha256').update(b).digest('hex');
const back={receiptId,workId:jobId,checkpointId:'CP-'+jobId,
 originSystem:'go-together',actingActor:'GO',authorizationSource:'WORK_PASS',
 stationId:'FACTORY-STATION',sourceSha,domainVerified:true,domainCompleted:true,
 result:{ownerDomain:'VISUAL',artifactRefs:[ref,one,zip],evidenceRefs:[]}};
const spec={imageSplit:{sourceRef,count:1,columns:1,canvas:256,names:['ONE']}};
function makeEnv({corrupt=false}={}){
 const manifest={schema:'FACTORY_VISUAL_SPLIT_MANIFEST_V1',
  count:1,canvas:256,sourceSha256:pngSha,
  files:[{name:'ONE',ref:one,sha256:'d'.repeat(64),bytes:2468}],
  zipRef:zip,zipSha256:zipSha,archiveBytes:2470};
 if(corrupt)manifest.files[0].name='WRONG';
 return {GO_FACTORY_RAIL_SECRET:secret,FACTORY_DIRECT:{fetch:async req=>{
  const path=new URL(req.url).pathname;
  const body=req.method==='GET'?'':await req.text();
  if(path==='/health')return Response.json({service:'factory-district',stationId:'FACTORY-STATION',
   status:'READY',sourceSha,storage:{status:'READY'},transport:{status:'READY'},
   machinery:{CODE:{status:'READY'},VISUAL:{status:'READY',intents:['STATIC_CARD_V1','ALPHA_CUTOUT_V1']},LOGIC:{status:'READY'}}});
  const timestamp=req.headers.get('x-metropolis-factory-timestamp');
  const signature=createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
  assert.equal(req.headers.get('x-metropolis-factory-signature'),signature);
  if(path==='/station/go-auth-probe'){
   const arg=JSON.parse(body);
   const proof=createHmac('sha256',secret).update(arg.purpose+'\n'+arg.nonce+'\n'+sourceSha+'\nFACTORY-STATION').digest('hex');
   return Response.json({service:'factory-district',stationId:'FACTORY-STATION',
    status:'AUTHENTICATED',nonce:arg.nonce,sourceSha,proof,readOnly:true,executed:false});
  }
  if(path==='/station/go-job')return Response.json({status:'COMPLETED',requestId,jobId,receiptId,
   domain:'VISUAL',sourceSha,readback:back});
  if(path==='/station/readback/'+receiptId)return Response.json(back);
  if(path==='/station/go-artifact'){
   const args=JSON.parse(body);
   assert.equal(args.artifactRef,ref);
   const bytes=Buffer.from(JSON.stringify(manifest));
   return new Response(bytes,{headers:{'content-type':'application/octet-stream',
    'x-factory-artifact-sha256':sha(bytes),
    'x-factory-receipt-id':receiptId,'x-factory-source-sha':sourceSha}});
  }
  throw Error('unexpected route '+path);
 }}};
}
test('owner Factory split job checks manifest against full receipt and delivers ZIP ref',async()=>{
 const result=await factoryDirectSubmit(makeEnv(),{domain:'VISUAL',spec,requestId},true);
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.status,'GO_FACTORY_IMAGE_PACK_READY');
 assert.equal(result.files.length,1);assert.equal(result.files[0].name,'ONE');
 assert.equal(result.zipRef,zip);assert.equal(result.zipSha256,zipSha);
 assert.equal(result.receiptId,receiptId);assert.equal(result.executed,true);
});
test('GO rejects split job with manifest not matching approved filenames',async()=>{
 const result=await factoryDirectSubmit(makeEnv({corrupt:true}),{domain:'VISUAL',spec,requestId},true);
 assert.equal(result.ok,false);
 assert.equal(result.status,'GO_IMAGE_MANIFEST_UNVERIFIED');
});
