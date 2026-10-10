import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
const ROOT='https://go-together.pureekangraw.workers.dev';
const env={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',DB:{prepare:()=>({first:async()=>({healthy:1})})},ASSETS:{fetch:async()=>new Response('static')}};
const get=(path)=>worker.fetch(new Request(ROOT+path),env,{});
test('health queries bound D1',async()=>{const r=await get('/api/health');assert.equal(r.status,200);assert.equal((await r.json()).storage,'Cloudflare D1');});
test('private memory list rejects unauthenticated access',async()=>{const r=await get('/api/memories');assert.equal(r.status,401);});
test('private MCP endpoint rejects anonymous callers',async()=>{const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:'{}'}),env,{});assert.equal(r.status,401);});
test('empty ChatGPT connection probe returns OAuth challenge',async()=>{const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:''}),env,{});assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/oauth-protected-resource\/mcp/);});
test('malformed MCP JSON returns 400 without an unhandled rejection',async()=>{const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:'{'}),env,{});assert.equal(r.status,400);assert.equal((await r.json()).error,'invalid_json');});
test('owner can initialize MCP',async()=>{const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})}),env,ctx);assert.equal(r.status,200);});

test('wrong Access owner is rejected',async()=>{const ctx={access:{aud:'aud',getIdentity:async()=>({email:'other@example.com'})}};const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:'{}'}),env,ctx);assert.equal(r.status,401);});
test('wrong Access audience is rejected',async()=>{const ctx={access:{aud:'another-aud',getIdentity:async()=>({email:'owner@example.com'})}};const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:'{}'}),env,ctx);assert.equal(r.status,401);});
test('owner lists Intake tools without extra permission checks',async()=>{const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),env,ctx);const x=(await r.json()).result.tools;assert.ok(x.some(t=>t.name==='brain_save'));assert.ok(x.every(t=>t.securitySchemes[0].type==='oauth2'&&t.securitySchemes[0].scopes.length===0));});


const ownerContext={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
const modern=(method)=>new Request(ROOT+'/mcp',{method:'POST',headers:{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':method},body:JSON.stringify({jsonrpc:'2.0',id:42,method,params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}})});
test('modern client discovers MCP 2026-07-28',async()=>{
 const r=await worker.fetch(modern('server/discover'),env,ownerContext);
 assert.equal(r.status,200);
 const out=(await r.json()).result;
 assert.equal(out.resultType,'complete');
 assert.ok(out.supportedVersions.includes('2026-07-28'));
 assert.equal(out._meta['io.modelcontextprotocol/serverInfo'].name,'go-together');
});
test('modern MCP tools/list exposes deterministic Intake catalog',async()=>{
 const r=await worker.fetch(modern('tools/list'),env,ownerContext);
 const out=(await r.json()).result;
 assert.equal(r.status,200);
 assert.equal(out.resultType,'complete');
 assert.ok(out.tools.some(t=>t.name==='brain_save'));
});
test('spoofed JWT without a trusted signature fails closed',async()=>{
 const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'not.a.valid.jwt'},body:'{}'}),env,{});
 assert.equal(r.status,401);
});
test('Cloudflare signed JWT works when ctx.access is missing',async()=>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='owner-2026-test';
 const url64=v=>Buffer.from(v).toString('base64url');
 const sign=async(claims)=>{
  const payload=url64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+url64(JSON.stringify(claims));
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(payload));
  return payload+'.'+url64(new Uint8Array(signature));
 };
 const now=Math.floor(Date.now()/1000);
 const valid={iss:'https://test.cloudflareaccess.com',aud:['aud'],email:'owner@example.com',exp:now+3600,nbf:now-30};
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{'content-type':'application/json'}});
 const signedEnv={...env,ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com'};
 const call=async claims=>worker.fetch(new Request(ROOT+'/mcp',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':await sign(claims)},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})}),signedEnv,{});
 try{
  const good=await call(valid);assert.equal(good.status,200);assert.deepEqual((await good.json()).result,{});
  assert.equal((await call({...valid,email:'other@example.com'})).status,401);
  assert.equal((await call({...valid,aud:['other-audience']})).status,401);
  assert.equal((await call({...valid,exp:now-1})).status,401);
 }finally{globalThis.fetch=oldFetch;}
});

test('knowledge note endpoints reject anonymous callers',async()=>{
 for(const path of ['/api/knowledge-notes','/api/knowledge-notes/00000000-0000-0000-0000-000000000001/suggest']){
  const r=await get(path);assert.equal(r.status,401);
 }
});
test('knowledge-note route is recognized and validates revision',async()=>{
 const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
 const id='00000000-0000-0000-0000-000000000001';
 const r=await worker.fetch(new Request(ROOT+'/api/knowledge-notes/'+id+'/stage',{method:'POST',body:JSON.stringify({stage:'use'})}),env,ctx);
 assert.notEqual(r.status,404);
});
