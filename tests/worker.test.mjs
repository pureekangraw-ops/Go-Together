import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
const ROOT='https://go-together.pureekangraw.workers.dev';
const env={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',DB:{prepare:()=>({first:async()=>({healthy:1})})},ASSETS:{fetch:async()=>new Response('static')}};
const get=(path)=>worker.fetch(new Request(ROOT+path),env,{});
test('health queries bound D1',async()=>{const r=await get('/api/health');assert.equal(r.status,200);assert.equal((await r.json()).storage,'Cloudflare D1');});
test('private memory list rejects unauthenticated access',async()=>{const r=await get('/api/memories');assert.equal(r.status,401);});
test('private MCP endpoint rejects anonymous callers',async()=>{const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:'{}'}),env,{});assert.equal(r.status,401);});
test('owner can initialize MCP',async()=>{const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})}),env,ctx);assert.equal(r.status,200);});

test('wrong Access owner is rejected',async()=>{const ctx={access:{aud:'aud',getIdentity:async()=>({email:'other@example.com'})}};const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:'{}'}),env,ctx);assert.equal(r.status,401);});
test('wrong Access audience is rejected',async()=>{const ctx={access:{aud:'another-aud',getIdentity:async()=>({email:'owner@example.com'})}};const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:'{}'}),env,ctx);assert.equal(r.status,401);});
test('owner lists Intake tools without extra permission checks',async()=>{const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),env,ctx);const x=(await r.json()).result.tools;assert.ok(x.some(t=>t.name==='brain_save'));assert.ok(x.every(t=>!t.securitySchemes));});
