import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{appMcp} from '../worker/index.js';
import {probeStoredReference,checkReferenceById,auditReferences} from '../worker/brain-reference-health.mjs';

const ID='11111111-1111-4111-8111-111111111111';
const rec=(url='https://github.com/pureekangraw-ops/Go-Together/pull/29')=>({
 id:ID,title:'Stored reference',revision:4,status:'active',evidence_url:url
});
const now=()=> '2026-10-27T00:00:00Z';
const fake=(status,location=null)=>({
 status,headers:{get:(k)=>k.toLowerCase()==='location'?location:null},
 body:{cancel:async()=>{}}
});
test('safe stored GitHub reference reaches HTTP without claiming content verified',async()=>{
 let called=0;
 const x=await probeStoredReference(rec(),{now,fetchImpl:async(url,options)=>{
  called++;assert.equal(url,rec().evidence_url);assert.equal(options.method,'HEAD');
  assert.equal(options.redirect,'manual');assert.equal(options.referrerPolicy,'no-referrer');
  return fake(200);
 }});
 assert.equal(called,1);assert.equal(x.status,'HTTP_REACHABLE_NOT_CONTENT_VERIFIED');
 assert.equal(x.record_revision,4);assert.equal(x.link_host,'github.com');
 assert.equal(x.content_verified,false);assert.equal(x.provider_authorization_verified,false);
 assert.equal(x.checked_at,now());assert.equal(x.method,'HEAD');
 assert.equal(Object.hasOwn(x,'evidence_url'),false,'do not echo URL queries into output');
});
test('HEAD unsupported falls back once to small GET without following redirect',async()=>{
 const methods=[];
 const x=await probeStoredReference(rec('https://drive.google.com/file/d/abc/view?usp=drivesdk'),{now,fetchImpl:async(_url,opt)=>{
  methods.push(opt.method);
  if(opt.method==='HEAD')return fake(405);
  assert.equal(opt.headers.Range,'bytes=0-0');assert.equal(opt.redirect,'manual');
  return fake(302,'https://accounts.google.com/login');
 }});
 assert.deepEqual(methods,['HEAD','GET']);
 assert.equal(x.status,'REDIRECT_NOT_VERIFIED');assert.equal(x.redirected_to_host,'accounts.google.com');
 assert.equal(x.content_verified,false);
});
test('HTTP not-found and access denied never assert file missing or private access',async()=>{
 for(const [n,want] of [[403,'AUTH_REQUIRED_OR_BLOCKED'],[404,'NOT_FOUND_OR_PRIVATE'],[410,'GONE_REPORTED'],[429,'RATE_LIMITED'],[503,'UPSTREAM_UNAVAILABLE']]){
  const x=await probeStoredReference(rec(),{now,fetchImpl:async()=>fake(n)});
  assert.equal(x.status,want);assert.equal(x.http_status,n);
  assert.equal(x.content_verified,false);
 }
});
test('rejects unsafe targets before network: not an SSRF fetch proxy',async()=>{
 const refs=[
 'http://github.com/owner/repo',
 'https://localhost/secret',
 'https://169.254.169.254/latest/meta-data',
 'https://github.com.evil.example/repo',
 'https://user:pw@github.com/repo',
 'https://github.com:8443/repo',
 'https://github.com/repo?access_token=mySecret',
 'file:///private/secret'
 ];
 for(const u of refs){
  const x=await probeStoredReference(rec(u),{now,fetchImpl:async()=>{throw Error('SHOULD_NOT_FETCH');}});
  assert.ok(['UNSUPPORTED_OR_UNSAFE_URL','SENSITIVE_QUERY_NOT_PROBED'].includes(x.status),u);
 }
});
test('no reference, deleted record and fetch exceptions report unknown/not-applicable, no hallucination',async()=>{
 assert.equal((await probeStoredReference(rec(''),{now})).status,'NO_REFERENCE');
 assert.equal((await probeStoredReference({...rec(),status:'deleted'},{now})).status,'INACTIVE_RECORD');
 const failed=await probeStoredReference(rec(),{now,fetchImpl:async()=>{throw Error('network');}});
 assert.equal(failed.status,'NETWORK_UNVERIFIED');assert.equal(failed.http_status,null);
 assert.equal((await probeStoredReference(null,{now})).status,'RECORD_NOT_FOUND');
});
function db(rows){
 let queries=0;
 const fixture={
  prepare(sql){queries++;return {
   bind(...args){this.args=args;return this;},
   async first(){const id=this.args?.[0];return rows.find(m=>m.id===id)||null;},
   async all(){return {results:rows.slice(0,this.args?.[0]??rows.length)};}
  };},
  get queries(){return queries;}
 };
 return fixture;
}
test('exact-reference checker wraps record by ID; missing ID is explicit',async()=>{
 const d=db([rec()]);const f=async()=>fake(200);
 const checked=await checkReferenceById(d,ID,{fetchImpl:f,now});
 assert.equal(checked.type,'go_brain_reference_health_v1');
 assert.equal(checked.result.record_id,ID);assert.equal(checked.result.record_revision,4);
 assert.equal(checked.result.status,'HTTP_REACHABLE_NOT_CONTENT_VERIFIED');
 const absent=await checkReferenceById(d,'22222222-2222-4222-8222-222222222222',{fetchImpl:f,now});
 assert.equal(absent.result.status,'RECORD_NOT_FOUND');
 await assert.rejects(checkReferenceById(d,'bad-id',{fetchImpl:f}),/invalid_record_id/);
});
test('bounded audit checks at most five stored references and never updates DB',async()=>{
 const rows=Array.from({length:6},(_,i)=>({
  ...rec(),id:`0000000${i}-0000-4000-8000-000000000000`
 }));
 const d=db(rows);
 const x=await auditReferences(d,5,{fetchImpl:async()=>fake(200),now});
 assert.equal(x.checked,5);assert.equal(x.results.length,5);
 assert.equal(x.results[0].status,'HTTP_REACHABLE_NOT_CONTENT_VERIFIED');
 await assert.rejects(auditReferences(d,6),/invalid_audit_limit/);
});
const ROOT='https://go-together.pureekangraw.workers.dev';
const ownerContext={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
test('owner-only HTTP and brain MCP expose status for empty references without network request',async()=>{
 const fixture=rec(''),d=db([fixture]);
 const env={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',DB:d,ASSETS:{fetch:async()=>new Response('unused')}};
 const req=()=>new Request(ROOT+'/api/references/check?id='+ID);
 const forbidden=await worker.fetch(req(),env,{});
 assert.equal(forbidden.status,401);assert.equal(d.queries,0);
 const allowed=await worker.fetch(req(),env,ownerContext);
 assert.equal(allowed.status,200);assert.equal((await allowed.json()).result.status,'NO_REFERENCE');
 const malformed=await worker.fetch(new Request(ROOT+'/api/references/check?id=invalid'),env,ownerContext);
 assert.equal(malformed.status,400);
 const call=new Request(ROOT+'/hub-mcp/brain',{method:'POST',body:JSON.stringify({
  jsonrpc:'2.0',id:1,method:'tools/call',
  params:{name:'brain_reference_check',arguments:{id:ID}}
 })});
 const result=await appMcp(call,env);
 assert.equal(result.status,200);
 const rpc=await result.json();
 assert.equal(JSON.parse(rpc.result.content[0].text).result.status,'NO_REFERENCE');
 const audit=await appMcp(new Request(ROOT+'/hub-mcp/brain',{method:'POST',body:JSON.stringify({
  jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'brain_reference_audit',arguments:{limit:1}}
 })}),env);
 assert.equal((await audit.json()).result.content[0].type,'text');
});
