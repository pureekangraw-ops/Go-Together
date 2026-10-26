import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{appMcp} from '../worker/index.js';
import {buildBrainContext} from '../worker/brain-context.mjs';

const WORK={
 id:'11111111-1111-4111-8111-111111111111',kind:'work_item',
 title:'GO Brain work continuity',content:JSON.stringify({
  schema:'go-brain-r2.1/work-item/v1',
  checkpoint:{next_action:'Read exact checkpoint before continuing'}
 }),status:'active',work_id:'',evidence_url:'https://example.test/receipt',
 confidence:'confirmed',tags:['work'],revision:3,updated_at:'2026-10-27T00:00:00Z'
};
const RCA={
 id:'22222222-2222-4222-8222-222222222222',kind:'analysis',
 title:'GO Brain RCA regression',content:'An actual observed test failure, not a trained skill.',
 status:'needs_review',work_id:'',evidence_url:'',confidence:'unknown',
 tags:['rca:regression'],revision:1,updated_at:'2026-10-26T00:00:00Z'
};
const hits={query:'GO Brain',method:'lexical-v2',items:[
 {score:0.75,memory:RCA},{score:0.5,memory:WORK}
]};
test('Operational pack places work first and preserves revision/source pointers',()=>{
 const out=buildBrainContext(hits,{mode:'operational'});
 assert.equal(out.records[0].record_id,WORK.id);
 assert.equal(out.records[0].revision,3);
 assert.equal(out.records[0].next_action_from_structured_work_item,'Read exact checkpoint before continuing');
 assert.equal(out.records[0].external_evidence_pointer,WORK.evidence_url);
 assert.equal(out.records[0].source_updated_at,null);
 assert.equal(out.source_assessment,'NOT_INDEPENDENTLY_VERIFIED');
});
test('Context mode chooses relevant record from a pool larger than requested output',()=>{
 const out=buildBrainContext(hits,{mode:'operational',limit:1});
 assert.equal(out.count,1);
 assert.equal(out.records[0].record_id,WORK.id);
 assert.equal(out.candidates_considered,2);
 assert.equal(out.truncated_candidates,true);
 const evolution=buildBrainContext(hits,{mode:'evolution',limit:1});
 assert.equal(evolution.records[0].record_id,RCA.id);
});
test('Grouped context keeps lexical relevance order within the same section',()=>{
 const second={...WORK,id:'33333333-3333-4333-8333-333333333333',title:'GO Brain work older'};
 const result=buildBrainContext({query:'work',items:[
  {score:0.2,memory:second},{score:0.9,memory:WORK},{score:1,memory:RCA}
 ]},{mode:'operational',limit:2});
 assert.deepEqual(result.records.map(x=>x.record_id),[WORK.id,second.id]);
});
test('Evolution pack prioritizes recorded RCA without fabricating conclusions',()=>{
 const before=JSON.stringify(hits);
 const out=buildBrainContext(hits,{mode:'evolution'});
 assert.equal(out.records[0].record_id,RCA.id);
 assert.deepEqual(out.records[0].warnings,[
  'NOT_ACTIVE_REVIEW_SOURCE','MEMORY_CONFIDENCE_NOT_CONFIRMED','NO_EXTERNAL_EVIDENCE_LINK'
 ]);
 assert.equal(out.records[0].next_action_from_structured_work_item,null);
 assert.equal(JSON.stringify(hits),before,'input memories must never mutate');
});
test('All pack leaves lexical order unchanged and caps excerpts',()=>{
 const long={...WORK,content:'X'.repeat(2500)};
 const out=buildBrainContext({query:'x',items:[{score:1,memory:long},{score:0.3,memory:RCA}]},{mode:'all'});
 assert.equal(out.records[0].excerpt.length,900);
 assert.ok(out.records[0].warnings.includes('EXCERPT_TRUNCATED_FETCH_EXACT_RECORD'));
 assert.equal(out.records[1].record_id,RCA.id);
});
test('Context packaging rejects unexpected mode and limits',()=>{
 assert.throws(()=>buildBrainContext(hits,{mode:'autonomous'}),/invalid_context_mode/);
 assert.throws(()=>buildBrainContext(hits,{limit:100}),/invalid_context_limit/);
});
const ROOT='https://go-together.pureekangraw.workers.dev';
const rows=[{...RCA,tags:JSON.stringify(RCA.tags)},{...WORK,tags:JSON.stringify(WORK.tags)}];
const env={
 ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',
 DB:{prepare:()=>({all:async()=>({results:rows}),first:async()=>({healthy:1})})},
 ASSETS:{fetch:async()=>new Response('unused')}
};
const authorized={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
test('Context HTTP endpoint is owner only and returns bounded evidence pack',async()=>{
 const path='/api/context?q=GO%20Brain&mode=operational&limit=2';
 assert.equal((await worker.fetch(new Request(ROOT+path),env,{})).status,401);
 const result=await worker.fetch(new Request(ROOT+path),env,authorized);
 assert.equal(result.status,200);
 const out=await result.json();
 assert.equal(out.type,'go_brain_source_context_v1');
 assert.equal(out.records[0].record_id,WORK.id);
 assert.equal(out.records.length,2);
 const one=await worker.fetch(new Request(ROOT+'/api/context?q=GO%20Brain&limit=1'),env,authorized);
 assert.equal(one.status,200);
 const narrow=await one.json();
 assert.equal(narrow.count,1);
 assert.equal(narrow.records[0].record_id,WORK.id);
 assert.equal(narrow.candidates_considered,2);
 assert.equal((await worker.fetch(new Request(ROOT+'/api/context?q=GO%20Brain&limit=20'),env,authorized)).status,400);
});
test('Brain MCP group exposes read-only context and does not write to D1',async()=>{
 const request=new Request(ROOT+'/hub-mcp/brain',{
  method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
   params:{name:'brain_context',arguments:{query:'GO Brain',mode:'evolution',limit:2}}})
 });
 const response=await appMcp(request,env);
 assert.equal(response.status,200);
 const rpc=await response.json();
 const result=JSON.parse(rpc.result.content[0].text);
 assert.equal(result.records[0].record_id,RCA.id);
 assert.equal(result.count,2);
});
