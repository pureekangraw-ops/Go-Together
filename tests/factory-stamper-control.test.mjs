import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import worker from '../worker/index.js';
import {factoryKeyStamper} from '../worker/factory-direct.mjs';

const ROOT='https://go-together.pureekangraw.workers.dev';
const KEY='fixture-factory-go-rail-key-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123';
const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
const noOwner={};
const KEY_ID='a'.repeat(32);
const token='fsk1_'+KEY_ID+'.'+'b'.repeat(64);
function fixture(){
 const seen=[],env={
  ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',GO_FACTORY_RAIL_SECRET:KEY,
  DB:{prepare:()=>({first:async()=>({ok:true})})},
  ASSETS:{fetch:async()=>new Response('static file')},
  FACTORY_DIRECT:{fetch:async(request)=>{
   const path=new URL(request.url).pathname,text=await request.text();
   seen.push({path,text});
   const stamp=request.headers.get('x-metropolis-factory-timestamp');
   assert.equal(request.headers.get('x-factory-client'),'GO');
   assert.equal(request.headers.get('x-metropolis-factory-signature'),
    createHmac('sha256',KEY).update(stamp+'.'+text).digest('hex'));
   const body=JSON.parse(text);
   if(path==='/station/go-key-slots')return Response.json({ok:true,schema:'FACTORY_KEY_SLOTS_V1',
     slots:[],presets:[{preset:'VISUAL_RUNNER',name:'VISUAL Runner',scopes:['VISUAL:ASSET'],maxTtlSeconds:86400}]});
   if(path==='/station/go-key-register')return Response.json({ok:true,status:'SLOT_REGISTERED',
      slot:{slotId:body.slotId,recipient:body.recipient,preset:body.preset}});
   if(path==='/station/go-key-stamp')return Response.json({ok:true,status:'KEY_STAMPED',
     keyId:KEY_ID,receiptId:'stamp-'+KEY_ID,key:token,secretReturned:true,
     slotId:body.slotId,recipient:body.recipient,expiresAt:'2026-10-26T00:00:00Z'},{status:201});
   if(path==='/station/go-key-status')return Response.json({ok:true,status:'ACTIVE',
     keyId:KEY_ID,receiptId:'stamp-'+KEY_ID,slotId:'ATLAS_VISUAL',recipient:'ATLAS',secretReturned:false});
   if(path==='/station/go-key-revoke')return Response.json({ok:true,status:'KEY_REVOKED',
     keyId:KEY_ID,keyStatus:'REVOKED',secretReturned:false});
   return Response.json({ok:false,reason:'NOT_FOUND'},{status:404});
  }}
 };
 const post=(body,override={},owner=ctx)=>worker.fetch(new Request(ROOT+'/api/factory-stamper',{
  method:'POST',headers:{'content-type':'application/json','origin':ROOT,
   'x-factory-stamper-intent':'1',...override},body:JSON.stringify(body)}),env,owner);
 return {env,seen,post};
}
test('Owner page can list presets and use GO-signed Factory remote, no Brain D1 writes',async()=>{
 const f=fixture(),request=new Request(ROOT+'/api/factory-stamper');
 const r=await worker.fetch(request,f.env,ctx);
 assert.equal(r.status,200);
 const result=await r.json();
 assert.equal(result.ok,true);
 assert.equal(result.presets[0].preset,'VISUAL_RUNNER');
 assert.equal(f.seen[0].path,'/station/go-key-slots');
});
test('one-time key is delivered only to Access-authorized same-origin owner API',async()=>{
 const f=fixture();
 const args={action:'stamp',slotId:'ATLAS_VISUAL',recipient:'ATLAS',
  requestId:'123e4567-e89b-42d3-a456-426614174000',ttlSeconds:3600,approved:true};
 const denied=await f.post(args,{},noOwner);
 assert.equal(denied.status,401);
 const wrongOrigin=await f.post(args,{origin:'https://evil.invalid'});
 assert.equal(wrongOrigin.status,403);
 const missingHeader=await f.post(args,{'x-factory-stamper-intent':'0'});
 assert.equal(missingHeader.status,403);
 const unapproved=await f.post({...args,approved:false});
 assert.equal(unapproved.status,403);
 assert.equal(f.seen.length,0,'no upstream effect before authenticating owner');
 const good=await f.post(args);
 assert.equal(good.status,201);
 assert.equal(good.headers.get('cache-control'),'no-store');
 const out=await good.json();
 assert.equal(out.key,token);
 assert.equal(out.status,'KEY_STAMPED');
 assert.equal(f.seen[0].path,'/station/go-key-stamp');
 assert.equal(f.seen[0].text.includes(token),false,'GO only receives minted key in signed upstream response');
});
test('Registration and revocation remain bounded to approved owner actions',async()=>{
 const f=fixture();
 const created=await f.post({action:'register',slotId:'ATLAS_VISUAL',
   recipient:'ATLAS',preset:'VISUAL_RUNNER',description:'operator',approved:true});
 assert.equal(created.status,200);
 assert.equal((await created.json()).slot.slotId,'ATLAS_VISUAL');
 const revoked=await f.post({action:'revoke',keyId:KEY_ID,approved:true});
 assert.equal(revoked.status,200);
 assert.equal((await revoked.json()).status,'KEY_REVOKED');
 const status=await f.post({action:'status',keyId:KEY_ID});
 assert.equal((await status.json()).status,'ACTIVE');
 assert.deepEqual(f.seen.map(x=>x.path),['/station/go-key-register','/station/go-key-revoke','/station/go-key-status']);
});
test('GO fails closed on malformed one-time key response and transport errors',async()=>{
 const f=fixture();
 const broken={...f.env,FACTORY_DIRECT:{fetch:async()=>Response.json({ok:true,
   status:'KEY_STAMPED',key:'short',secretReturned:true,keyId:KEY_ID})}};
 const args={action:'stamp',slotId:'ATLAS_VISUAL',recipient:'ATLAS',requestId:
  '123e4567-e89b-42d3-a456-426614174000',approved:true};
 assert.equal((await factoryKeyStamper(broken,args)).status,'STAMP_RESPONSE_INTEGRITY_INVALID');
 const missing={...f.env,FACTORY_DIRECT:{fetch:async()=>{throw Error('network')}}};
 assert.equal((await factoryKeyStamper(missing,args)).status,'STAMP_TRANSPORT_UNCERTAIN');
 assert.equal((await factoryKeyStamper(f.env,{...args,approved:false})).status,'OWNER_APPROVAL_REQUIRED');
});

test('mobile slot-wheel HTML has parseable JS, owner API and no browser secret persistence',async()=>{
 const {readFile}=await import('node:fs/promises');
 const page=await readFile(new URL('../static/factory-key-stamper.html',import.meta.url),'utf8');
 assert.match(page,/name="viewport"/);
 assert.match(page,/id="dial"/);
 assert.match(page,/id="stampButton"/);
 assert.match(page,/id="registerButton"/);
 assert.match(page,/id="revokeButton"/);
 assert.match(page,/x-factory-stamper-intent/);
 assert.match(page,/fetch\('\/api\/factory-stamper'/);
 assert.doesNotMatch(page,/localStorage|sessionStorage|indexedDB/);
 assert.doesNotMatch(page,/GO_FACTORY_RAIL_SECRET|apiToken|secretKey/);
 const block=page.match(/<script type="module">([\s\S]*?)<\/script>/);
 assert.ok(block?.[1],'operator script present');
 assert.doesNotThrow(()=>new Function(block[1]),'operator script compiles');
});

test('non-issuance responses cannot disclose one-time token material',async()=>{
 const f=fixture();
 for(const action of ['list','register','status','revoke']){
  const env={...f.env,FACTORY_DIRECT:{fetch:async()=>Response.json({ok:true,status:'ACTIVE',key:token,secretReturned:true})}};
  const result=await factoryKeyStamper(env,{action,keyId:KEY_ID,approved:true});
  assert.equal(result.status,'STAMP_RESPONSE_INTEGRITY_INVALID');
  assert.equal(JSON.stringify(result).includes(token),false);
 }
});

test('Stamper projects nested operation metadata instead of forwarding unknown fields',async()=>{
 const f=fixture(),hidden={key:token};
 const slot={slotId:'ATLAS_VISUAL',preset:'VISUAL_RUNNER',recipient:'ATLAS',scopes:['VISUAL:ASSET'],maxTtlSeconds:86400,receipt:hidden};
 const samples=[
  ['status',{status:'ACTIVE',keyId:KEY_ID,secretReturned:false,receipt:hidden}],
  ['revoke',{status:'KEY_REVOKED',keyId:KEY_ID,secretReturned:false,receipt:hidden}],
  ['register',{status:'SLOT_REGISTERED',slot,receipt:hidden}],
  ['list',{slots:[slot],presets:[{preset:'VISUAL_RUNNER',name:'Visual',scopes:['VISUAL:ASSET'],maxTtlSeconds:86400,receipt:hidden}],receipt:hidden}],
  ['stamp',{status:'ALREADY_STAMPED',keyId:KEY_ID,secretReturned:false,receipt:hidden}],
 ];
 for(const [action,payload] of samples){
  const env={...f.env,FACTORY_DIRECT:{fetch:async()=>Response.json({ok:true,debug:token,...payload})}};
  const out=await factoryKeyStamper(env,{action,approved:true,keyId:KEY_ID});
  assert.equal(out.ok,true);assert.equal(JSON.stringify(out).includes(token),false);
  assert.equal('receipt' in out,false);assert.equal('debug' in out,false);
  if(out.slot)assert.equal('receipt' in out.slot,false);
  if(out.slots)assert.equal('receipt' in out.slots[0],false);
  if(out.presets)assert.equal('receipt' in out.presets[0],false);
 }
});
test('Stamper rejects nested values in known scalar fields and bounds failure reasons',async()=>{
 const f=fixture();
 for(const payload of [{ok:true,status:'ACTIVE',keyId:{key:token}},
   {ok:true,status:'ACTIVE',keyId:KEY_ID,recipient:{key:token}},
   {ok:true,status:'ACTIVE',keyId:KEY_ID,scopes:[{key:token}]},
   {ok:false,status:token,debug:token,receipt:{key:token}},
   {ok:false,reason:{key:token}},{ok:false,reason:token},{ok:false,reason:'STAMP_'+ 'X'.repeat(1000)}]){
  const env={...f.env,FACTORY_DIRECT:{fetch:async()=>Response.json(payload)}};
  const out=await factoryKeyStamper(env,{action:'status',keyId:KEY_ID});
  assert.equal(out.ok,false);assert.equal(JSON.stringify(out).includes(token),false);
  if(out.reason)assert.ok(out.reason.length<=80);
 }
});
test('only validated first issuance exposes the top-level one-time key',async()=>{
 const f=fixture();
 const payload={ok:true,status:'KEY_STAMPED',keyId:KEY_ID,key:token,secretReturned:true,receipt:{key:token}};
 const env={...f.env,FACTORY_DIRECT:{fetch:async()=>Response.json(payload)}};
 const out=await factoryKeyStamper(env,{action:'stamp',approved:true});
 assert.equal(out.key,token);assert.equal('receipt' in out,false);
});

test('private Stamper probe keeps bearer in fixed binding request and projects evidence',async()=>{
 const f=fixture();let calls=0;
 const env={...f.env,FACTORY_DIRECT:{fetch:async request=>{
  calls++;assert.equal(request.url,'https://factory-district.internal/station/key-probe');
  assert.equal(request.headers.get('authorization'),'Bearer '+token);
  assert.equal(request.redirect,'manual');assert.deepEqual(await request.json(),{recipient:'ATLAS',scope:'VISUAL:ASSET'});
  return Response.json({ok:true,status:'KEY_ACCEPTED',keyId:KEY_ID,recipient:'ATLAS',scope:'VISUAL:ASSET',expiresAt:'2026-10-26T00:00:00Z',debug:token});
 }}};
 const args={action:'probe',key:token,recipient:'ATLAS',scope:'VISUAL:ASSET'};
 const result=await factoryKeyStamper(env,args);assert.equal(result.accepted,true);assert.equal(JSON.stringify(result).includes(token),false);
 assert.equal((await factoryKeyStamper(env,{...args,url:'https://outside.invalid'})).ok,false);assert.equal(calls,1);
 for(const scope of ['DEPLOY:CODE','ROOT'])assert.equal((await factoryKeyStamper(env,{...args,scope})).ok,false);
 for(const [status,payload] of [[403,{status:'KEY_REJECTED',key:token}],[302,{ok:true,status:'KEY_ACCEPTED'}],[200,{ok:true,status:'KEY_ACCEPTED',keyId:'b'.repeat(32),recipient:'ATLAS',scope:'VISUAL:ASSET',expiresAt:'2026-10-26'}]]){
  env.FACTORY_DIRECT.fetch=async()=>Response.json(payload,{status});const out=await factoryKeyStamper(env,args);
  assert.notEqual(out.accepted,true);assert.equal(JSON.stringify(out).includes(token),false);
 }
 env.FACTORY_DIRECT.fetch=async()=>{throw Error(token);};
 assert.deepEqual(await factoryKeyStamper(env,args),{ok:false,status:'STAMP_PROBE_UNAVAILABLE',executed:false});
});

test('owner probe route allows exact private probe and denies unauthenticated/cross-origin dispatch',async()=>{
 const f=fixture();let calls=0;
 f.env.HUB_V2={relay(){throw Error('NO_HUB_PROBE');}};
 f.env.FACTORY_DIRECT={fetch:async req=>{
  calls++;assert.equal(req.url,'https://factory-district.internal/station/key-probe');
  assert.equal(req.headers.get('authorization'),'Bearer '+token);
  assert.deepEqual(await req.json(),{recipient:'ATLAS',scope:'FACTORY:STATUS'});
  return Response.json({ok:true,status:'KEY_ACCEPTED',keyId:KEY_ID,recipient:'ATLAS',scope:'FACTORY:STATUS',expiresAt:'2026-10-26T00:00:00Z'});
 }};
 const args={action:'probe',key:token,recipient:'ATLAS',scope:'FACTORY:STATUS'};
 assert.equal((await f.post(args,{},noOwner)).status,401);
 assert.equal((await f.post(args,{origin:'https://other.example.test'})).status,403);
 assert.equal((await f.post(args,{'x-factory-stamper-intent':''})).status,403);
 assert.equal(calls,0);
 const r=await f.post(args);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
 const out=await r.json();assert.equal(out.accepted,true);assert.equal(out.executed,false);assert.equal(JSON.stringify(out).includes(token),false);assert.equal(calls,1);
 assert.equal((await f.post({...args,url:'https://other.example.test'})).status,400);assert.equal(calls,1);
});
