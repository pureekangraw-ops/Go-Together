import test from 'node:test';
import assert from 'node:assert/strict';
import {runFactoryCodeToGithub} from '../worker/factory-code-delivery.mjs';
import {tools as registeredTools} from '../worker/index.js';

const ID='70261027-0a23-4c26-8dfa-000000000001';
const JOB='GOJOB-'+'a'.repeat(32);
const RECEIPT='receipt-11111111-2222-4333-8444-555555555555';
const CODE='export default { async fetch(){ return new Response("ok"); } };';
const REQUEST={requestId:ID,repo:'pureekangraw-ops/Factory-District',
 baseSha:'b'.repeat(40),filePath:'examples/owner-code.mjs',approved:true,
 codeSpec:{baseSource:CODE,patch:{find:'ok',replace:'ready'},
 tests:[{path:'/',status:200,body:'ready'}]}};
const completed={ok:true,status:'GO_FACTORY_DELIVERABLE_READY',domain:'CODE',
 requestId:ID,receiptId:RECEIPT,jobId:JOB,sourceSha:'c'.repeat(40),
 executed:true,deliveredBytes:true};
const shipped={ok:true,status:'PR_OPENED',receiptId:RECEIPT,jobId:JOB,
 sourceSha:'c'.repeat(40),prUrl:'https://github.com/pureekangraw-ops/Factory-District/pull/99',
 prNumber:99,delivered:true,merged:false,deployed:false};
test('single invocation runs Factory exactly once, then verified GitHub PR, CI pending',async()=>{
 const events=[];
 const out=await runFactoryCodeToGithub({},REQUEST,{
   submit:async(_env,input,approved)=>{
     events.push('factory');
     assert.equal(approved,true);
     assert.equal(input.domain,'CODE');
     assert.equal(input.requestId,ID);
     assert.deepEqual(input.spec,REQUEST.codeSpec);
     return completed;
   },
   deliver:async(_env,input)=>{
     events.push('git');
     assert.equal(input.receiptId,RECEIPT);
     assert.equal(input.requestId,ID);
     assert.equal(input.repo,REQUEST.repo);
     return shipped;
   }
 });
 assert.deepEqual(events,['factory','git']);
 assert.equal(out.ok,true);
 assert.equal(out.status,'CODE_PR_READY_CI_PENDING');
 assert.equal(out.factoryCompleted,true);
 assert.equal(out.ciStatus,'PENDING_EXTERNAL_GITHUB_ACTIONS');
 assert.equal(out.reviewRequired,true);
 assert.equal(out.deployed,false);
 assert.equal(out.applicationAccepted,false);
});
test('invalid owner approval and malformed request never invoke a machine',async()=>{
 let invoked=0;
 const deps={submit:async()=>{invoked++;return completed;}};
 for(const input of [{...REQUEST,approved:false},{...REQUEST,requestId:'repeat-me'},
   {...REQUEST,filePath:'.github/workflows/deploy.yml'}, {...REQUEST,baseSha:'stale'}]){
   const x=await runFactoryCodeToGithub({},input,deps);
   assert.equal(x.ok,false);
 }
 assert.equal(invoked,0);
});
test('transport uncertainty and mismatched receipt never trigger GitHub writes',async()=>{
 for(const bad of [
   {ok:false,status:'GO_JOB_EFFECT_UNVERIFIED',requestId:ID,jobId:JOB,receiptId:RECEIPT},
   {...completed,sourceSha:'garbled'},
   {...completed,jobId:'invalid'},
   {...completed,executed:false}
 ]){
  const events=[];
  const x=await runFactoryCodeToGithub({},REQUEST,{
    submit:async()=>{events.push('factory');return bad;},
    deliver:async()=>{events.push('git');return shipped;}
  });
  assert.equal(x.ok,false);
  assert.deepEqual(events,['factory']);
 }
});
test('failed GitHub delivery cannot be elevated to success or trigger a second CODE effect',async()=>{
 const events=[];
 const out=await runFactoryCodeToGithub({},REQUEST,{
   submit:async()=>{events.push('factory');return completed;},
   deliver:async()=>{events.push('git');return {ok:false,status:'UNKNOWN',
      phase:'BRANCH',reason:'GITHUB_BRANCH_UNVERIFIED_NO_REPLAY'};}
 });
 assert.deepEqual(events,['factory','git']);
 assert.equal(out.ok,false);
 assert.equal(out.factoryCompleted,true);
 assert.equal(out.executed,true);
 assert.equal(out.reason,'GITHUB_BRANCH_UNVERIFIED_NO_REPLAY');
});
test('cross-source identity mismatch cannot be reported as a verified release',async()=>{
 const out=await runFactoryCodeToGithub({},REQUEST,{
   submit:async()=>completed,
   deliver:async()=>({...shipped,jobId:'GOJOB-'+'f'.repeat(32)})
 });
 assert.equal(out.ok,false);
 assert.equal(out.reason,'FACTORY_GITHUB_IDENTITY_MISMATCH');
});
test('Factory proposal tool preserves CODE handoff schema but cannot directly execute',()=>{
 const tool=registeredTools.find(x=>x.name==='factory_direct_propose');
 assert.ok(tool);
 assert.deepEqual(tool.inputSchema.required,['domain','spec','requestId']);
 assert.equal(tool.annotations.readOnlyHint,false);
 assert.equal(tool.annotations.destructiveHint,false);
 assert.deepEqual(tool.inputSchema.properties.githubDelivery.required,['repo','baseSha','filePath']);
 assert.equal(registeredTools.filter(x=>x.name==='factory_direct_propose').length,1);
 assert.equal(registeredTools.some(x=>x.name==='factory_direct_submit'),false);
 assert.equal(registeredTools.some(x=>x.name==='factory_code_run_to_github'),false);
 const spec=JSON.stringify(tool.inputSchema.properties.spec);
 assert.ok(spec.includes('CATALOG') && spec.includes('RECEIPT_CHECK') &&
   spec.includes('TOOLKIT'),'PROOF variants preserved');
 assert.ok(spec.includes('"design"') && spec.includes('"viewport"'),
   'VISUAL schema preserved');
 assert.ok(spec.includes('DWARF-01_TRAINING'),'LOGIC schema preserved');
 assert.ok(spec.includes('"baseSource"'),'CODE schema preserved');
});
