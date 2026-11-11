import test from 'node:test';
import assert from 'node:assert/strict';
import {createOAuthHandler,verifyAccessToken} from '../worker/mcp-oauth.mjs';
const ROOT='https://go-together.pureekangraw.workers.dev';
const NOTION='https://app.notion.com/oauth/mcp-client-metadata.json';
const CALLBACK='https://app.notion.com/workflows/mcp/oauth/callback';
const CHATGPT='https://chatgpt.com/oauth/client.json';
const CHATGPT_CALLBACK='https://chatgpt.com/connector_platform_oauth_redirect';
function setup(){
 const used=new Set(),revoked=new Set();
 const config={issuer:ROOT,resource:ROOT+'/mcp',signingKey:'synthetic-test-signing-key',ownerPasscode:'synthetic-test-passcode',ownerId:'BIG',allowCimd:true,requireClientId:true,
 fetchImpl:async()=>{throw new Error('pinned clients must not fetch metadata');},
 ledger:{consume:async key=>{if(used.has(key))return false;used.add(key);return true;},blocked:async()=>false,failure:async()=>{},refreshFamilyRevoked:async key=>revoked.has(key),revokeRefreshFamily:async key=>revoked.add(key)}};
 return {config,handle:createOAuthHandler(config)};
}
async function params(client=NOTION,callback=CALLBACK){
 const verifier='a'.repeat(64);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 const challenge=Buffer.from(digest).toString('base64url');
 return {verifier,form:new URLSearchParams({response_type:'code',client_id:client,redirect_uri:callback,code_challenge:challenge,code_challenge_method:'S256',scope:'brain-owner',resource:ROOT+'/mcp',state:'owner-state'})};
}
function post(handle,path,form){return handle(new Request(ROOT+path,{method:'POST',body:form}));}
async function authorize(handle,config,client=NOTION,callback=CALLBACK){
 const {verifier,form}=await params(client,callback);
 form.set('passcode',config.ownerPasscode);
 const response=await post(handle,'/oauth/authorize',form);
 assert.equal(response.status,302,await response.clone().text());
 const location=new URL(response.headers.get('location'));
 assert.equal(location.origin+location.pathname,callback);
 assert.equal(location.searchParams.get('state'),'owner-state');
 const exchange=new URLSearchParams({grant_type:'authorization_code',client_id:client,redirect_uri:callback,resource:ROOT+'/mcp',code:location.searchParams.get('code'),code_verifier:verifier});
 return exchange;
}
test('Notion CIMD opens the owner authorization page without a client secret',async()=>{
 const {handle}=setup(),{form}=await params();
 const r=await handle(new Request(ROOT+'/oauth/authorize?'+form));
 assert.equal(r.status,200,await r.clone().text());
 assert.match(await r.text(),/Owner passcode/);
});
test('Notion authorization code exchange produces a verified resource-bound token',async()=>{
 const {handle,config}=setup(),form=await authorize(handle,config);
 const r=await post(handle,'/oauth/token',form);
 assert.equal(r.status,200,await r.clone().text());
 const tokens=await r.json();
 const identity=await verifyAccessToken(new Request(ROOT+'/mcp',{headers:{authorization:'Bearer '+tokens.access_token}}),config);
 assert.equal(identity.owner,'BIG');assert.equal(identity.actor,'GO');assert.equal(identity.scope,'brain-owner');
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('Notion refresh token rotates and detects replay',async()=>{
 const {handle,config}=setup(),form=await authorize(handle,config);
 const tokens=await (await post(handle,'/oauth/token',form)).json();
 const refresh=new URLSearchParams({grant_type:'refresh_token',client_id:NOTION,refresh_token:tokens.refresh_token,resource:ROOT+'/mcp'});
 const r=await post(handle,'/oauth/token',refresh);assert.equal(r.status,200);
 const rotated=await r.json();assert.notEqual(rotated.refresh_token,tokens.refresh_token);
 assert.equal((await post(handle,'/oauth/token',refresh)).status,400);
 refresh.set('refresh_token',rotated.refresh_token);
 assert.equal((await post(handle,'/oauth/token',refresh)).status,400);
});
test('Notion code cannot be exchanged twice',async()=>{
 const {handle,config}=setup(),form=await authorize(handle,config);
 assert.equal((await post(handle,'/oauth/token',form)).status,200);
 assert.equal((await post(handle,'/oauth/token',form)).status,400);
});
test('Notion requires the correct PKCE verifier',async()=>{
 const {handle,config}=setup(),form=await authorize(handle,config);
 form.set('code_verifier','incorrect');
 assert.equal((await post(handle,'/oauth/token',form)).status,400);
});
test('Notion requires owner authorization',async()=>{
 const {handle}=setup(),{form}=await params();form.set('passcode','incorrect');
 assert.equal((await post(handle,'/oauth/authorize',form)).status,403);
});
test('Notion token is rejected by a different resource',async()=>{
 const {handle,config}=setup(),form=await authorize(handle,config);
 const tokens=await (await post(handle,'/oauth/token',form)).json();
 await assert.rejects(verifyAccessToken(new Request(ROOT+'/mcp',{headers:{authorization:'Bearer '+tokens.access_token}}),{...config,resource:ROOT+'/different'}),/invalid access token/);
});
test('ChatGPT authorization and bearer verification still work',async()=>{
 const {handle,config}=setup(),form=await authorize(handle,config,CHATGPT,CHATGPT_CALLBACK);
 const r=await post(handle,'/oauth/token',form);assert.equal(r.status,200);
 const tokens=await r.json();
 assert.equal((await verifyAccessToken(new Request(ROOT+'/mcp',{headers:{authorization:'Bearer '+tokens.access_token}}),config)).actor,'GO');
});
for(const client of ['https://app.notion.com.evil.example/oauth/mcp-client-metadata.json','https://app.notion.com/oauth/other.json',NOTION+'?other=1','https://user@app.notion.com/oauth/mcp-client-metadata.json']){
 test('reject untrusted client '+client,async()=>{
  const {handle}=setup(),{form}=await params(client);
  const r=await handle(new Request(ROOT+'/oauth/authorize?'+form));
  assert.equal(r.status,400);assert.equal((await r.json()).code,'OAUTH_INVALID_CLIENT');
 });
}
test('Notion cannot change its redirect URI',async()=>{
 const {handle}=setup(),{form}=await params(NOTION,'https://evil.example/callback');
 const r=await handle(new Request(ROOT+'/oauth/authorize?'+form));
 assert.equal(r.status,400);assert.equal((await r.json()).code,'OAUTH_INVALID_REDIRECT_URI');
});
test('Notion cannot request a different scope',async()=>{
 const {handle}=setup(),{form}=await params();form.set('scope','admin');
 const r=await handle(new Request(ROOT+'/oauth/authorize?'+form));
 assert.equal(r.status,400);assert.equal((await r.json()).code,'OAUTH_SCOPE_IDENTITY_MISMATCH');
});
