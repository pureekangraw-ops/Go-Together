import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deliverFactoryCodeToGithub} from '../worker/factory-code-delivery.mjs';

const JOB='GOJOB-'+'a'.repeat(32);
const RECEIPT='receipt-11111111-2222-4333-8444-555555555555';
const SOURCE='b'.repeat(40),BASE='c'.repeat(40),COMMIT='d'.repeat(40),
  BLOB='e'.repeat(40);
const ART='r2://factory/edge-results/'+JOB+'/CP-'+JOB+'/R1/main.js';
const FILE='export default {fetch(){return new Response("yes")}};\n';
const bytes=Buffer.from(FILE),digest=createHash('sha256').update(bytes).digest('hex');
const request={receiptId:RECEIPT,repo:'pureekangraw-ops/Factory-District',
  baseSha:BASE,filePath:'examples/verified-output.mjs',requestId:'delivery_20261027_0001',approved:true};
const result=body=>({ok:true,upstream_status:201,body});
function fixture(override={}){
 const calls=[];
 const receipt={ok:true,verified:true,jobStatus:'COMPLETED',domain:'CODE',
   jobId:JOB,receiptId:RECEIPT,sourceSha:SOURCE,artifactRefs:[ART]};
 const file={ok:true,receiptId:RECEIPT,artifactRef:ART,bytes:bytes.length,
   mime:'text/javascript; charset=utf-8',sha256:digest,base64:bytes.toString('base64')};
 const deps={
   readback:async()=>override.receipt||receipt,
   artifact:async()=>override.artifact||file,
   hub:async(_env,name,payload)=>{
     calls.push({name,payload});
     if(override.fail===name)return {ok:false,status:'UPSTREAM_TOOL_ERROR'};
     if(name==='github_repo')return result({full_name:request.repo,default_branch:'main'});
     if(name==='github_branch')return {ok:true,upstream_status:201,
       branch:'refs/heads/code/jobs/'+JOB,commitSha:BASE};
     if(name==='github_put_file')return {ok:true,upstream_status:201,
       commitSha:COMMIT,contentSha:BLOB};
     if(name==='github_file')return result({type:'file',sha:BLOB,encoding:'base64',
       content:(override.badReadback?'cGFydGlhbA==':bytes.toString('base64'))});
     if(name==='github_open_pr')return {ok:true,upstream_status:201,
       prNumber:91,prUrl:'https://github.com/pureekangraw-ops/Factory-District/pull/91'};
     throw Error('unexpected tool '+name);
   }
 };
 return {calls,deps};
}
test('real Hub V2 flattened GitHub write receipts produce exact PR after file readback; never deploy',async()=>{
 const f=fixture(),out=await deliverFactoryCodeToGithub({},request,f.deps);
 assert.equal(out.ok,true);assert.equal(out.status,'PR_OPENED');
 assert.equal(out.artifactSha256,digest);assert.equal(out.commitSha,COMMIT);
 assert.equal(out.delivered,true);assert.equal(out.merged,false);
 assert.equal(out.deployed,false);assert.equal(out.applicationAccepted,false);
 assert.deepEqual(f.calls.map(v=>v.name),['github_repo','github_branch','github_put_file',
   'github_file','github_open_pr']);
 const put=f.calls[2].payload;
 assert.equal(put.content,FILE);assert.equal(put.sha,undefined);
 assert.equal(put.branch,'code/jobs/'+JOB);
 assert.deepEqual(f.calls.filter(v=>v.name==='github_branch'||v.name==='github_put_file'||v.name==='github_open_pr')
   .map(v=>v.payload.requestId),
   ['delivery_20261027_0001-branch','delivery_20261027_0001-commit','delivery_20261027_0001-pr']);
});
test('invalid approval, target path and digest are rejected before any GitHub mutations',async()=>{
 const f=fixture();
 assert.equal((await deliverFactoryCodeToGithub({}, {...request,approved:false},f.deps)).ok,false);
 assert.equal((await deliverFactoryCodeToGithub({}, {...request,filePath:'.github/workflows/deploy.yml'},f.deps)).ok,false);
 assert.equal((await deliverFactoryCodeToGithub({}, {...request,filePath:'src/../evil.js'},f.deps)).ok,false);
 const bad=fixture({artifact:{ok:true,receiptId:RECEIPT,artifactRef:ART,
   bytes:bytes.length,mime:'text/javascript; charset=utf-8',
   sha256:'0'.repeat(64),base64:bytes.toString('base64')}});
 const result=await deliverFactoryCodeToGithub({},request,bad.deps);
 assert.equal(result.reason,'FACTORY_CODE_BYTES_HASH_MISMATCH');
 assert.deepEqual(f.calls,[]);assert.deepEqual(bad.calls,[]);
});
test('receipt not completed or stamped FAIL cannot trigger branch creation',async()=>{
 for(const patch of [{verified:false},{domain:'VISUAL'},{jobStamp:{status:'FAIL'}}]){
   const f=fixture({receipt:{ok:true,verified:true,jobStatus:'COMPLETED',domain:'CODE',
      jobId:JOB,receiptId:RECEIPT,sourceSha:SOURCE,artifactRefs:[ART],...patch}});
   const out=await deliverFactoryCodeToGithub({},request,f.deps);
   assert.equal(out.ok,false);assert.deepEqual(f.calls,[]);
 }
});
test('ambiguous branch/commit stops without retrying or opening PR',async()=>{
 for(const failure of ['github_branch','github_put_file']){
   const f=fixture({fail:failure}),out=await deliverFactoryCodeToGithub({},request,f.deps);
   assert.equal(out.ok,false);assert.equal(out.delivered,false);
   assert.equal(out.reason,failure==='github_branch'?'GITHUB_BRANCH_UNVERIFIED_NO_REPLAY':
     'GITHUB_COMMIT_UNVERIFIED_NO_REPLAY');
   assert.equal(f.calls.filter(c=>c.name===failure).length,1);
   assert.equal(f.calls.some(c=>c.name==='github_open_pr'),false);
 }
});
test('bad GitHub file readback refuses PR and preserves the prior commit for reconciliation',async()=>{
 const f=fixture({badReadback:true});
 const out=await deliverFactoryCodeToGithub({},request,f.deps);
 assert.equal(out.ok,false);assert.equal(out.reason,'GITHUB_FILE_BYTES_MISMATCH');
 assert.equal(out.commitSha,COMMIT);assert.equal(out.phase,'READBACK');
 assert.equal(f.calls.some(c=>c.name==='github_open_pr'),false);
});
