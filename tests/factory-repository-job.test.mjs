import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from './hub-fixture.mjs';
import {validRepositoryJob,dispatchRepositoryJob,readRepositoryJob} from '../worker/factory-repository-job.mjs';
const ROOT='https://go-together.pureekangraw.workers.dev',requestId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const spec={repositoryJob:{baseSha:'a'.repeat(40),files:[{path:'docs/job.txt',content:'งานจริง'}]}};
class Statement{constructor(s){this.s=s;}bind(...a){this.a=a;return this;}async first(){return this.s.get(...this.a)||null;}async all(){return {results:this.s.all(...(this.a||[]))};}async run(){return this.s.run(...this.a);}}
class DB{constructor(){this.db=new DatabaseSync(':memory:');this.db.exec(readFileSync(new URL('../migrations/0002_factory_approvals.sql',import.meta.url),'utf8'));}prepare(q){return new Statement(this.db.prepare(q));}}
test('same owner inbox stages, approves once, and reconciles repository work without invoking Factory edge',async()=>{
 const calls=[],ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
 const env={DB:new DB(),ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',HUB_V2:{relay:async a=>{
  calls.push(a);const result=a.name==='github_code_job_dispatch'?{ok:true,status:'DISPATCH_ACCEPTED',requestId}:{ok:true,requestId,repository:'pureekangraw-ops/Factory-District',jobStatus:'COMPLETED',verified:true,prUrl:'https://github.com/pureekangraw-ops/Factory-District/pull/64'};
  return {response:{body:JSON.stringify({result:{content:[{type:'text',text:JSON.stringify(result)}]}})},receipt:{state:'RESPONDED'}};
 }}};
 // appMcp is tested through trusted Hub fixture, with public call forwarding disabled only for this intake fixture.
 const {appMcp}=await import('../worker/index.js');
 const proposed=await appMcp(new Request(ROOT+'/hub-mcp/factory',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'factory_direct_propose',arguments:{domain:'CODE',requestId,spec}}})}),env);
 const rpc=await proposed.json();const proposal=JSON.parse(rpc.result.content[0].text);
 assert.equal(proposal.status,'PENDING_OWNER_APPROVAL');assert.equal(calls.length,0);
 const url=ROOT+'/api/factory-approvals/'+proposal.approvalId;
 const post=path=>worker.fetch(new Request(url+path,{method:'POST',headers:{origin:ROOT,'content-type':'application/json'},body:JSON.stringify(path==='/status'?{}:{payloadSha256:proposal.payloadSha256})}),env,ctx);
 const approved=await (await post('/approve')).json();assert.equal(approved.approval.status,'RUNNING');assert.equal(calls.length,1);
 assert.equal(calls[0].connectorId,'github');assert.equal(calls[0].payload.requestId,requestId);
 assert.equal((await post('/approve')).status,409);assert.equal(calls.length,1);
 const reconciled=await (await post('/status')).json();assert.equal(reconciled.approval.status,'COMPLETED');
 assert.equal(calls[1].name,'github_code_job_readback');assert.deepEqual(calls[1].payload.files,spec.repositoryJob.files);
});
test('unknown dispatch never retries; cross-job readback stays unknown',async()=>{
 let calls=0;const r=await dispatchRepositoryJob({}, {requestId,spec},async()=>{calls++;throw Error('lost');});
 assert.equal(calls,1);assert.equal(r.status,'UNKNOWN');
 const read=await readRepositoryJob({}, {requestId,spec},async()=>({requestId:'wrong',ok:true}));assert.equal(read.reason,'JOB_IDENTITY_MISMATCH');
});
test('batch validation refuses traversal, duplicate files and oversized content',()=>{
 assert.equal(validRepositoryJob(spec.repositoryJob),true);
 for(const files of [[{path:'docs/../x',content:'x'}],[...spec.repositoryJob.files,...spec.repositoryJob.files],[{path:'docs/x',content:'x'.repeat(48001)}]])assert.equal(validRepositoryJob({...spec.repositoryJob,files}),false);
});
test('internal dispatcher cannot be called directly through public MCP',async()=>{
 let calls=0;const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
 const env={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',HUB_V2:{relay:async()=>{calls++;throw Error('must not relay');}}};
 const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'github_code_job_dispatch',arguments:{requestId,...spec.repositoryJob}}})}),env,ctx);
 const result=await r.json();assert.equal(calls,0);assert.ok(result.error||result.result?.isError||r.status===403);
});
