import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {factoryDirectJobStatus} from '../worker/factory-direct.mjs';

const REQUEST='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const JOB='GOJOB-'+'b'.repeat(32);
const RID='receipt-11111111-2222-4333-8444-555555555555';
const SHA='a'.repeat(40),KEY='owner-zone2-factory-hmac-key-0123456789';
const ROOT='r2://factory/edge-results/'+JOB+'/CP-'+JOB+'/run-1/';
const digest=b=>createHash('sha256').update(b).digest('hex');
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):
 Array.isArray(x)?'['+x.map(canonical).join(',')+']':
 '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';

function fixture({domain='VISUAL',files={},resultFields={},jobStatus='COMPLETED',verified=true}={}) {
 const paths=[];
 const refs=Object.keys(files);
 const receipt={receiptId:RID,workId:JOB,checkpointId:'CP-'+JOB,
  stationId:'FACTORY-STATION',originSystem:'go-together',actingActor:'GO',
  authorizationSource:'WORK_PASS',sourceSha:SHA,domainCompleted:verified,
  domainVerified:verified,result:{ownerDomain:domain,artifactRefs:refs,evidenceRefs:[]},
  ...resultFields};
 const env={GO_FACTORY_RAIL_SECRET:KEY,FACTORY_DIRECT:{async fetch(req) {
  const path=new URL(req.url).pathname;
  paths.push(path);
  if(path==='/station/go-job-status')return Response.json({
    status:jobStatus,requestId:REQUEST,jobId:JOB,receiptId:RID
  });
  if(path==='/station/readback/'+RID)return Response.json(receipt);
  if(path==='/station/go-artifact'){
   const {receiptId,artifactRef}=await req.json();
   assert.equal(receiptId,RID);
   const file=files[artifactRef];
   if(!file) return new Response(null,{status:404});
   return new Response(file.bytes,{headers:{'content-type':file.mime,
     'x-factory-artifact-sha256':digest(file.bytes),
     'x-factory-receipt-id':RID,'x-factory-source-sha':SHA}});
  }
  throw Error('unexpected Factory route '+path);
 }}};
 return {env,paths};
}
test('one VISUAL status read returns verified PNG bytes and original receipt, never executes again',async()=>{
 const ref=ROOT+'render.png',bytes=Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3]);
 const f=fixture({files:{[ref]:{bytes,mime:'image/png'}}});
 const x=await factoryDirectJobStatus(f.env,{requestId:REQUEST});
 assert.equal(x.ok,true);assert.equal(x.verified,true);assert.equal(x.domain,'VISUAL');
 assert.equal(x.jobStatus,'COMPLETED');
 assert.equal(x.delivery.status,'VISUAL_PNG_READY');
 assert.equal(x.delivery.artifact.sha256,digest(bytes));
 assert.deepEqual(Buffer.from(x.delivery.artifact.base64,'base64'),Buffer.from(bytes));
 assert.deepEqual(f.paths,['/station/go-job-status','/station/readback/'+RID,
   '/station/readback/'+RID,'/station/go-artifact']);
 assert.equal(f.paths.includes('/station/go-job'),false);
});
test('one VISUAL status read returns verified image-pack refs without claiming ZIP bytes',async()=>{
 const ref=ROOT+'split-manifest.json',zipRef=ROOT+'visual-cutouts.zip',partRef=ROOT+'cutout-1.png';
 const manifest={schema:'FACTORY_VISUAL_SPLIT_MANIFEST_V1',count:1,
  files:[{name:'cutout-1',ref:partRef,sha256:'c'.repeat(64)}],
  zipRef,zipSha256:'d'.repeat(64),archiveBytes:123};
 const bytes=Buffer.from(JSON.stringify(manifest));
 const f=fixture({files:{[ref]:{bytes,mime:'application/json'},
  [zipRef]:{bytes:Buffer.from([1]),mime:'application/octet-stream'},
  [partRef]:{bytes:Buffer.from([2]),mime:'image/png'}}});
 const x=await factoryDirectJobStatus(f.env,{requestId:REQUEST});
 assert.equal(x.verified,true);assert.equal(x.delivery.status,'VISUAL_IMAGE_PACK_READY');
 assert.equal(x.delivery.zipRef,zipRef);assert.equal(x.delivery.zipSha256,manifest.zipSha256);
 assert.equal(x.delivery.deliveredBytes,false);
 assert.equal(f.paths.filter(s=>s==='/station/go-artifact').length,1);
});
test('LOGIC workshop EXPORT_PACKAGE is fetched and signed receipt/hash validated with a single status',async()=>{
 const pkg={workId:JOB,checkpointId:'CP-'+JOB,subjectId:'S1'};
 const hash=digest(Buffer.from(canonical(pkg)));
 const ref='r2://factory/records/logic/workshop/v1/content/'+hash;
 const out={artifactRef:ref,sha256:hash,receipt:{receiptId:RID},
  readback:{receiptId:RID,workId:JOB,domainVerified:true},package:pkg};
 const bytes=Buffer.from(JSON.stringify(out));
 const f=fixture({domain:'LOGIC',files:{[ref]:{bytes,mime:'application/json'}},
  resultFields:{machineResult:{workshopResult:{operation:'EXPORT_PACKAGE',
   operationId:'op-1',subjectId:'S1',status:'PASS',output:{ref}}}}});
 const x=await factoryDirectJobStatus(f.env,{requestId:REQUEST});
 assert.equal(x.ok,true);assert.equal(x.verified,true);
 assert.equal(x.delivery.status,'LOGIC_PACKAGE_READY');
 assert.equal(x.delivery.deliveredBytes,true);
 assert.equal(x.delivery.artifact.sha256,digest(bytes));
 assert.equal(f.paths.includes('/station/go-job'),false);
});
test('LOGIC normal completed workshop returns result without pretending an exported package',async()=>{
 const f=fixture({domain:'LOGIC',resultFields:{machineResult:{workshopResult:{
  operation:'TEST_CASE',operationId:'op-2',subjectId:'S1',status:'PASS'}}}});
 const x=await factoryDirectJobStatus(f.env,{requestId:REQUEST});
 assert.equal(x.delivery.status,'LOGIC_RESULT_READY');
 assert.equal(x.delivery.deliveredBytes,false);
 assert.equal(f.paths.includes('/station/go-artifact'),false);
});
test('VISUAL missing or ambiguous artifact never gets a false success delivery',async()=>{
 const empty=fixture();
 const r=await factoryDirectJobStatus(empty.env,{requestId:REQUEST});
 assert.equal(r.verified,true);assert.equal(r.delivery.status,'VISUAL_RESULT_REF_UNVERIFIED');
 assert.equal(r.delivery.deliveredBytes,false);
 const refA=ROOT+'render.png',refB=ROOT+'split-manifest.json';
 const ambiguous=fixture({files:{[refA]:{bytes:Buffer.from('x'),mime:'image/png'},
 [refB]:{bytes:Buffer.from('y'),mime:'application/json'}}});
 const a=await factoryDirectJobStatus(ambiguous.env,{requestId:REQUEST});
 assert.equal(a.delivery.status,'VISUAL_RESULT_REF_UNVERIFIED');
 assert.equal(ambiguous.paths.includes('/station/go-artifact'),false);
});
test('VISUAL pending and uncertain states never read final artifact or restart machine',async()=>{
 const ref=ROOT+'render.png';
 for(const status of ['IN_PROGRESS','ACCEPTED']){
   const f=fixture({jobStatus:status,files:{[ref]:{bytes:Buffer.from('PNG'),mime:'image/png'}}});
   const x=await factoryDirectJobStatus(f.env,{requestId:REQUEST});
   assert.equal(x.jobStatus,status);
   assert.equal(x.delivery,undefined);
   assert.equal(f.paths.includes('/station/go-artifact'),false);
   assert.equal(f.paths.includes('/station/go-job'),false);
 }
});
