// Network fixture only. The production runner, bundle verifier, extractor,
// current configuration overlay and spawned Wrangler command are real code.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
let uploaded=null;
const assetMetadata=(id,bytes)=>({id,name:'go-hub-bundle.json',state:'uploaded',digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),size:bytes.length});
const state=()=>JSON.parse(readFileSync(process.env.RELEASE_TEST_STATE,'utf8'));
const response=value=>Response.json(value);
globalThis.fetch=async(input,options={})=>{
 const url=new URL(input),s=state(),p=url.pathname;
 if(url.hostname==='job.actions.githubusercontent.com')return response({value:'test.oidc.signature'});
 if(url.hostname==='go-together.pureekangraw.workers.dev'){
  if(p==='/_release/acceptance'){const b=JSON.parse(options.body);if(process.env.RELEASE_TEST_FAIL_GO==='1'&&b.phase==='go')return new Response('',{status:403});return response({ok:true,goVersion:b.goVersion,goReadback:'VERIFIED',pending:'PRESERVED',privateRpc:b.phase==='final'?'VERIFIED':'NOT_RUN'});}
  if(p==='/api/factory-approvals'||p==='/mcp')return new Response('',{status:401});
  return new Response(s.html,{headers:{'cache-control':'no-store'}});
 }
 if(url.hostname==='api.github.com'){
  if(p.includes('/releases/assets/')){
   const id=Number(p.split('/').at(-1)),bytes=id===2?uploaded:readFileSync(process.env.RELEASE_TEST_RECOVERY);
   assert.ok(bytes,'asset must exist before readback');
   if(options.headers.accept==='application/octet-stream')return new Response(bytes);
   // Recovery metadata stays pinned so the tampered-download case reaches byte verification.
   return response({...assetMetadata(id,bytes),...(id===1?{digest:'sha256:'+process.env.RELEASE_TEST_RECOVERY_DIGEST}:{})});
  }
  if(p.endsWith('/releases')&&options.method==='POST')return response({id:99,upload_url:'https://uploads.github.com/repos/pureekangraw-ops/Go-Together/releases/99/assets{?name,label}'});
  if(p.endsWith('/releases/99/assets'))return response(uploaded?[assetMetadata(2,uploaded)]:[]);
 }
 if(url.hostname==='uploads.github.com'){
  assert.equal(options.headers.accept,'application/vnd.github+json');
  assert.equal(options.headers['content-type'],'application/octet-stream');
  assert.equal(uploaded,null,'no duplicate uploads');
  uploaded=Buffer.from(options.body);
  return Response.json(assetMetadata(2,uploaded),{status:201});
 }
 if(url.hostname==='api.cloudflare.com'){
  if(p==='/client/v4/zones')return response({success:true,result:[],result_info:{total_count:0}});
  if(p.endsWith('/workers/domains'))return response({success:true,result:[]});
  if(p.endsWith('/access/apps'))return response({success:true,result:[{id:'app',domain:'go-together.pureekangraw.workers.dev/api/*'}],result_info:{total_count:1}});
  if(p.endsWith('/policies'))return response({success:true,result:[{decision:'allow',include:[{email:{email:'owner@example.com'}}]}]});
  const worker=p.includes('/scripts/go-together/')?'go':'hub',v=s[worker];
  if(p.endsWith('/subdomain'))return response({success:true,result:{enabled:true}});
  if(p.endsWith('/deployments'))return response({success:true,result:{deployments:[{versions:[{version_id:v.id,percentage:100}]}]}});
  if(p.endsWith('/settings'))return response({success:true,result:{bindings:v.bindings}});
  if(p.includes('/versions/'))return response({success:true,result:{annotations:v.annotations,resources:{bindings:v.bindings,script:{etag:v.id}}}});
 }
 throw Error('UNEXPECTED_REMOTE_CALL '+url.hostname+p);
};
