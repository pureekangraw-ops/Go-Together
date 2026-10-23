import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {factoryDirectSubmit,factoryDirectArtifact,factoryDirectReadback,factoryDirectJobStatus}
  from '../worker/factory-direct.mjs';

const ROOT='https://go-together.pureekangraw.workers.dev';
const KEY='b'.repeat(64),SHA='a'.repeat(40);
const ID='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const JOB='GOJOB-'+ 'a'.repeat(32);
const RID='receipt-11111111-2222-4333-8444-555555555555';
const ART='r2://factory/edge-results/'+JOB+'/CP-'+JOB+'/run-1/main.js';
const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
const base={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',
  DB:{prepare:()=>({first:async()=>({healthy:1})})}};
const spec={baseSource:'export default "before"',patch:{find:'before',replace:'after'},
  tests:[{path:'/',status:200,body:'after'}]};
const bytes=new TextEncoder().encode('export default "after"');
async function digest(data){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');}
function readback() {
  return {receiptId:RID,workId:JOB,checkpointId:'CP-'+JOB,stationId:'FACTORY-STATION',
    originSystem:'go-together',actingActor:'GO',authorizationSource:'WORK_PASS',
    domainVerified:true,domainCompleted:true,sourceSha:SHA,
    result:{ownerDomain:'CODE',artifactRefs:[ART],evidenceRefs:['evidence://factory/go']}};
}
function fixture(){
  const seen=[];
  const env={...base,GO_FACTORY_RAIL_SECRET:KEY,FACTORY_DIRECT:{
    async fetch(req){
      const url=new URL(req.url),path=url.pathname;
      const raw=req.method==='GET'?'':await req.clone().text();
      seen.push(path);
      assert.equal(url.hostname,'factory-district.internal');
      if(path==='/health')return Response.json({
        service:'factory-district',stationId:'FACTORY-STATION',status:'READY',
        sourceSha:SHA,machinery:{CODE:{status:'READY'},VISUAL:{status:'READY'},LOGIC:{status:'READY'}}});
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(KEY),
        {name:'HMAC',hash:'SHA-256'},false,['verify']);
      const sig=req.headers.get('x-metropolis-factory-signature');
      assert.equal(await crypto.subtle.verify('HMAC',key,
        Uint8Array.from(sig.match(/../g),x=>parseInt(x,16)),
        new TextEncoder().encode(req.headers.get('x-metropolis-factory-timestamp')+'.'+raw)),true);
      assert.equal(req.headers.get('x-factory-client'),'GO');
      const payload=raw?JSON.parse(raw):null;
      if(path==='/station/go-job'){
        assert.deepEqual(payload,{requestId:ID,domain:'CODE',spec,expectedSourceSha:SHA});
        return Response.json({status:'COMPLETED',requestId:ID,jobId:JOB,
          receiptId:RID,domain:'CODE',sourceSha:SHA,readback:readback()});
      }
      if(path==='/station/go-job-status'){
        assert.deepEqual(payload,{requestId:ID});
        return Response.json({status:'COMPLETED',requestId:ID,jobId:JOB,
          receiptId:RID,readback:readback()});
      }
      if(path==='/station/readback/'+RID) return Response.json(readback());
      if(path==='/station/go-artifact'){
        assert.deepEqual(payload,{receiptId:RID,artifactRef:ART});
        return new Response(bytes,{headers:{'content-type':'text/javascript; charset=utf-8',
          'x-factory-artifact-sha256':await digest(bytes),
          'x-factory-receipt-id':RID,'x-factory-source-sha':SHA}});
      }
      throw Error('Unexpected Factory route '+path);
    }}};
  return {env,seen};
}
async function mcp(env,name,args,auth=ctx){
  const res=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({
    jsonrpc:'2.0',id:44,method:'tools/call',params:{name,arguments:args}})}),env,auth);
  const body=await res.json();
  return {status:res.status,data:body.result?.content?.[0]?.text?JSON.parse(body.result.content[0].text):body};
}
test('Owner GO submits CODE brief, receives Factory Job ID, Receipt and exact bytes with no Work Pass',async()=>{
  const f=fixture();
  const result=await mcp(f.env,'factory_direct_submit',{domain:'CODE',spec,requestId:ID,approved:true});
  assert.equal(result.status,200);
  assert.equal(result.data.ok,true,JSON.stringify(result.data));
  assert.equal(result.data.status,'GO_FACTORY_DELIVERABLE_READY');
  assert.equal(result.data.jobId,JOB);
  assert.equal(result.data.receiptId,RID);
  assert.equal(Buffer.from(result.data.artifact.base64,'base64').toString(),'export default "after"');
  assert.deepEqual(f.seen,['/health','/station/go-job','/station/readback/'+RID,
    '/station/readback/'+RID,'/station/go-artifact']);
  const reread=await factoryDirectReadback(f.env,{receiptId:RID});
  assert.equal(reread.verified,true);
  const status=await factoryDirectJobStatus(f.env,{requestId:ID});
  assert.equal(status.jobId,JOB);
  assert.equal(status.status,'GO_JOB_STATUS_READ');
});
test('Owner only; rejected or anonymous commands never enter Factory',async()=>{
  const f=fixture();
  const anonymous=await mcp(f.env,'factory_direct_submit',{domain:'CODE',spec,requestId:ID,approved:true},{});
  assert.equal(anonymous.status,401);
  const noApproval=await mcp(f.env,'factory_direct_submit',{domain:'CODE',spec,requestId:ID,approved:false});
  assert.equal(noApproval.status,200);
  assert.equal(noApproval.data.error||'', '');
  // MCP invalid approved value results in an isError message, not a dispatch.
  assert.equal(f.seen.length,0);
});
test('Dummy Cloudflare keys fail closed and cannot run any request',async()=>{
  let requests=0;
  const env={...base,GO_FACTORY_RAIL_SECRET:'PENDING_REPLACE_GO_SIDE_20261023_INACTIVE',
    FACTORY_DIRECT:{fetch:async()=>{requests++;return Response.json({});}}};
  const r=await factoryDirectSubmit(env,{domain:'CODE',spec,requestId:ID},true);
  assert.equal(r.status,'DIRECT_RAIL_NOT_CONFIGURED');
  assert.equal(requests,0);
});
test('GO refuses receipt from another principal and malicious artifact refs',async()=>{
  const f=fixture();
  const bad={...f.env,FACTORY_DIRECT:{fetch:async req=>
    new URL(req.url).pathname==='/station/readback/'+RID
      ?Response.json({...readback(),originSystem:'pantheon-workhub'})
      :f.env.FACTORY_DIRECT.fetch(req)}};
  assert.equal((await factoryDirectReadback(bad,{receiptId:RID})).ok,false);
  assert.equal((await factoryDirectArtifact(f.env,{receiptId:RID,
    artifactRef:'r2://factory/edge-results/OTHER/private.js'})).ok,false);
});
test('Direct GO MCP only exposes simple job commands, never requires Work Pass',async()=>{
  const f=fixture();
  const result=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',
    body:JSON.stringify({jsonrpc:'2.0',id:5,method:'tools/list'})}),f.env,ctx);
  const tools=(await result.json()).result.tools;
  const names=tools.map(t=>t.name);
  for(const t of ['factory_direct_status','factory_direct_submit',
    'factory_direct_job_status','factory_direct_readback','factory_direct_artifact'])
    assert.ok(names.includes(t));
  for(const t of ['factory_direct_prepare','factory_direct_preflight','factory_direct_execute'])
    assert.ok(!names.includes(t));
  assert.deepEqual(tools.find(t=>t.name==='factory_direct_submit').inputSchema.required,
    ['domain','spec','approved']);
  assert.ok(!JSON.stringify(tools.find(t=>t.name==='factory_direct_submit').inputSchema).includes('workPass'));
});
