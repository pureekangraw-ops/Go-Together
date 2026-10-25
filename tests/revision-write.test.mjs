import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './hub-fixture.mjs';

const ROOT='https://go-together.pureekangraw.workers.dev';
const owner={access:{aud:'test-aud',getIdentity:async()=>({email:'owner@example.test'})}};
function setup(){
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
 const env={DB,ACCESS_AUD:'test-aud',OWNER_EMAIL:'owner@example.test'};
 const api=async(path,method='GET',body)=>{
  const response=await worker.fetch(new Request(ROOT+path,{method,...(body?{body:JSON.stringify(body)}:{})}),env,owner);
  return {status:response.status,data:await response.json()};
 };
 const invoke=async(name,args)=>{
  const response=await api('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
  const out=response.data.result;
  return out.isError?{error:out.content[0].text}:JSON.parse(out.content[0].text);
 };
 return {sql,metrics,api,invoke,before(fn){beforeUpdate=fn;},after(fn){afterUpdate=fn;}};
}
async function create(s,title='Synthetic task'){return s.invoke('brain_save',{title,content:'before',tags:['fixture']});}

test('MCP edit succeeds when audit trigger makes D1 changes equal two',async t=>{
 const s=setup();t.after(()=>s.sql.close());const item=await create(s);
 const edited=await s.invoke('brain_edit',{id:item.id,expected_revision:1,content:'after'});
 assert.deepEqual(s.metrics,[2]);assert.equal(edited.error,undefined);
 assert.equal(edited.content,'after');assert.equal(edited.revision,2);assert.deepEqual(edited.tags,['fixture']);
 const history=await s.invoke('brain_history',{id:item.id});
 assert.equal(history.items.length,2);
 assert.ok(history.items.some(x=>x.before?.revision===1&&x.after?.revision===2));
});
test('stale revision rejects without changing data or history',async t=>{
 const s=setup();t.after(()=>s.sql.close());const item=await create(s);
 await s.invoke('brain_edit',{id:item.id,expected_revision:1,content:'winner'});
 const stale=await s.invoke('brain_edit',{id:item.id,expected_revision:1,content:'lost'});
 assert.equal(stale.error,'revision_conflict');
 assert.equal((await s.invoke('brain_retrieve',{id:item.id})).content,'winner');
 assert.equal((await s.invoke('brain_history',{id:item.id})).items.length,2);
});
test('write losing a race after initial read rejects atomically',async t=>{
 const s=setup();t.after(()=>s.sql.close());const item=await create(s);
 s.before(()=>s.sql.prepare("UPDATE memories SET content='other room',revision=revision+1 WHERE id=?").run(item.id));
 const result=await s.invoke('brain_edit',{id:item.id,expected_revision:1,content:'loser'});
 assert.equal(result.error,'revision_conflict');assert.deepEqual(s.metrics,[0]);
 assert.equal((await s.invoke('brain_retrieve',{id:item.id})).content,'other room');
 assert.equal((await s.invoke('brain_history',{id:item.id})).items.length,2);
});
test('HTTP patch and archive return their committed record',async t=>{
 const s=setup();t.after(()=>s.sql.close());const item=await create(s);
 const patch=await s.api('/api/memories/'+item.id,'PATCH',{expected_revision:1,title:'Updated task'});
 assert.equal(patch.status,200);assert.equal(patch.data.revision,2);
 const archive=await s.invoke('brain_set_status',{id:item.id,expected_revision:2,status:'archived'});
 assert.equal(archive.error,undefined);assert.equal(archive.status,'archived');assert.equal(archive.revision,3);
 assert.equal((await s.invoke('brain_history',{id:item.id})).items.length,3);
});
test('different task records update independently with their own revisions',async t=>{
 const s=setup();t.after(()=>s.sql.close());const a=await create(s,'A'),b=await create(s,'B');
 const results=await Promise.all([s.invoke('brain_edit',{id:a.id,expected_revision:1,content:'A changed'}),s.invoke('brain_edit',{id:b.id,expected_revision:1,content:'B changed'})]);
 assert.deepEqual(results.map(x=>x.revision),[2,2]);
 assert.deepEqual(results.map(x=>x.content),['A changed','B changed']);
});
test('response identifies this write even if a later writer commits before response',async t=>{
 const s=setup();t.after(()=>s.sql.close());const item=await create(s);
 s.after(()=>s.sql.prepare("UPDATE memories SET content='later',revision=revision+1 WHERE id=?").run(item.id));
 const result=await s.invoke('brain_edit',{id:item.id,expected_revision:1,content:'ours'});
 assert.equal(result.content,'ours');assert.equal(result.revision,2);
 const current=await s.invoke('brain_retrieve',{id:item.id});assert.equal(current.revision,3);assert.equal(current.content,'later');
});


