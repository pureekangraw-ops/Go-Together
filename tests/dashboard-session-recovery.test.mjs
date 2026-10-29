import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../static/index.html',import.meta.url),'utf8');
const apiSource=html.slice(html.indexOf('function requestError('),html.indexOf('function esc('));
function client(fetch){
  const status={textContent:''};
  const context=vm.createContext({fetch,$:()=>status});
  vm.runInContext(apiSource,context);
  return {api:context.api,status};
}

test('owner recovery links remain visible and point at real login and Hub routes',()=>{
  assert.match(html,/<html lang="th">/);
  assert.match(html,/<a id="owner-login" href="\/auth\/login">Owner Login/);
  assert.match(html,/<a id="hub-home" href="https:\/\/ygg-connection-hub-v2\.pureekangraw\.workers\.dev\/">/);
  assert.match(html,/id="session-status"[^>]*role="status"/);
  assert.doesNotMatch(html,/localStorage|sessionStorage/);
});

test('API includes session cookies, refuses automatic redirects and bypasses stale cache',async()=>{
  let seen;
  const {api,status}=client(async(path,options)=>{seen={path,options};return new Response('{"items":[]}',{headers:{'content-type':'application/json'}});});
  const data=await api('/api/memories',{method:'POST',body:'{}',headers:{'X-Test':'yes'}});
  assert.equal(data.items.length,0);
  assert.equal(seen.options.credentials,'same-origin');
  assert.equal(seen.options.redirect,'manual');
  assert.equal(seen.options.cache,'no-store');
  assert.equal(seen.options.headers['Content-Type'],'application/json');
  assert.equal(seen.options.headers['X-Test'],'yes');
  assert.equal(seen.options.body,'{}');
  assert.match(status.textContent,/เชื่อมต่อข้อมูลส่วนตัวแล้ว/);
});

for(const [name,response,kind] of [
  ['expired owner session',()=>new Response('{}',{status:401}),'auth'],
  ['owner denied',()=>new Response('{}',{status:403}),'auth'],
  ['Access HTML',()=>new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}}),'response'],
  ['Access manual redirect',()=>({type:'opaqueredirect',status:0}),'auth'],
  ['redirected response',()=>({redirected:true,status:200}),'auth'],
  ['malformed JSON',()=>new Response('{',{headers:{'content-type':'application/json'}}),'response'],
  ['API failure',()=>new Response('{"error":"conflict"}',{status:409,headers:{'content-type':'application/json'}}),'api'],
])test(name+' produces an actionable message',async()=>{
  const {api,status}=client(async()=>response());
  await assert.rejects(api('/api/stats'),error=>error.kind===kind&&error.message===status.textContent);
  assert.ok(status.textContent.length>15);
});

test('network failure never retries the submitted operation',async()=>{
  let calls=0;
  const {api,status}=client(async()=>{calls++;throw new TypeError('Failed to fetch');});
  await assert.rejects(api('/api/factory-approvals/id/approve',{method:'POST',body:'{}'}),error=>error.kind==='network');
  assert.equal(calls,1);
  assert.match(status.textContent,/ห้ามส่งซ้ำ/);
});

test('uncertain approval is held for status checks and cannot be clicked twice',async()=>{
  const source=html.slice(html.indexOf('async function handleApproval('),html.indexOf('async function checkApprovalStatus('));
  let calls=0,refreshes=0;
  const uncertainApprovals=new Set();
  const context=vm.createContext({uncertainApprovals,CSS:{escape:x=>x},document:{querySelector:()=>({disabled:false})},api:async()=>{calls++;throw new Error('network');},toast:()=>{},refreshApprovals:async()=>{refreshes++;}});
  vm.runInContext(source,context);
  await context.handleApproval('id','approve','exact-hash');
  await context.handleApproval('id','approve','exact-hash');
  assert.equal(calls,1);
  assert.equal(refreshes,1);
  assert.ok(uncertainApprovals.has('id'));
  assert.match(html,/x.status==='PENDING'&&!uncertain/);
  assert.match(html,/uncertain\|\|\['RUNNING','DISPATCHING','UNKNOWN'\]/);
  assert.match(source,/JSON.stringify\(\{payloadSha256\}\)/);
});

test('complete inline dashboard script remains valid JavaScript',()=>{
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(()=>new vm.Script(script));
});
