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
