import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './hub-fixture.mjs';
import {factoryDirectSubmit,factoryDirectArtifact,factoryDirectReadback,factoryDirectJobStatus,factoryJobStampStatus}
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
        sourceSha:SHA,storage:{status:'READY'},transport:{status:'READY'},machinery:{CODE:{status:'READY'},VISUAL:{status:'READY'},LOGIC:{status:'READY'}}});
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(KEY),
        {name:'HMAC',hash:'SHA-256'},false,['verify','sign']);
      const sig=req.headers.get('x-metropolis-factory-signature');
      assert.equal(await crypto.subtle.verify('HMAC',key,
        Uint8Array.from(sig.match(/../g),x=>parseInt(x,16)),
        new TextEncoder().encode(req.headers.get('x-metropolis-factory-timestamp')+'.'+raw)),true);
      assert.equal(req.headers.get('x-factory-client'),'GO');
      const payload=raw?JSON.parse(raw):null;
      if(path==='/station/go-auth-probe'){
        assert.equal(payload.purpose,'GO_FACTORY_AUTH_PROBE_V1');
        assert.match(payload.nonce,/^[a-f0-9]{32}$/);
        const message='GO_FACTORY_AUTH_PROBE_V1\n'+payload.nonce+'\n'+SHA+'\nFACTORY-STATION';
        const proof=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message))).toString('hex');
        return Response.json({status:'AUTHENTICATED',service:'factory-district',
          stationId:'FACTORY-STATION',sourceSha:SHA,nonce:payload.nonce,proof,
          readOnly:true,executed:false});
      }
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
  const raw=body.result?.content?.[0]?.text;
  let data=body; if(raw!==undefined){try{data=JSON.parse(raw);}catch{data=raw;}}
  return {status:res.status,data,isError:body.result?.isError===true};
}
test('Factory MCP only stages proposals; legacy direct submit is not exposed',async()=>{
  const f=fixture();
  const listed=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',
    body:JSON.stringify({jsonrpc:'2.0',id:5,method:'tools/list'})}),f.env,ctx);
  const tools=(await listed.json()).result.tools;
  assert.ok(tools.some(x=>x.name==='factory_direct_propose'));
  assert.ok(tools.some(x=>x.name==='factory_direct_approval_status'));
  assert.ok(!tools.some(x=>x.name==='factory_direct_submit'));
  const legacy=await mcp(f.env,'factory_direct_submit',{domain:'CODE',spec,requestId:ID,approved:true});
  assert.equal(legacy.data.error?.message,'unknown_tool');
  assert.equal(f.seen.length,0);
});
test('Anonymous calls cannot propose or dispatch Factory work',async()=>{
  const f=fixture();
  const anonymous=await mcp(f.env,'factory_direct_propose',{domain:'CODE',spec,requestId:ID},{});
  assert.equal(anonymous.status,401);
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
  for(const t of ['factory_direct_status','factory_direct_propose','factory_direct_approval_status',
    'factory_direct_job_status','factory_direct_readback','factory_direct_artifact'])
    assert.ok(names.includes(t));
  for(const t of ['factory_direct_submit','factory_direct_prepare','factory_direct_preflight','factory_direct_execute'])
    assert.ok(!names.includes(t));
  const propose=tools.find(t=>t.name==='factory_direct_propose');
  assert.deepEqual(propose.inputSchema.required,['domain','spec','requestId']);
  assert.equal(propose.annotations.destructiveHint,false);
  assert.ok(!JSON.stringify(propose.inputSchema).includes('approved'));
  assert.ok(!JSON.stringify(propose.inputSchema).includes('workPass'));
});



test('PROOF bridge returns receipt-bound report, not application acceptance', async () => {
  const f=fixture(),before=f.env.FACTORY_DIRECT.fetch;
  const ref='r2://factory/records/proof/reports/'+JOB;
  const report={schema:'FACTORY_PROOF_REPORT_V1',workId:JOB,checkpointId:'CP-'+JOB,
    factorySourceSha:SHA,mode:'CATALOG',verdict:'REFERENCE_ONLY',
    appAcceptanceVerified:false,externalTestExecuted:false};
  f.env.FACTORY_DIRECT.fetch=async request=>{
    const path=new URL(request.url).pathname;
    if(path==='/health'){
      const r=await before(request),h=await r.json();
      return Response.json({...h,machinery:{...h.machinery,PROOF:{status:'READY'}}});
    }
    if(path==='/station/go-job')return Response.json({status:'COMPLETED',requestId:ID,jobId:JOB,receiptId:RID,domain:'PROOF',sourceSha:SHA});
    if(path==='/station/readback/'+RID)return Response.json({...readback(),
      result:{ownerDomain:'PROOF',artifactRefs:[ref],evidenceRefs:[ref]},
      machineResult:{proofResult:report,reportRef:ref}});
    if(path==='/station/go-artifact'){
      const bytes=new TextEncoder().encode(JSON.stringify(report));
      return new Response(bytes,{headers:{'content-type':'application/json',
        'x-factory-artifact-sha256':await digest(bytes),
        'x-factory-receipt-id':RID,'x-factory-source-sha':SHA}});
    }
    return before(request);
  };
  const out=await factoryDirectSubmit(f.env,{domain:'PROOF',spec:{mode:'CATALOG',caseIds:[]},requestId:ID},true);
  assert.equal(out.status,'PROOF_REPORT_READY',JSON.stringify(out));
  assert.equal(out.verdict,'REFERENCE_ONLY');
  assert.equal(out.appAcceptanceVerified,false);
  assert.equal(out.reportRef,ref);
  assert.equal(out.deliveredBytes,true);
  assert.equal(out.artifact.mime,'application/json');
  assert.deepEqual(JSON.parse(Buffer.from(out.artifact.base64,'base64').toString()),report);
});

test('GO reads existing Job Stamp by signed receipt, no new machine command or key issuance',async()=>{
 const f=fixture(),original=f.env.FACTORY_DIRECT.fetch;
 const stampRef='r2://factory/records/factory/job-stamp/v1/'+RID;
 const stamp={schema:'FACTORY_JOB_STAMP_V1',receiptId:RID,jobId:JOB,checkpointId:'CP-'+JOB,
   sourceSha:SHA,ownerDomain:'CODE',status:'PASS',
   appAcceptanceVerified:false,dispatchState:'AVAILABLE_NOT_DELIVERED',
   files:[{ref:ART,status:'VERIFIED',bytes:bytes.length,sha256:await digest(bytes)}]};
 f.env.FACTORY_DIRECT.fetch=async req=>{
   if(new URL(req.url).pathname==='/station/go-job-stamp-status'){
     assert.deepEqual(await req.json(),{receiptId:RID});
     return Response.json({status:'PASS',receiptId:RID,stamp,stampRef,readOnly:true});
   }
   return original(req);
 };
 const result=await factoryJobStampStatus(f.env,{receiptId:RID});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.deliveryAuthorized,true);
 assert.equal(result.stampRef,stampRef);
 const viaMcp=await mcp(f.env,'factory_job_stamp_status',{receiptId:RID});
 assert.equal(viaMcp.data.ok,true,JSON.stringify(viaMcp.data));
 assert.equal(viaMcp.data.stamp.appAcceptanceVerified,false);
});
test('GO advertises existing PROOF managed environment TOOLKIT schema',async()=>{
 const f=fixture();
 const res=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({
   jsonrpc:'2.0',id:5,method:'tools/list'})}),f.env,ctx);
 const catalog=(await res.json()).result.tools;
 assert.ok(catalog.some(x=>x.name==='factory_job_stamp_status'));
 const spec=catalog.find(x=>x.name==='factory_direct_propose').inputSchema.properties.spec;
 const parts=spec.oneOf||[];
 assert.ok(parts.some(x=>x.properties?.mode?.const==='TOOLKIT'&&
   x.properties.action.enum.includes('OPEN_ENV')&&
   x.properties.action.enum.includes('RUN_CASE')&&
   x.properties.action.enum.includes('CLOSE_ENV')));
});
