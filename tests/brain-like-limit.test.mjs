import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{appMcp} from '../worker/index.js';

const ROOT='https://go-together.pureekangraw.workers.dev';
let queries=0;
const env={
 ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',
 DB:{prepare:()=>({all:async()=>{queries++;return {results:[]};},first:async()=>({healthy:1})})},
 ASSETS:{fetch:async()=>new Response('unused')}
};
const owner={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
test('owner HTTP list rejects 49-character LIKE input without running D1 query',async()=>{
 queries=0;
 const res=await worker.fetch(new Request(ROOT+'/api/memories?q='+encodeURIComponent('z'.repeat(49))),env,owner);
 assert.equal(res.status,400);
 assert.equal((await res.json()).error,'invalid_query_like_length');
 assert.equal(queries,0);
});
test('owner HTTP list accepts 48-character input',async()=>{
 queries=0;
 const res=await worker.fetch(new Request(ROOT+'/api/memories?q='+encodeURIComponent('z'.repeat(48))),env,owner);
 assert.equal(res.status,200);
 assert.deepEqual((await res.json()).items,[]);
 assert.equal(queries,1);
});
test('GO MCP list rejects 49-character LIKE input without hitting D1',async()=>{
 queries=0;
 const res=await appMcp(new Request(ROOT+'/hub-mcp/brain',{
 method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',
  params:{name:'brain_list',arguments:{q:'z'.repeat(49)}}})
 }),env);
 assert.equal(res.status,200);
 const body=await res.json();
 assert.equal(body.result.isError,true);
 assert.equal(body.result.content?.[0]?.text,'invalid_query_like_length');
 assert.equal(queries,0);
});
