import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase,seed} from './brain-test-db.mjs';
import {keywordSearch} from '../worker/brain-search.mjs';
test('search finds old memories beyond 2000 rows and explains literal Thai matches',async t=>{
 const s=testDatabase();t.after(s.close);const wanted=seed(s.sql,{content:'บีเวอร์ทำเครื่องมือ',title:'old',tags:[],updated_at:'2020-01-01T00:00:00Z'});
 for(let i=0;i<2005;i++)seed(s.sql,{title:'unrelated '+i,content:'เดินทางและร้านค้า',tags:[]});
 const result=await keywordSearch(s.DB,{query:'บีเวอร์'});
 assert.deepEqual(result.items.map(x=>x.memory.id),[wanted]);assert.equal(result.items[0].matches[0].field,'content');
 assert.ok(result.items[0].matches[0].excerpt.includes('บีเวอร์'));assert.equal(result.coverage.pre_match_limit,null);
});
test('source search ranks title, filters states, and paginates without duplicates',async t=>{
 const s=testDatabase();t.after(s.close);const a=seed(s.sql,{title:'Beaver exact',content:'none',tags:[]});
 seed(s.sql,{title:'other',content:'Beaver',tags:[]});const archived=seed(s.sql,{title:'Beaver archive',status:'archived'});
 const first=await keywordSearch(s.DB,{query:'Beaver',limit:1});assert.equal(first.items[0].memory.id,a);assert.ok(first.next_cursor);
 const next=await keywordSearch(s.DB,{query:'Beaver',limit:1,cursor:first.next_cursor});assert.equal(next.items.length,1);assert.notEqual(next.items[0].memory.id,a);assert.equal(next.next_cursor,null);
 assert.deepEqual((await keywordSearch(s.DB,{query:'Beaver',status:'archived'})).items.map(x=>x.memory.id),[archived]);
 await assert.rejects(keywordSearch(s.DB,{query:'other',cursor:first.next_cursor}),/invalid_cursor/);
});
test('literal wildcard characters and any/all word matching are independent of associations',async t=>{
 const s=testDatabase();t.after(s.close);const exact=seed(s.sql,{title:'Beaver 100%_done',content:'Octopus',tags:[]});
 seed(s.sql,{title:'Beaver',content:'nothing else',tags:[]});
 assert.deepEqual((await keywordSearch(s.DB,{query:'%_',match:'phrase'})).items.map(x=>x.memory.id),[exact]);
 assert.equal((await keywordSearch(s.DB,{query:'Beaver Octopus',match:'all'})).count,1);
 assert.equal((await keywordSearch(s.DB,{query:'Beaver Octopus',match:'any'})).count,2);
 await assert.rejects(keywordSearch(s.DB,{query:' ',limit:2}),/invalid_query/);
 await assert.rejects(keywordSearch(s.DB,{query:'Beaver',status:'invented'}),/invalid_status/);
});
