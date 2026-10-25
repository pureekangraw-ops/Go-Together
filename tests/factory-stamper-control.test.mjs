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
