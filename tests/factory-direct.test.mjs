import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {factoryDirectStatus} from '../worker/factory-direct.mjs';

const ROOT='https://go-together.pureekangraw.workers.dev';
const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
const baseEnv={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',DB:{prepare:()=>({first:async()=>({healthy:1})})}};

function mockBinding(onFetch) {
  return { fetch: async request => onFetch(request) };
}
function goodHealth() {
  return {service:'factory-district',stationId:'FACTORY-STATION',status:'READY',
    sourceSha:'a'.repeat(40),transport:{status:'READY'},
    machinery:{CODE:{status:'READY'},VISUAL:{status:'READY'},LOGIC:{status:'READY'}},
    secret:'MUST_NOT_LEAK',providerToken:'MUST_NOT_LEAK'};
}
async function mcp(env, name, args={},context=ctx) {
  return worker.fetch(new Request(ROOT+'/mcp',{method:'POST',
    body:JSON.stringify({jsonrpc:'2.0',id:53,method:'tools/call',params:{name,arguments:args}})}),env,context);
}
async function data(response) {
  return JSON.parse((await response.json()).result.content[0].text);
}

test('direct Factory status MCP tool is discoverable and owner-only',async()=>{
  const list=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',
    body:JSON.stringify({jsonrpc:'2.0',id:54,method:'tools/list'})}),baseEnv,ctx);
  const tool=(await list.json()).result.tools.find(x=>x.name==='factory_direct_status');
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint,true);
  let calls=0;
  const env={...baseEnv,FACTORY_DIRECT:mockBinding(async()=>{calls++;return Response.json(goodHealth());})};
  assert.equal((await mcp(env,'factory_direct_status',{},{})).status,401);
  assert.equal(calls,0);
});

test('direct status reads only fixed health route, redacts secrets, and never claims execution',async()=>{
  let calls=0;
  const env={...baseEnv,GO_FACTORY_RAIL_SECRET:'PENDING_REPLACE_GO_SIDE_20261023_INACTIVE',
    FACTORY_DIRECT:mockBinding(async req=>{
      calls++;
      assert.equal(req.method,'GET');
      assert.equal(new URL(req.url).pathname,'/health');
      assert.equal(new URL(req.url).hostname,'factory-district.internal');
      assert.equal(req.headers.get('authorization'),null);
      return Response.json(goodHealth());
    })};
  const value=await data(await mcp(env,'factory_direct_status'));
  assert.equal(value.ok,true);
  assert.equal(value.status,'CONNECTED');
  assert.equal(value.route,'GO_BRAIN_TO_FACTORY_DIRECT');
  assert.equal(value.readOnly,true);
  assert.equal(value.commandReady,false);
  assert.equal(value.keyState,'KEY_UNSUPPORTED_OR_PLACEHOLDER');
  assert.equal(value.machinery.CODE,'READY');
  assert.equal(value.sourceSha,'a'.repeat(40));
  assert.equal(calls,1);
  assert.doesNotMatch(JSON.stringify(value),/MUST_NOT_LEAK|providerToken/);
});

test('even a correctly shaped owner key is NOT authorization or job proof',async()=>{
  const value=await factoryDirectStatus({
    GO_FACTORY_RAIL_SECRET:'f'.repeat(64),
    FACTORY_DIRECT:mockBinding(async()=>Response.json(goodHealth()))
  });
  assert.equal(value.keyState,'KEY_PRESENT_NOT_AUTHENTICATED');
  assert.equal(value.authStatus,'FACTORY_AUTH_RESPONSE_INVALID');
  assert.equal(value.commandReady,false);
  assert.equal(value.readOnly,true);
});

test('absent binding, misleading 200, remote errors and extra parameters fail closed',async()=>{
  assert.equal((await factoryDirectStatus(baseEnv)).status,'SERVICE_BINDING_NOT_CONFIGURED');
  const wrong=await factoryDirectStatus({FACTORY_DIRECT:mockBinding(async()=>Response.json({status:'READY',service:'fake'}))});
  assert.equal(wrong.ok,false);assert.equal(wrong.status,'FACTORY_IDENTITY_MISMATCH');
  const down=await factoryDirectStatus({FACTORY_DIRECT:mockBinding(async()=>new Response('down',{status:503}))});
  assert.equal(down.status,'FACTORY_HTTP_ERROR');
  const fail=await factoryDirectStatus({FACTORY_DIRECT:mockBinding(async()=>{throw Error('private details');})});
  assert.equal(fail.status,'DIRECT_FACTORY_UNAVAILABLE');
  let called=false;
  const res=await mcp({...baseEnv,FACTORY_DIRECT:mockBinding(async()=>{called=true;return Response.json(goodHealth());})},
    'factory_direct_status',{workId:'try-to-dispatch'});
  assert.equal((await res.json()).result.isError,true);
  assert.equal(called,false);
});

test('auth probe MCP is read-only, owner-only and rejects authority arguments before binding',async()=>{
  const list=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',
    body:JSON.stringify({jsonrpc:'2.0',id:55,method:'tools/list'})}),baseEnv,ctx);
  const tool=(await list.json()).result.tools.find(x=>x.name==='factory_direct_auth_probe');
  assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);
  assert.equal(tool.annotations.destructiveHint,false);
  let calls=0;
  const env={...baseEnv,GO_FACTORY_RAIL_SECRET:'b'.repeat(64),
    FACTORY_DIRECT:mockBinding(async()=>{calls++;throw Error('unexpected call');})};
  assert.equal((await mcp(env,'factory_direct_auth_probe',{},{})).status,401);
  const extra=await mcp(env,'factory_direct_auth_probe',{approved:true});
  assert.equal((await extra.json()).result.isError,true);
  assert.equal(calls,0);
});
