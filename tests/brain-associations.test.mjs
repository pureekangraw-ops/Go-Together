import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase,seed} from './brain-test-db.mjs';
import {processAssociation,drainAssociations} from '../worker/brain-associations.mjs';
import {keywordFinder,associationStatus} from '../worker/brain-keywords.mjs';
const evidence={field:'content',quote:'Beaver/บีเวอร์'};
function output(relations=[]){return {intents:[{label:'role agreement',evidence}],entities:[{label:'Beaver',evidence,aliases:[{label:'บีเวอร์',evidence}]}],keywords:[{label:'Beaver',evidence}],relations};}
const response=data=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(data)}]}],usage:{input_tokens:100,output_tokens:60}});
function environment(DB){return {DB,BRAIN_ASSOCIATIONS_ENABLED:'true',BRAIN_ASSOCIATION_MODEL:'gpt-4.1-mini-2025-04-14',BRAIN_ASSOCIATION_API_KEY:{get:async()=> 'sk-synthetic-not-real'}};}
test('one extraction grounds aliases and links, preserves source, and deduplicates processing',async t=>{
 const s=testDatabase();t.after(s.close);const id=seed(s.sql),target=seed(s.sql,{title:'Beaver archive',content:'Beaver/บีเวอร์ reference'});let calls=0;
 const before=s.sql.prepare('SELECT * FROM memories WHERE id=?').get(id);let request;
 const requester=async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');request=JSON.parse(init.body);return response(output([{target_id:target,target_revision:1,type:'related',evidence,target_evidence:evidence}]));};
 const result=await processAssociation(environment(s.DB),{id,expected_revision:1},{requester});assert.equal(result.state,'ready');assert.equal(calls,1);
 assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.equal(request.tools,undefined);
 assert.equal((await keywordFinder(s.DB,{query:'บีเวอร์'})).items[0].matches[0].provenance,'ai_suggested');
 const found=await keywordFinder(s.DB,{query:'บีเวอร์'});assert.ok(found.items[0].paths.some(p=>p.label==='Beaver'));
 assert.equal(found.items[0].relations[0].target_id,target);
 assert.deepEqual(s.sql.prepare('SELECT * FROM memories WHERE id=?').get(id),before);
 await processAssociation(environment(s.DB),{id,expected_revision:1},{requester});assert.equal(calls,1);
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM history WHERE memory_id=?').get(id).n,1);
});
test('concurrent processing leases a revision once',async t=>{
 const s=testDatabase();t.after(s.close);const id=seed(s.sql);let calls=0;
 const requester=async()=>{calls++;return response(output());};
 await Promise.all(Array.from({length:4},()=>processAssociation(environment(s.DB),{id,expected_revision:1},{requester})));
 assert.equal(calls,1);assert.equal((await associationStatus(s.DB,id)).state,'ready');
});
test('edit or delete while API is running prevents stale publication',async t=>{
 for(const status of ['active','deleted']){
  const s=testDatabase();t.after(s.close);const id=seed(s.sql);
  const requester=async()=>{s.sql.prepare('UPDATE memories SET content=?,status=?,revision=2 WHERE id=?').run('new content',status,id);return response(output());};
  await processAssociation(environment(s.DB),{id,expected_revision:1},{requester});
  assert.equal((await keywordFinder(s.DB,{query:'บีเวอร์',status:'all'})).count,0);
  assert.equal(s.sql.prepare("SELECT COUNT(*) AS n FROM brain_memory_terms WHERE provenance='ai_suggested'").get().n,0);
 }
});
test('target changes invalidate the complete proposed publication',async t=>{
 const s=testDatabase();t.after(s.close);const id=seed(s.sql),target=seed(s.sql,{content:'Beaver/บีเวอร์ reference'});
 const requester=async()=>{s.sql.prepare('UPDATE memories SET revision=2 WHERE id=?').run(target);return response(output([{target_id:target,target_revision:1,type:'related',evidence,target_evidence:evidence}]));};
 const result=await processAssociation(environment(s.DB),{id,expected_revision:1},{requester});assert.equal(result.state,'failed');assert.equal(result.last_error,'target_revision_changed');
 assert.equal((await keywordFinder(s.DB,{query:'บีเวอร์'})).count,0);
});
test('provider failures are sanitized, durable and require explicit retry',async t=>{
 const s=testDatabase();t.after(s.close);const id=seed(s.sql);let calls=0;
 const requester=async()=>{calls++;return new Response('private provider body sk-never-echo',{status:429});};
 let result=await processAssociation(environment(s.DB),{id,expected_revision:1},{requester});
 assert.equal(result.state,'failed');assert.equal(result.last_error,'provider_http_429');
 await processAssociation(environment(s.DB),{id,expected_revision:1},{requester});assert.equal(calls,1);
 result=await processAssociation(environment(s.DB),{id,expected_revision:1,retry_failed:true},{requester:async()=>{calls++;return response(output());}});
 assert.equal(calls,2);assert.equal(result.state,'ready');
});
test('unproven quotes, fabricated targets and malformed/refused output never enter Finder',async t=>{
 for(const value of [{...output(),keywords:[{label:'invented',evidence:{field:'content',quote:'not in source'}}]},output([{target_id:'imaginary',target_revision:1,type:'supersedes',evidence,target_evidence:evidence}]),{...output(),extra:'unwanted'}]){
  const s=testDatabase();t.after(s.close);const id=seed(s.sql);
  const result=await processAssociation(environment(s.DB),{id,expected_revision:1},{requester:async()=>response(value)});
  assert.equal(result.state,'failed');assert.equal(result.last_error,'invalid_association_output');assert.equal((await keywordFinder(s.DB,{query:'บีเวอร์'})).count,0);
 }
});
test('missing binding never calls provider and source/search remain available',async t=>{
 const s=testDatabase();t.after(s.close);const id=seed(s.sql);let calls=0;
 const result=await processAssociation({DB:s.DB,BRAIN_ASSOCIATIONS_ENABLED:'true'},{id,expected_revision:1},{requester:async()=>{calls++;return response(output());}});
 assert.equal(result.state,'failed');assert.equal(result.last_error,'secret_binding_unavailable');assert.equal(calls,0);
 assert.equal((await keywordFinder(s.DB,{query:'beaver'})).count,1);
});
test('drain processes only bounded current pending jobs and skips failed/historical revisions',async t=>{
 const s=testDatabase();t.after(s.close);const a=seed(s.sql),b=seed(s.sql),c=seed(s.sql);let calls=0;
 s.sql.prepare("UPDATE brain_association_runs SET state='failed' WHERE memory_id=?").run(a);
 s.sql.prepare("UPDATE memories SET status='deleted',revision=2 WHERE id=?").run(b);
 await drainAssociations(environment(s.DB),{requester:async()=>{calls++;return response(output());},limit:1});
 assert.equal(calls,1);assert.equal((await associationStatus(s.DB,c)).state,'ready');assert.equal((await associationStatus(s.DB,a)).state,'failed');
});

test('late expired worker cannot erase a successor lease publication',async t=>{
 const s=testDatabase();t.after(s.close);
 const id=seed(s.sql),target=seed(s.sql,{content:'Beaver/บีเวอร์ reference'});
 const relation={target_id:target,target_revision:1,type:'related',evidence,target_evidence:evidence};
 let notifyOld,releaseOld;
 const oldRequested=new Promise(resolve=>{notifyOld=resolve;});
 const old=processAssociation(environment(s.DB),{id,expected_revision:1},{requester:async()=>{
  notifyOld();
  return new Promise(resolve=>{releaseOld=()=>resolve(response(output([relation])));});
 }});
 await oldRequested;
 // Simulate a crashed/delayed Worker whose lease expires while its API call is pending.
 s.sql.prepare("UPDATE brain_association_runs SET lease_until='2000-01-01T00:00:00.000Z' WHERE memory_id=?").run(id);
 const newer=await processAssociation(environment(s.DB),{id,expected_revision:1},
  {requester:async()=>response(output([relation]))});
 assert.equal(newer.state,'ready');
 const aiCount=()=>s.sql.prepare("SELECT COUNT(*) AS n FROM brain_memory_terms WHERE memory_id=? AND provenance='ai_suggested'").get(id).n;
 const linkCount=()=>s.sql.prepare("SELECT COUNT(*) AS n FROM brain_memory_links l JOIN brain_association_runs r ON l.run_id=r.id WHERE r.memory_id=?").get(id).n;
 const publishedTerms=aiCount();
 assert.ok(publishedTerms>0);
 assert.equal(linkCount(),1);
 releaseOld();
 await old;
 assert.equal((await associationStatus(s.DB,id)).state,'ready');
 assert.equal(aiCount(),publishedTerms,'old lease must not erase new indexed terms');
 assert.equal(linkCount(),1,'old lease must not erase new relation');
});

test('expired running lease recovers, but active running job is not restarted',async t=>{
 const s=testDatabase();t.after(s.close);
 const expired=seed(s.sql),inFlight=seed(s.sql);
 s.sql.prepare("UPDATE brain_association_runs SET state='running',lease_token='old-lease',lease_until='2000-01-01T00:00:00.000Z' WHERE memory_id=?").run(expired);
 s.sql.prepare("UPDATE brain_association_runs SET state='running',lease_token='live-lease',lease_until='2099-01-01T00:00:00.000Z' WHERE memory_id=?").run(inFlight);
 let calls=0;
 const result=await drainAssociations(environment(s.DB),{requester:async()=>{calls++;return response(output());},limit:5});
 assert.equal(result.processed,1);
 assert.equal(calls,1);
 assert.equal((await associationStatus(s.DB,expired)).state,'ready');
 assert.equal((await associationStatus(s.DB,inFlight)).state,'running');
});
