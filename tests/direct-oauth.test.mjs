import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './hub-fixture.mjs';
const ROOT='https://go-together.pureekangraw.workers.dev';
const CLIENT='https://chatgpt.com/oauth/client.json';
const CALLBACK='https://chatgpt.com/connector_platform_oauth_redirect';
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const DB={prepare(query){const statement=sql.prepare(query);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {meta:{changes:Number(statement.run(...args).changes)}};}};}};
 const env={DB,BRAIN_OAUTH_SIGNING_KEY:'test-brain-only-key',BRAIN_OWNER_PASSCODE:'test-owner-passcode',BRAIN_AUTH_MODE:'DIRECT',ASSETS:{fetch:async()=>new Response('static')}};
 const call=(path,options={})=>worker.fetch(new Request(ROOT+path,options),env,{});
 return {sql,env,call};
}
async function grant(call){
 const verifier='a'.repeat(64);const challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const values={response_type:'code',client_id:CLIENT,redirect_uri:CALLBACK,resource:ROOT+'/mcp',scope:'brain-owner',code_challenge:challenge,code_challenge_method:'S256',state:'roundtrip',actor:'GO'};
 const page=await call('/oauth/authorize?'+new URLSearchParams(values));assert.equal(page.status,200);assert.match(await page.text(),/Owner passcode/);
 const authorized=await call('/oauth/authorize',{method:'POST',body:new URLSearchParams({...values,passcode:'test-owner-passcode'})});assert.equal(authorized.status,302);
 const dest=new URL(authorized.headers.get('location'));assert.equal(dest.origin+dest.pathname,CALLBACK);assert.equal(dest.searchParams.get('state'),'roundtrip');
 const form={grant_type:'authorization_code',client_id:CLIENT,redirect_uri:CALLBACK,resource:ROOT+'/mcp',code:dest.searchParams.get('code'),code_verifier:verifier};
 const result=await call('/oauth/token',{method:'POST',body:new URLSearchParams(form)});assert.equal(result.status,200);
 return {tokens:await result.json(),form};
}
const rpc=(call,method,args,token)=>call('/mcp',{method:'POST',headers:token?{authorization:'Bearer '+token}:{},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:args})});
test('direct discovery advertises CIMD PKCE and refresh without Cloudflare login',async()=>{const {call}=setup();const r=await call('/.well-known/oauth-authorization-server');assert.equal(r.status,200);const meta=await r.json();assert.equal(meta.issuer,ROOT);assert.equal(meta.client_id_metadata_document_supported,true);assert.deepEqual(meta.code_challenge_methods_supported,['S256']);assert.ok(meta.grant_types_supported.includes('refresh_token'));assert.deepEqual(meta.scopes_supported,['brain-owner']);});
test('public MCP discovery exposes catalog but anonymous calls cannot read memories',async()=>{const {call}=setup();const list=await rpc(call,'tools/list');assert.equal(list.status,200);assert.ok((await list.json()).result.tools.some(t=>t.name==='brain_list'));const r=await rpc(call,'tools/call',{name:'brain_list',arguments:{}});assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/oauth-protected-resource/);});
test('CIMD owner login save retrieve and soft-delete roundtrip',async()=>{const {call}=setup();const {tokens}=await grant(call);const invoke=async(name,args)=>{const r=await rpc(call,'tools/call',{name,arguments:args},tokens.access_token);assert.equal(r.status,200);const out=(await r.json()).result;assert.equal(out.isError,undefined);return JSON.parse(out.content[0].text);};const saved=await invoke('brain_save',{title:'OAuth acceptance test',content:'Synthetic test only'});const read=await invoke('brain_retrieve',{id:saved.id});assert.equal(read.content,'Synthetic test only');assert.equal(read.revision,1);const deleted=await invoke('brain_set_status',{id:saved.id,status:'deleted',expected_revision:1});assert.equal(deleted.status,'deleted');assert.equal((await invoke('brain_retrieve',{id:saved.id})).revision,2);});
test('authorization code replay and bad PKCE are rejected',async()=>{const {call}=setup();const {form}=await grant(call);const r=await call('/oauth/token',{method:'POST',body:new URLSearchParams(form)});assert.equal(r.status,400);const other=await call('/oauth/token',{method:'POST',body:new URLSearchParams({...form,code_verifier:'wrong'})});assert.equal(other.status,400);});
test('refresh rotation works and replay revokes its token family',async()=>{const {call}=setup();const {tokens}=await grant(call);const refresh=token=>call('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:CLIENT,resource:ROOT+'/mcp',refresh_token:token})});const r=await refresh(tokens.refresh_token);assert.equal(r.status,200);const rotated=await r.json();assert.equal((await rpc(call,'tools/call',{name:'brain_list',arguments:{}},rotated.access_token)).status,200);assert.equal((await refresh(tokens.refresh_token)).status,400);assert.equal((await refresh(rotated.refresh_token)).status,400);});
test('wrong owner passcode is rate limited and untrusted client cannot authorize',async()=>{const {call}=setup();const verifier='a'.repeat(64),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');const values={response_type:'code',client_id:CLIENT,redirect_uri:CALLBACK,resource:ROOT+'/mcp',scope:'brain-owner',code_challenge:challenge,code_challenge_method:'S256',actor:'GO',passcode:'wrong'};for(let n=0;n<5;n++)assert.equal((await call('/oauth/authorize',{method:'POST',body:new URLSearchParams(values)})).status,403);assert.equal((await call('/oauth/authorize',{method:'POST',body:new URLSearchParams(values)})).status,429);assert.equal((await call('/oauth/authorize?'+new URLSearchParams({...values,client_id:'https://evil.example/client.json'}))).status,400);});
test('Metro resource tokens cannot access GO Brain',async()=>{const {call}=setup();const {tokens}=await grant(call);const r=await call('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:CLIENT,resource:'https://metropolis.pureekangraw.workers.dev/mcp',refresh_token:tokens.refresh_token})});assert.equal(r.status,400);});

