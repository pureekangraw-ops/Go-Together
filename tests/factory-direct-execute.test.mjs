import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {buildGoHandoff, factoryDirectExecute, factoryDirectReadback} from '../worker/factory-direct.mjs';

const ROOT='https://go-together.pureekangraw.workers.dev',secret='b'.repeat(64),sha='a'.repeat(40);
const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
const base={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',DB:{prepare:()=>({first:async()=>({healthy:1})})}};
const workId='WORK-GO-DIRECT-R2',checkpointId='CP-01',receiptId='receipt-44444444-4444-4444-4444-444444444444';
const pass={kind:'WORK_PASS',version:'WORK_PASS_V1',status:'ACTIVE',actor:'GO',
  workId,checkpointId,passId:'GO-PASS-001',permissions:{actions:['handoff'],
    handoff:[{stationId:'FACTORY_STATION'}]},authorityTransferred:false};
const handoff = {workId,checkpointId,workPassRef:'work-pass://'+pass.passId,
  workPass:pass,ownerDomain:'CODE',intent:'EXECUTE_CODE',scope:['EXECUTE:CODE','DEPLOY:CODE'],
  inputRefs:[`r2://factory/edge-inputs/test.json#sha256=${'c'.repeat(64)}`],expectedSourceSha:sha};
const value={receiptId,workId,checkpointId,workPassRef:handoff.workPassRef,
  actingActor:'GO',authorizationSource:'WORK_PASS',originSystem:'go-together',
  sourceSha:sha,stationId:'FACTORY-STATION',domainVerified:true,domainCompleted:true,
  result:{artifactRefs:['r2://factory/edge-results/GO/CP-01/code.js'],
    evidenceRefs:['r2://factory/edge-results/GO/CP-01/receipt.json']}};
function mockedEnv(onCall) {
  return {...base,GO_FACTORY_RAIL_SECRET:secret,
    FACTORY_DIRECT:{fetch:async req => {
      const method=req.method,path=new URL(req.url).pathname;
      const timestamp=req.headers.get('x-metropolis-factory-timestamp');
      const signature=req.headers.get('x-metropolis-factory-signature');
      const body=method==='GET'?'':await req.clone().text();
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
        {name:'HMAC',hash:'SHA-256'},false,['verify']);
      const bytes=Uint8Array.from(signature.match(/../g),pair=>parseInt(pair,16));
      assert.equal(await crypto.subtle.verify('HMAC',key,bytes,
        new TextEncoder().encode(timestamp+'.'+body)),true);
      assert.equal(req.headers.get('x-factory-client'),'GO');
      assert.equal(new URL(req.url).host,'factory-district.internal');
      return onCall({method,path,body:body?JSON.parse(body):null});
    }}};
}
function fixture() {
  let receive=0,preflights=0,reads=0;
  const env=mockedEnv(({method,path,body})=>{
    if(path==='/station/preflight') {
      preflights++;
      assert.equal(body.source.system,'go-together');
      assert.equal(body.source.stationId,'GO-BRAIN');
      assert.equal(body.workId,workId);
      return Response.json({status:'READY',allowed:true,
        workId,checkpointId,workPassRef:handoff.workPassRef,sourceSha:sha,
        validationScope:'FACTORY_BOUNDARY_PREFLIGHT'});
    }
    if(path==='/station/receive') {
      receive++;assert.equal(method,'POST');assert.equal(body.ownerDomain,'CODE');
      return Response.json({receipt:{receiptId},readback:value},{status:202});
    }
    if(path==='/station/readback/'+receiptId) {
      reads++;assert.equal(method,'GET');
      return Response.json(value);
    }
    throw Error('unexpected direct method/path');
  });
  return {env,counters:()=>({receive,preflights,reads})};
}
async function tool(env,name,args,context=ctx) {
  const res=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',
    body:JSON.stringify({jsonrpc:'2.0',id:64,method:'tools/call',params:{name,arguments:args}})}),env,context);
  return {status:res.status,data:await res.json()};
}
const val = x => JSON.parse(x.data.result.content[0].text);

test('GO direct tool preflight exists and makes exactly one private signed request',async()=>{
  const f=fixture();
  const o=await tool(f.env,'factory_direct_preflight',{handoff});
  assert.equal(val(o).status,'PREFLIGHT_READY');
  assert.deepEqual(f.counters(),{preflights:1,receive:0,reads:0});
});
test('GO direct owner-approved CODE pipeline creates and reads verified receipt',async()=>{
  const f=fixture();
  const result=val(await tool(f.env,'factory_direct_execute',{handoff,approved:true}));
  assert.equal(result.status,'DOMAIN_ARTIFACT_RECORDED');
  assert.equal(result.verified,true);
  assert.equal(result.artifactDownloaded,false);
  assert.deepEqual(result.artifactRefs,value.result.artifactRefs);
  assert.deepEqual(f.counters(),{preflights:1,receive:1,reads:1});
  const back=val(await tool(f.env,'factory_direct_readback',{receiptId,workId,checkpointId,workPassRef:handoff.workPassRef,expectedSourceSha:sha}));
  assert.equal(back.verified,true);
  assert.equal(back.executed,false);
  assert.deepEqual(f.counters(),{preflights:1,receive:1,reads:2});
});
test('GO direct execute refuses unauthenticated/owner-unapproved requests',async()=>{
  const f=fixture();
  assert.equal((await tool(f.env,'factory_direct_execute',{handoff,approved:true},{})).status,401);
  const missing=await tool(f.env,'factory_direct_execute',{handoff});
  assert.equal(missing.data.result.isError,true);
  assert.equal(f.counters().receive,0);
});
test('placeholders block direct execution even if Worker binding is available',async()=>{
  let calls=0;
  const env={...base,GO_FACTORY_RAIL_SECRET:'PENDING_REPLACE_GO_SIDE_20261023_INACTIVE',
    FACTORY_DIRECT:{fetch:async()=>{calls++;return Response.json(value);}}};
  const r=val(await tool(env,'factory_direct_execute',{handoff,approved:true}));
  assert.equal(r.status,'DIRECT_RAIL_NOT_CONFIGURED');
  assert.equal(calls,0);
});
test('GO direct command does not mint/forge Work Pass or task identity',()=>{
  assert.equal(buildGoHandoff({...handoff,workPass:{...pass,actor:'PANTHEON'}}),null);
  assert.equal(buildGoHandoff({...handoff,workPass:{...pass,status:'REVOKED'}}),null);
  assert.equal(buildGoHandoff({...handoff,workId:'NEW-SPOOF'}),null);
  assert.equal(buildGoHandoff({...handoff,extra:'dispatch_me'}),null);
  assert.equal(buildGoHandoff({...handoff,inputRefs:['https://attacker.invalid']}),null);
  assert.equal(buildGoHandoff({...handoff,scope:['EXECUTE:CODE']}),null);
});
test('GO direct readback never accepts another source owner or wrong digest context',async()=>{
  const r=await factoryDirectReadback(mockedEnv(({path})=>
    Response.json({...value,originSystem:'pantheon-workhub'})),
    {receiptId,workId,checkpointId,workPassRef:handoff.workPassRef,expectedSourceSha:sha});
  assert.equal(r.ok,false);
  const f=fixture();
  const bad=await factoryDirectReadback(f.env,
    {receiptId,workId,checkpointId,workPassRef:handoff.workPassRef,expectedSourceSha:'f'.repeat(40)});
  assert.equal(bad.ok,false);
});
test('direct GO readiness/execute tools are advertised with correct MCP effect annotations',async()=>{
  const list=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',
    body:JSON.stringify({jsonrpc:'2.0',id:62,method:'tools/list'})}),base,ctx);
  const tools=(await list.json()).result.tools;
  const names=['factory_direct_status','factory_direct_preflight','factory_direct_execute','factory_direct_readback'];
  for(const name of names)assert.ok(tools.some(t=>t.name===name),name);
  assert.equal(tools.find(t=>t.name==='factory_direct_execute').annotations.readOnlyHint,false);
  assert.equal(tools.find(t=>t.name==='factory_direct_execute').annotations.destructiveHint,true);
});
