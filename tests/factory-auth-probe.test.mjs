import test from 'node:test';
import assert from 'node:assert/strict';
import {factoryDirectAuthProbe,factoryDirectStatus,factoryDirectSubmit} from '../worker/factory-direct.mjs';
const KEY='fixture-opaque-key!0123456789+abcdefgh/ABCDEFGHIJK',SHA='a'.repeat(40);
const health={service:'factory-district',stationId:'FACTORY-STATION',sourceSha:SHA,
  status:'READY',storage:{status:'READY'},transport:{status:'READY'},machinery:{CODE:{status:'READY'}}};
async function proof(request,{sha=SHA,key=KEY}={}){
  const body=await request.text(),input=JSON.parse(body);
  const hmac=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),
    {name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  assert.equal(await crypto.subtle.verify('HMAC',hmac,
    Buffer.from(request.headers.get('x-metropolis-factory-signature'),'hex'),
    new TextEncoder().encode(request.headers.get('x-metropolis-factory-timestamp')+'.'+body)),true);
  assert.equal(input.purpose,'GO_FACTORY_AUTH_PROBE_V1');
  assert.match(input.nonce,/^[a-f0-9]{32}$/);
  const message=input.purpose+'\n'+input.nonce+'\n'+sha+'\nFACTORY-STATION';
  return {status:'AUTHENTICATED',service:'factory-district',stationId:'FACTORY-STATION',
    sourceSha:sha,nonce:input.nonce,readOnly:true,executed:false,
    proof:Buffer.from(await crypto.subtle.sign('HMAC',hmac,new TextEncoder().encode(message))).toString('hex')};
}
function fixture(responder){
  const paths=[];
  return {paths,env:{GO_FACTORY_RAIL_SECRET:KEY,FACTORY_DIRECT:{fetch:async request=>{
    const path=new URL(request.url).pathname;paths.push(path);
    if(path==='/health')return Response.json(health);
    assert.equal(path,'/station/go-auth-probe','failure must never dispatch or write');
    return responder(request);
  }}}};
}
const errors=[
  ['key configuration',()=>Response.json({reason:'GO_FACTORY_RAIL_KEY_NOT_CONFIGURED'},{status:503}),'FACTORY_GO_KEY_NOT_CONFIGURED'],
  ['storage configuration',()=>Response.json({reason:'DURABLE_STORAGE_NOT_CONFIGURED'},{status:503}),'FACTORY_STORAGE_NOT_CONFIGURED'],
  ['unknown reason',()=>Response.json({reason:'private-provider-details'},{status:503}),'FACTORY_AUTH_PROBE_REJECTED'],
  ['malformed error',()=>new Response('private-provider-details',{status:503}),'FACTORY_AUTH_PROBE_REJECTED'],
  ['oversized error',()=>new Response(JSON.stringify({reason:'GO_FACTORY_RAIL_KEY_NOT_CONFIGURED',private:'x'.repeat(4096)}),{status:503}),'FACTORY_AUTH_PROBE_REJECTED'],
  ['missing route',()=>new Response('',{status:404}),'FACTORY_AUTH_PROBE_NOT_DEPLOYED'],
  ['signature rejected',()=>new Response('',{status:401}),'FACTORY_SIGNATURE_REJECTED'],
  ['source drift',async r=>Response.json(await proof(r,{sha:'b'.repeat(40)})),'FACTORY_AUTH_SOURCE_MISMATCH'],
  ['wrong proof',async r=>Response.json({...await proof(r),proof:'0'.repeat(64)}),'FACTORY_AUTH_PROOF_MISMATCH'],
  ['wrong nonce',async r=>Response.json({...await proof(r),nonce:'0'.repeat(32)}),'FACTORY_AUTH_RESPONSE_INVALID'],
  ['malformed success',()=>new Response('private-provider-details'),'FACTORY_AUTH_RESPONSE_INVALID'],
  ['oversized success',()=>new Response('x'.repeat(4097)),'FACTORY_AUTH_RESPONSE_INVALID']
];
for(const [name,responder,expected] of errors)test(name+' is explicit, sanitized and blocks dispatch',async()=>{
  const f=fixture(responder);
  const status=await factoryDirectStatus(f.env);
  assert.equal(status.commandReady,false);
  assert.equal(status.authStatus,expected);
  const result=await factoryDirectSubmit(f.env,{domain:'CODE',spec:{},
    requestId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    workId:'c4cbf25b-5e8a-4c8d-a0c3-fad94d92e07e',
    checkpointId:'checkpoint-original-go-work'},true);
  assert.equal(result.status,'GO_FACTORY_AUTH_NOT_READY');
  assert.equal(result.authStatus,expected);
  assert.equal(result.executed,false);
  assert.deepEqual(f.paths,['/health','/station/go-auth-probe','/health','/station/go-auth-probe']);
  assert.doesNotMatch(JSON.stringify({status,result}),/private-provider-details|fixture-opaque-key/);
});
test('valid opaque-key proof uses fresh nonces and returns no proof or secret',async()=>{
  const nonces=[];
  const f=fixture(async r=>{const data=await proof(r);nonces.push(data.nonce);return Response.json(data);});
  const first=await factoryDirectAuthProbe(f.env),second=await factoryDirectStatus(f.env);
  assert.equal(first.authenticated,true);assert.equal(first.executed,false);
  assert.equal(first.readOnly,true);assert.equal(first.commandReady,false);
  assert.equal(second.commandReady,true);assert.equal(second.authStatus,'AUTHENTICATED');
  assert.equal(second.keyState,'AUTHENTICATED');assert.notEqual(nonces[0],nonces[1]);
  assert.equal(Object.hasOwn(first,'proof'),false);assert.equal(Object.hasOwn(first,'nonce'),false);
  assert.doesNotMatch(JSON.stringify({first,second}),/fixture-opaque-key/);
});
test('oversized streaming error is cancelled before reading its remaining content',async()=>{
  let cancelled=false,pulls=0;
  const f=fixture(()=>new Response(new ReadableStream({
    pull(controller){pulls++;controller.enqueue(new Uint8Array(4097));},
    cancel(){cancelled=true;}
  },{highWaterMark:0}),{status:503}));
  const result=await factoryDirectAuthProbe(f.env);
  assert.equal(result.status,'FACTORY_AUTH_PROBE_REJECTED');
  assert.equal(cancelled,true);assert.equal(pulls,1);
});
