import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase,seed} from './brain-test-db.mjs';
import {keywordFinder,associationStatus} from '../worker/brain-keywords.mjs';
test('Finder uses GO tags without AI and keeps Search independent',async t=>{
 const s=testDatabase();t.after(s.close);const id=seed(s.sql,{tags:['beaver','เครื่องมือ']});
 const found=await keywordFinder(s.DB,{query:'beaver'});assert.equal(found.items[0].memory_id,id);
 assert.ok(found.items[0].paths.some(x=>x.label==='เครื่องมือ'&&x.provenance==='GO_supplied'));
 assert.equal(found.items[0].revision,1);assert.equal(found.items[0].association_state,'pending');
 assert.equal((await associationStatus(s.DB,id)).attempts,0);
});
test('edited and deleted source terms never leak into current Finder results',async t=>{
 const s=testDatabase();t.after(s.close);const id=seed(s.sql,{tags:['beaver']});
 s.sql.prepare("UPDATE memories SET tags='[\"new-topic\"]',revision=2 WHERE id=?").run(id);
 assert.equal((await keywordFinder(s.DB,{query:'beaver'})).count,0);
 assert.equal((await keywordFinder(s.DB,{query:'new-topic'})).count,1);
 s.sql.prepare("UPDATE memories SET status='deleted',revision=3 WHERE id=?").run(id);
 assert.equal((await keywordFinder(s.DB,{query:'new-topic'})).count,0);
 const historical=await keywordFinder(s.DB,{query:'new-topic',status:'deleted'});assert.equal(historical.items[0].revision,3);
 s.sql.prepare("UPDATE memories SET status='active',revision=4 WHERE id=?").run(id);
 assert.equal((await keywordFinder(s.DB,{query:'new-topic'})).items[0].revision,4);
});
test('Finder invalidates both incoming and outgoing links on target revision changes',async t=>{
 const s=testDatabase();t.after(s.close);const source=seed(s.sql),target=seed(s.sql,{tags:['octopus']});
 const run=s.sql.prepare('SELECT id FROM brain_association_runs WHERE memory_id=?').get(source).id;
 s.sql.prepare("UPDATE brain_association_runs SET state='ready' WHERE id=?").run(run);
 s.sql.prepare("INSERT INTO brain_memory_links(run_id,target_id,target_revision,type,evidence_json,target_evidence_json) VALUES(?,?,1,'related','{}','{}')").run(run,target);
 assert.equal((await keywordFinder(s.DB,{query:'beaver'})).items[0].relations.length,1);
 assert.equal((await keywordFinder(s.DB,{query:'octopus'})).items[0].relations.length,1);
 s.sql.prepare('UPDATE memories SET revision=2 WHERE id=?').run(target);
 assert.equal((await keywordFinder(s.DB,{query:'beaver'})).items[0].relations.length,0);
 assert.equal((await keywordFinder(s.DB,{query:'octopus'})).items[0].relations.length,0);
});
test('Finder retains matching evidence beyond its expansion cap',async t=>{
 const s=testDatabase();t.after(s.close);const id=seed(s.sql,{tags:[]});
 const run=s.sql.prepare('SELECT id FROM brain_association_runs WHERE memory_id=?').get(id).id;
 s.sql.prepare("UPDATE brain_association_runs SET state='ready' WHERE id=?").run(run);
 for(let i=0;i<121;i++){
  const term=i===120?'zzneedle':'aaa'+String(i).padStart(3,'0');
  s.sql.prepare("INSERT INTO brain_memory_terms(memory_id,revision,run_id,term,label,kind,entity_key,provenance,evidence_json) VALUES(?,1,?,?,?,'alias','entity','ai_suggested','{}')").run(id,run,term,term);
 }
 const found=await keywordFinder(s.DB,{query:'zzneedle'});
 assert.equal(found.items[0]?.matches[0]?.label,'zzneedle');assert.ok(found.items[0].paths.length<=20);
});
test('Finder matches Unicode explicit tags without rewriting them',async t=>{
 const s=testDatabase();t.after(s.close);const id=seed(s.sql,{tags:['ÉCOLE']});
 const found=await keywordFinder(s.DB,{query:'école'});
 assert.equal(found.items[0]?.memory_id,id);assert.equal(found.items[0].matches[0].label,'ÉCOLE');
});

test('Unicode Finder paginates after matching across candidate batches',async t=>{
 const s=testDatabase();t.after(s.close);
 for(let i=0;i<105;i++)seed(s.sql,{tags:['unrelated'],updated_at:'2026-11-13T00:00:00Z'});
 const a=seed(s.sql,{tags:['ÉCOLE'],updated_at:'2026-11-12T00:00:00Z'});
 const b=seed(s.sql,{tags:['école'],updated_at:'2026-11-11T00:00:00Z'});
 const first=await keywordFinder(s.DB,{query:'école',limit:1});assert.equal(first.items[0]?.memory_id,a);
 const next=await keywordFinder(s.DB,{query:'école',limit:1,cursor:first.next_cursor});
 assert.equal(next.items[0]?.memory_id,b);assert.equal(next.next_cursor,null);
});
