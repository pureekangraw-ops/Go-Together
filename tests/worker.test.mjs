import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
test('GO reads one Observatory round through the existing owner binding',async()=>{
 let sent;const result={status:'SNAPSHOT_AVAILABLE',read_only:true,content_trust:'untrusted_page_data',snapshot:{captureId:'round_one',sequence:2,expiresAtEpochMs:Date.now()+30000,payload:{title:'Checkout',text:'Payment pending'}}};
 const e={...env,PANTHEON_OWNER:{ownerCall:async a=>{sent=a;return {ok:true,upstream_status:200,result};}}};
 const v=await commandValue(await commandCall(e,'pantheon_observatory',{capture_id:'round_one'}));
 assert.equal(v.ok,true);assert.equal(v.result.snapshot.payload.text,'Payment pending');
 assert.deepEqual(sent,{operation:'observatory_latest',view:'browser',capture_id:'round_one'});
});
test('GO Observatory denies anonymous reads and invalid filters without contacting PANTHEON',async()=>{
 let calls=0;const e={...env,PANTHEON_OWNER:{ownerCall:async()=>{calls++;return {ok:true};}}};
 assert.equal((await commandCall(e,'pantheon_observatory',{},{})).status,401);
 for(const a of [{view:'cookies'},{device_id:'../bad'},{capture_id:'bad&path=1'},{url:'https://bad'}]){
 const r=await commandCall(e,'pantheon_observatory',a);assert.equal((await r.json()).result.isError,true);
 }assert.equal(calls,0);
});
test('GO refuses a snapshot that expired in transit',async()=>{
 const e={...env,PANTHEON_OWNER:{ownerCall:async()=>({ok:true,result:{status:'SNAPSHOT_AVAILABLE',snapshot:{expiresAtEpochMs:Date.now()-1,payload:{text:'old state'}}}})}};
 const v=await commandValue(await commandCall(e,'pantheon_observatory'));
 assert.equal(v.ok,false);assert.equal(v.status,'NO_FRESH_SNAPSHOT');assert.equal(v.result,undefined);
});
test('GO uses internal owner bridge with no copied WorkHub token',async()=>{
 let sent;const e={...env,PANTHEON_OWNER:{ownerCall:async a=>{sent=a;return {ok:true,upstream_status:200,result:{tasks:[]}};}}};
 const v=await commandValue(await commandCall(e,'pantheon_tasks'));
 assert.equal(v.ok,true);assert.deepEqual(sent,{operation:'intent',payload:{intent:'LIST_TASKS'}});
});
test('GO can read only the owner-shared Observatory view using internal MCP',async()=>{
 let sent, calls=0;
 const e={...env,PANTHEON_OWNER:{ownerCall:async a=>{sent=a;calls++;return {ok:true,upstream_status:200,result:{snapshots:[]}};}}};
 const ok=await commandValue(await commandCall(e,'pantheon_observatory',{view:'browser'}));
 assert.equal(ok.ok,true);
 assert.deepEqual(sent,{operation:'observatory_latest',view:'browser'});
 const denied=await commandCall(e,'pantheon_observatory',{view:'other'});
 assert.equal((await denied.json()).result.isError,true);
 assert.equal(calls,1);
 const anonymous=await commandCall(e,'pantheon_observatory',{view:'map'},{});
 assert.equal(anonymous.status,401);
 assert.equal(calls,1);
});
test('GO queues Factory work only through owner bridge',async()=>{
 let sent;const e={...env,PANTHEON_OWNER:{ownerCall:async a=>{sent=a;return {ok:true,upstream_status:201,result:{task_id:'task_'+'c'.repeat(32),executed:false}};}}};
 const v=await commandValue(await commandCall(e,'pantheon_command',{operation:'queue_factory',request:'bench test'}));
 assert.equal(v.ok,true);assert.deepEqual(sent,{operation:'queue_factory',request:'bench test'});
});
test('GO requires explicit approved=true for dispatch and denies anonymous RPC',async()=>{
 let calls=0;const task_id='task_'+'d'.repeat(32);
 const e={...env,PANTHEON_OWNER:{ownerCall:async a=>{calls++;return {ok:true,upstream_status:200,result:{task_id:a.task_id}};}}};
 const bad=await commandCall(e,'pantheon_command',{operation:'dispatch_factory',task_id});
 assert.equal((await bad.json()).result.isError,true);assert.equal(calls,0);
 assert.equal((await commandCall(e,'pantheon_command',{operation:'dispatch_factory',task_id,approved:true},{})).status,401);
 assert.equal(calls,0);
 const good=await commandValue(await commandCall(e,'pantheon_command',{operation:'dispatch_factory',task_id,approved:true}));
 assert.equal(good.ok,true);assert.equal(calls,1);
});
test('GO reads exact Factory job receipt via bridge',async()=>{
 let sent;const task_id='task_'+'e'.repeat(32);
 const e={...env,PANTHEON_OWNER:{ownerCall:async a=>{sent=a;return {ok:true,upstream_status:200,result:{job:{task_id}}};}}};
 const v=await commandValue(await commandCall(e,'pantheon_factory',{task_id}));
 assert.deepEqual(sent,{operation:'factory_job',task_id});assert.equal(v.result.job.task_id,task_id);
});
const commandCall=(e,name,args={},ctx=ownerContext)=>worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:84,method:'tools/call',params:{name,arguments:args}})}),e,ctx);
const commandValue=async r=>JSON.parse((await r.json()).result.content[0].text);
test('PANTHEON command sends CREATE_TASK envelope and returns queued receipt',async()=>{
 let payload;
 const task_id='task_'+'a'.repeat(32);
 const e={...env,WORKHUB_TOKEN:'x'.repeat(32),PANTHEON:{fetch:async req=>{
  payload=await req.json();
  assert.equal(req.method,'POST');assert.equal(new URL(req.url).pathname,'/v1/intent');
  assert.equal(req.headers.get('authorization'),'Bearer '+'x'.repeat(32));
  if(payload.intent!=='CREATE_TASK')return Response.json({error:'unsupported intent'},{status:400});
  return Response.json({task_id,status:'QUEUED',executed:false},{status:201});
 }}};
 const value=await commandValue(await commandCall(e,'pantheon_command',{request:'  integration receipt  '}));
 assert.deepEqual(payload,{intent:'CREATE_TASK',request:'integration receipt'});
 assert.equal(value.ok,true);assert.equal(value.result.task_id,task_id);assert.equal(value.result.executed,false);
});
test('PANTHEON tasks supports exact SHOW_TASK readback',async()=>{
 const task_id='task_'+'b'.repeat(32);let payload;
 const e={...env,WORKHUB_TOKEN:'x'.repeat(32),PANTHEON:{fetch:async req=>{
  payload=await req.json();return Response.json({task:{task_id,status:'QUEUED'}});
 }}};
 const value=await commandValue(await commandCall(e,'pantheon_tasks',{task_id}));
 assert.deepEqual(payload,{intent:'SHOW_TASK',task_id});
 assert.equal(value.result.task.task_id,task_id);
});
test('PANTHEON malformed JSON cannot report ok on HTTP 200',async()=>{
 const e={...env,WORKHUB_TOKEN:'x'.repeat(32),PANTHEON:{fetch:async()=>new Response('<html>error</html>')}};
 const value=await commandValue(await commandCall(e,'pantheon_tasks'));
 assert.equal(value.ok,false);assert.equal(value.status,'INVALID_UPSTREAM_RESPONSE');
});
test('PANTHEON unauthenticated caller cannot create tasks',async()=>{
 let called=false;const e={...env,WORKHUB_TOKEN:'x'.repeat(32),PANTHEON:{fetch:async()=>{called=true;return Response.json({});}}};
 assert.equal((await commandCall(e,'pantheon_command',{request:'test'},{})).status,401);
 assert.equal(called,false);
});
test('PANTHEON missing upstream credential fails closed',async()=>{
 let called=false;const e={...env,PANTHEON:{fetch:async()=>{called=true;return Response.json({});}}};
 const v=await commandValue(await commandCall(e,'pantheon_command',{request:'test'}));
 assert.equal(v.status,'UPSTREAM_AUTH_NOT_CONFIGURED');assert.equal(called,false);
});
test('PANTHEON LIST_TASKS preserves exact API fields',async()=>{
 let payload;const e={...env,WORKHUB_TOKEN:'x'.repeat(32),PANTHEON:{fetch:async req=>{payload=await req.json();return Response.json({tasks:[]});}}};
 const v=await commandValue(await commandCall(e,'pantheon_tasks'));
 assert.deepEqual(payload,{intent:'LIST_TASKS'});assert.equal(v.ok,true);
});
test('PANTHEON rejects malformed Task ID before contacting upstream',async()=>{
 let called=false;const e={...env,WORKHUB_TOKEN:'x'.repeat(32),PANTHEON:{fetch:async()=>{called=true;return Response.json({});}}};
 const r=await commandCall(e,'pantheon_tasks',{task_id:'../run'});
 assert.equal((await r.json()).result.isError,true);assert.equal(called,false);
});
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


test('PANTHEON health tool is discoverable but does not expose task actions',async()=>{
 const r=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:8,method:'tools/list'})}),env,ownerContext);
 const names=(await r.json()).result.tools.map(t=>t.name);
 assert.ok(names.includes('pantheon_health'));
 assert.ok(!names.includes('pantheon_create_task'));
});
const pantheonCall=(e,ctx=ownerContext,args={})=>worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:83,method:'tools/call',params:{name:'pantheon_health',arguments:args}})}),e,ctx);
test('PANTHEON health cannot be called anonymously',async()=>{
 const r=await pantheonCall(env,{});assert.equal(r.status,401);
});
test('PANTHEON health fails closed without service binding',async()=>{
 const r=await pantheonCall(env);assert.equal(r.status,200);
 const v=JSON.parse((await r.json()).result.content[0].text);
 assert.deepEqual(v,{connected:false,status:'NOT_CONFIGURED',read_only:true});
});
test('PANTHEON health reads fixed internal route and redacts extra fields',async()=>{
 let path='';const e={...env,PANTHEON:{fetch:async request=>{path=new URL(request.url).pathname;return Response.json({ok:true,service:'pantheon-workhub',stage:'primary-preview',secret:'must-not-leak',factory:{connection:'CONNECTED',station_status:'READY',rail_status:'READY',work_token:'nope'}});}}};
 const r=await pantheonCall(e);const v=JSON.parse((await r.json()).result.content[0].text);
 assert.equal(path,'/health');assert.equal(v.connected,true);assert.equal(v.read_only,true);assert.equal(v.factory.station_status,'READY');assert.equal(v.secret,undefined);assert.equal(v.factory.work_token,undefined);
});
test('PANTHEON health rejects unexpected tool parameters and upstream errors',async()=>{
 const r=await pantheonCall({...env,PANTHEON:{fetch:async()=>new Response('unavailable',{status:503})}},ownerContext,{token:'should-not-forward'});
 assert.equal((await r.json()).result.isError,true);
 const r2=await pantheonCall({...env,PANTHEON:{fetch:async()=>new Response('unavailable',{status:503})}});
 const v=JSON.parse((await r2.json()).result.content[0].text);assert.equal(v.connected,false);assert.equal(v.upstream_status,503);
});
