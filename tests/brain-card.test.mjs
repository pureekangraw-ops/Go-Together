import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './hub-fixture.mjs';
import standalone from '../worker/brain-standalone.mjs';

const ROOT='https://go-together.pureekangraw.workers.dev';
const owner={access:{aud:'test-aud',getIdentity:async()=>({email:'owner@example.test'})}};
function setup(target=worker){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 let beforeUpdate=null,afterUpdate=null;
 const metrics=[];
 const DB={prepare(query){let args=[];const statement=sql.prepare(query);
  function execute(mode){
   const update=query.startsWith('UPDATE memories SET');
   if(update&&beforeUpdate){const hook=beforeUpdate;beforeUpdate=null;hook();}
   const previous=sql.prepare('SELECT total_changes() AS n').get().n;
   const result=statement[mode](...args);
   // D1 reports sqlite3_total_changes(), including history-trigger inserts.
   const changes=sql.prepare('SELECT total_changes() AS n').get().n-previous;
   if(update){metrics.push(changes);if(afterUpdate){const hook=afterUpdate;afterUpdate=null;hook();}}
   return {result,changes};
  }
  return {bind(...values){args=values;return this;},async first(){return execute('get').result||null;},async all(){return {results:execute('all').result};},async run(){return {meta:{changes:execute('run').changes}};}};
 }};
 const env={DB,BRAIN_AUTH_MODE:'ACCESS',ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',ACCESS_AUD:'test-aud',OWNER_EMAIL:'owner@example.test'};
 const api=async(path,method='GET',body)=>{
  const response=await target.fetch(new Request(ROOT+path,{method,...(body?{body:JSON.stringify(body)}:{})}),env,owner);
  return {status:response.status,data:await response.json()};
 };
 const invoke=async(name,args)=>{
  const response=await api('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
  const out=response.data.result;
  return out.isError?{error:out.content[0].text}:JSON.parse(out.content[0].text);
 };
 return {sql,metrics,api,invoke,before(fn){beforeUpdate=fn;},after(fn){afterUpdate=fn;}};
}



const metadata={context:'Beaver role agreement',work_status:'design_pending',effective_at:'2026-11-12',source_verified_at:null,source_refs:[{locator:'user://owner-agreement',revision:null}]};
test('card preserves exact source and separates lifecycle, work state and source time',async t=>{
 const s=setup();t.after(()=>s.sql.close());
 const saved=await s.invoke('brain_save',{title:'Beaver',content:'Source text',metadata});
 assert.equal(saved.error,undefined);
 const card=await s.invoke('brain_card',{id:saved.id});
 assert.equal(card.schema,'go-brain/memory-card/v1');
 assert.equal(card.source.content,'Source text');assert.equal(card.revision,1);
 assert.equal(card.lifecycle_status,'active');assert.equal(card.work_status,'design_pending');
 assert.equal(card.time.effective_at,'2026-11-12');assert.equal(card.time.source_updated_at,null);
 assert.equal(card.source.evidence_url,'');assert.equal(card.confidence,'unknown');
 assert.equal(card.time.memory_updated_at,saved.updated_at);
 assert.equal((await s.invoke('brain_history',{id:saved.id})).items.length,1);
});
test('metadata edits and status transitions preserve revisioned history',async t=>{
 const s=setup();t.after(()=>s.sql.close());
 const saved=await s.invoke('brain_save',{title:'Beaver',content:'original',metadata});
 const edited=await s.invoke('brain_edit',{id:saved.id,expected_revision:1,metadata:{...metadata,work_status:'completed'}});
 assert.equal(edited.revision,2);
 const stale=await s.invoke('brain_edit',{id:saved.id,expected_revision:1,metadata:{}});assert.equal(stale.error,'revision_conflict');
 for(const [revision,status] of [[2,'archived'],[3,'deleted'],[4,'active']]){
  const item=await s.invoke('brain_set_status',{id:saved.id,expected_revision:revision,status});assert.equal(item.revision,revision+1);
  const card=await s.invoke('brain_card',{id:saved.id});assert.equal(card.lifecycle_status,status);assert.equal(card.work_status,'completed');
 }
 const history=await s.invoke('brain_history',{id:saved.id});
 const change=history.items.find(x=>x.after.revision===2);
 assert.equal(change.before.metadata.work_status,'design_pending');assert.equal(change.after.metadata.work_status,'completed');
 assert.equal(history.items.length,5);
});
test('legacy work item card extracts explicit group only and never invents freshness',async t=>{
 const s=setup();t.after(()=>s.sql.close());
 const content=JSON.stringify({schema:'go-brain-r2.1/work-item/v1',group:'in_progress',detail_status:'awaiting evidence'});
 const saved=await s.invoke('brain_save',{kind:'work_item',title:'Old work',content});
 const card=await s.invoke('brain_card',{id:saved.id});
 assert.equal(card.work_status,'awaiting evidence');assert.equal(card.work_group,'in_progress');
 assert.equal(card.time.source_verified_at,null);assert.equal(card.source.content,content);
 assert.ok(card.warnings.includes('SOURCE_FRESHNESS_UNKNOWN'));
 const missing=await s.invoke('brain_card',{id:'missing'});assert.equal(missing.error,'memory_not_found');
});
test('save request replays original response after edits or delete without mutations',async t=>{
 const s=setup();t.after(()=>s.sql.close());const args={title:'Beaver',content:'source',metadata,request_id:'save-beaver-001'};
 const first=await s.invoke('brain_save',args);assert.equal(first.error,undefined);
 await s.invoke('brain_edit',{id:first.id,expected_revision:1,content:'changed'});
 await s.invoke('brain_set_status',{id:first.id,expected_revision:2,status:'deleted'});
 const retry=await s.invoke('brain_save',{...args,metadata:{source_refs:metadata.source_refs,effective_at:'2026-11-12',context:'Beaver role agreement',work_status:'design_pending',source_verified_at:null}});
 assert.deepEqual(retry,first);
 const current=await s.invoke('brain_retrieve',{id:first.id});assert.equal(current.status,'deleted');assert.equal(current.content,'changed');
 assert.equal((await s.invoke('brain_history',{id:first.id})).items.length,3);
 const conflict=await s.invoke('brain_save',{...args,content:'different'});assert.equal(conflict.error,'request_id_conflict');
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM memories').get().n,1);
});
test('concurrent save retries produce one memory and one creation event',async t=>{
 const s=setup();t.after(()=>s.sql.close());const args={title:'Beaver',content:'source',request_id:'concurrent-beaver'};
 const results=await Promise.all(Array.from({length:5},()=>s.invoke('brain_save',args)));
 assert.ok(results.every(x=>x.id&&x.id===results[0].id));
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM history').get().n,1);
 const independent=await s.invoke('brain_save',{title:'Beaver',content:'source'});assert.notEqual(independent.id,results[0].id);
});
test('invalid metadata and request IDs reject without writing',async t=>{
 const s=setup();t.after(()=>s.sql.close());
 for(const extra of [{metadata:{effective_at:'2026-02-30'}},{metadata:{source_verified_at:'yesterday'}},{metadata:{context:3}},{metadata:{status:'active'}},{metadata:{source_refs:[{locator:'javascript:bad'}]}},{request_id:''},{request_id:'a'.repeat(129)}]){
  const result=await s.invoke('brain_save',{title:'Beaver',content:'source',...extra});assert.equal(result.error,'metadata' in extra?'invalid_metadata':'invalid_request_id',JSON.stringify(extra));
 }
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM memories').get().n,0);
});

test('standalone card is authenticated and owner HTTP card uses the same source revision',async t=>{
 const s=setup(standalone);t.after(()=>s.sql.close());
 const saved=await s.invoke('brain_save',{title:'Beaver',content:'private source'});
 const card=await s.invoke('brain_card',{id:saved.id});assert.equal(card.source.content,'private source');
 const response=await standalone.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'brain_card',arguments:{id:saved.id}}})}),{},{});
 assert.equal(response.status,401);
 const ownerApp=setup();t.after(()=>ownerApp.sql.close());
 const item=await ownerApp.invoke('brain_save',{title:'HTTP',content:'source'});
 const http=await ownerApp.api('/api/memories/'+item.id+'/card');assert.equal(http.status,200);assert.equal(http.data.revision,1);
});
test('migration preserves old rows and snapshots and adds metadata to future history',()=>{
 const sql=new DatabaseSync(':memory:');
 try{
  sql.exec(readFileSync(new URL('./fixtures/brain-pre-card.sql',import.meta.url),'utf8'));
  sql.prepare("INSERT INTO memories(id,kind,title,content,created_at,updated_at) VALUES('legacy','knowledge','Beaver','source','2026-11-01','2026-11-01')").run();
  const original=sql.prepare('SELECT * FROM memories').get();const history=sql.prepare('SELECT * FROM history').get();
  sql.exec(readFileSync(new URL('../migrations/0002_brain_memory_card.sql',import.meta.url),'utf8'));
  const migrated=sql.prepare('SELECT * FROM memories').get();
  for(const [key,value] of Object.entries(original))assert.equal(migrated[key],value);
  assert.deepEqual(sql.prepare('SELECT * FROM history').get(),history);
  assert.equal(migrated.metadata,'{}');assert.equal(migrated.save_request_id,null);
  sql.prepare('UPDATE memories SET metadata=?,revision=revision+1 WHERE id=?').run(JSON.stringify({context:'added context'}),'legacy');
  const event=sql.prepare("SELECT * FROM history WHERE action='updated'").get();
  assert.deepEqual(JSON.parse(event.before_json).metadata,{});
  assert.equal(JSON.parse(event.after_json).metadata.context,'added context');
  assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{sql.close();}
});

test('competing payloads with one request ID cannot overwrite the winner',async t=>{
 const s=setup();t.after(()=>s.sql.close());
 const results=await Promise.all(['first source','second source'].map(content=>s.invoke('brain_save',{title:'Beaver',content,request_id:'competing-request'})));
 assert.equal(results.filter(x=>x.id).length,1);assert.equal(results.filter(x=>x.error==='request_id_conflict').length,1);
 const winner=results.find(x=>x.id);assert.equal((await s.invoke('brain_retrieve',{id:winner.id})).content,winner.content);
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM history').get().n,1);
});
test('owner HTTP save retry shares the MCP receipt and metadata clearing preserves snapshots',async t=>{
 const s=setup();t.after(()=>s.sql.close());const args={title:'Beaver',content:'source',request_id:'http-retry',metadata};
 const http=await s.api('/api/memories','POST',args);assert.equal(http.status,201);
 assert.deepEqual(await s.invoke('brain_save',args),http.data);
 const conflict=await s.api('/api/memories','POST',{...args,title:'other'});assert.equal(conflict.status,409);
 const edited=await s.invoke('brain_edit',{id:http.data.id,expected_revision:1,title:'new title'});
 assert.equal(edited.metadata.context,'Beaver role agreement');
 const cleared=await s.invoke('brain_edit',{id:http.data.id,expected_revision:2,metadata:{}});assert.equal(cleared.metadata.context,null);
 const history=await s.invoke('brain_history',{id:http.data.id});assert.equal(history.items.find(x=>x.after.revision===3).before.metadata.context,'Beaver role agreement');
 assert.equal('save_request_hash' in http.data,false);assert.equal('save_response' in http.data,false);
});
