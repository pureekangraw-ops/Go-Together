import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker, {appMcp} from '../worker/index.js';
import {assertCurrentRouting} from '../scripts/assert-current-routing.mjs';

test('reviewed repair restores named API service bindings and preserves all other metadata', () => {
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url)));
 const repair=JSON.parse(readFileSync(new URL('../docs/hub-v2-rpc-binding-repair.json',import.meta.url)));
 const bindings=config.services.map(({binding,service})=>({type:'service',name:binding,service,environment:'production'}));
 bindings.push({type:'secret_text',name:'EXISTING_SECRET'},{type:'d1',name:'DB',id:'offline-db'});
 assert.throws(()=>assertCurrentRouting(config,bindings),/entrypoint mismatch/);
 const before=structuredClone(bindings);
 for(const change of repair.changes){
  const row=bindings.find(b=>b.name===change.name);
  assert.equal(row.service,change.service);
  assert.equal(row.entrypoint??null,change.beforeEntrypoint);
  row.entrypoint=change.entrypoint;
 }
 assert.equal(assertCurrentRouting(config,bindings),true);
 for(let i=0;i<bindings.length;i++){
  const {entrypoint,...rest}=bindings[i];
  assert.deepEqual(rest,before[i]);
 }
});

test('owner MCP Brain and Factory reads traverse Hub contract mock; no Factory job or public fallback',async()=>{
 const calls=[];
 const env={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.test',
  DB:{prepare(sql){assert.match(sql,/^SELECT/);return {all:async()=>({results:[]})};}},
  FACTORY_DIRECT:{fetch:async req=>{
   calls.push(['factory',req.method,new URL(req.url).pathname]);
   assert.equal(req.method,'GET');assert.equal(new URL(req.url).pathname,'/health');
   return Response.json({service:'factory-district',stationId:'FACTORY-STATION',status:'READY',
    sourceSha:'a'.repeat(40),transport:{status:'READY'},machinery:{CODE:{status:'READY'}}});
  }}
 };
 env.HUB_V2={
  connections:async()=>{calls.push(['connections']);return {source:'YGG_CONNECTION_HUB_V2',connections:[],tools:0};},
  relay:async({connectorId,name,payload,messageId})=>{
   calls.push(['relay',connectorId,name]);assert.ok(messageId);
   const response=await appMcp(new Request('https://go.internal/hub-mcp/'+connectorId,{
    method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:payload}})
   }),env);
   return {receipt:{state:'RESPONDED'},response:{body:await response.text()}};
  }
 };
 const invoke=(name,args={},ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.test'})}})=>
  worker.fetch(new Request('https://go.internal/mcp',{method:'POST',body:JSON.stringify({
   jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env,ctx);
 assert.equal((await invoke('factory_direct_status',{},{})).status,401);
 assert.equal(calls.length,0);
 const value=async response=>{const rpc=await response.json();assert.ok(!rpc.result.isError,JSON.stringify(rpc));return JSON.parse(rpc.result.content[0].text);};
 const brain=await value(await invoke('brain_context',{query:'offline'}));
 assert.equal(brain.type,'go_brain_source_context_v1');
 assert.equal(brain._hubReceipt.state,'RESPONDED');
 const factory=await value(await invoke('factory_direct_status'));
 assert.equal(factory.status,'CONNECTED');assert.equal(factory._hubReceipt.state,'RESPONDED');
 assert.ok(calls.some(c=>c[0]==='relay'&&c[1]==='brain'&&c[2]==='brain_context'));
 assert.ok(calls.some(c=>c[0]==='relay'&&c[1]==='factory'&&c[2]==='factory_direct_status'));
 // Provider status calls are mocked separately; no external provider APIs run.
 env.HUB_V2.relay=async()=>({receipt:{state:'RESPONDED'},response:{body:JSON.stringify({result:{content:[{type:'text',text:'{"status":"NOT_CONFIGURED"}'}]}})}});
 assert.equal((await value(await invoke('hub_connections'))).status,'CATALOG_LOADED');
 assert.ok(calls.some(c=>c[0]==='connections'));
 assert.deepEqual(calls.filter(c=>c[0]==='factory'),[['factory','GET','/health']]);
});
