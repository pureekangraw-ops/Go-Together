import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from './brain-test-db.mjs';
import worker from '../worker/brain-standalone.mjs';

const ROOT='https://go-together.pureekangraw.workers.dev';
const auth={access:{aud:'test-aud',getIdentity:async()=>({email:'owner@example.test'})}};
function setup(enabled='true'){
 const store=testDatabase(),jobs=[];
 const env={DB:store.DB,BRAIN_AUTH_MODE:'ACCESS',OWNER_EMAIL:'owner@example.test',
  ACCESS_AUD:'test-aud',BRAIN_ASSOCIATIONS_ENABLED:enabled};
 const ctx={...auth,waitUntil(p){jobs.push(p);}};
 async function invoke(name,args={},context=ctx){
  const response=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env,context);
  const data=await response.json();const result=data.result;
  return result?.isError?{error:result.content[0].text}:JSON.parse(result.content[0].text);
 }
 return {store,env,ctx,jobs,invoke};
}
test('standalone exposes independent Finder and Association operations without other tools',async()=>{
 const s=setup();try{
  const response=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),s.env,s.ctx);
  const tools=(await response.json()).result.tools.map(x=>x.name);
  for(const name of ['brain_keyword_finder','brain_association_status','brain_association_process','brain_card'])
   assert.ok(tools.includes(name),name);
  assert.ok(tools.every(x=>x.startsWith('brain_')));
 }finally{s.store.close();}
});
test('one save succeeds despite missing provider binding; association failure remains separate',async()=>{
 const s=setup();try{
  const saved=await s.invoke('brain_save',{title:'Beaver',content:'Beaver/บีเวอร์',tags:['Beaver']});
  assert.equal(saved.error,undefined);assert.equal(saved.revision,1);
  assert.equal(s.jobs.length,1);
  await Promise.all(s.jobs);
  const card=await s.invoke('brain_card',{id:saved.id});
  assert.equal(card.source.content,'Beaver/บีเวอร์');
  assert.equal(card.association.state,'failed');
  assert.equal(card.association.last_error,'secret_binding_unavailable');
  const found=await s.invoke('brain_keyword_finder',{query:'Beaver'});
  assert.equal(found.items[0].memory_id,saved.id);
  assert.ok(found.items[0].matches.some(x=>x.provenance==='GO_supplied'));
  assert.equal((await s.invoke('brain_history',{id:saved.id})).items.length,1);
 }finally{s.store.close();}
});
test('association disabled never schedules API; manual status remains pending',async()=>{
 const s=setup('false');try{
  const saved=await s.invoke('brain_save',{title:'Beaver',content:'Beaver/บีเวอร์',tags:['Beaver']});
  assert.equal(saved.error,undefined);assert.equal(s.jobs.length,0);
  const status=await s.invoke('brain_association_status',{id:saved.id});
  assert.equal(status.state,'pending');
 }finally{s.store.close();}
});
test('scheduled drain never invokes when API secret is not attached',async()=>{
 const s=setup();try{
  await worker.scheduled({},s.env,s.ctx);
  assert.equal(s.jobs.length,0);
 }finally{s.store.close();}
});
