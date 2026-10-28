// Trusted CI orchestration only. No tokens, response bodies or binding values enter artifacts/logs.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {validateBundle,materializeBundle} from './release-bundle.mjs';
const account='e100c4619cd8f6eff0ce6603756bc439';
const project='88036575';
const go='go-together',hub='ygg-connection-hub-v2';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const sha=/^[a-f0-9]{40}$/;
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const die=code=>{throw Error(code);};
export function inputs(e=process.env){
 // The readback contract accepts only the first run; refuse reruns before any effect.
 if(e.GITHUB_RUN_ATTEMPT!==undefined&&e.GITHUB_RUN_ATTEMPT!=='1')die('RELEASE_RERUN_REFUSED');
 const v={action:e.RELEASE_ACTION,releaseId:e.RELEASE_ID,requestId:e.RELEASE_REQUEST_ID,goSha:e.RELEASE_GO_SHA,hubSha:e.RELEASE_HUB_SHA,goVersion:e.RELEASE_GO_BASELINE,hubVersion:e.RELEASE_HUB_BASELINE};
 if(!['prepare','start','rollback'].includes(v.action)||!/^[-a-z0-9]{1,60}$/.test(v.releaseId||'')||!uuid.test(v.requestId||'')||!sha.test(v.goSha||'')||!sha.test(v.hubSha||'')||!uuid.test(v.goVersion||'')||!uuid.test(v.hubVersion||'')||e.RELEASE_CONFIRM!==(v.action==='prepare'?'PREPARE ':v.action==='start'?'DEPLOY ':'ROLLBACK ')+v.releaseId)die('INVALID_RELEASE_INPUTS');
 return v;
}
export function bindingsFingerprint(bindings,{correctEntrypoints=false}={}){
 if(!Array.isArray(bindings))die('BINDINGS_UNAVAILABLE');
 return bindings.map(b=>{
  const copy={...b};
  if(correctEntrypoints&&b.type==='service'&&b.name==='OBSERVATORY_GO')copy.entrypoint='ObservatoryGoBridge';
  if(correctEntrypoints&&b.type==='service'&&b.name==='GOVIEW_GO')copy.entrypoint='GoviewGoBridge';
  return {name:b.name,type:b.type,digest:hash(copy)};
 }).filter(b=>!['CF_VERSION_METADATA','ASSETS'].includes(b.name)).sort((a,b)=>a.name.localeCompare(b.name));
}
export function assertPreserved(before,after){
 if(before.some(b=>b.type==='assets')&&!after.some(b=>b.type==='assets'))die('ASSETS_BINDING_REMOVED');
 if(JSON.stringify(bindingsFingerprint(before,{correctEntrypoints:true}))!==JSON.stringify(bindingsFingerprint(after)))die('BINDINGS_CHANGED');
}
export function assertActive(d,expected){
 const versions=d?.result?.deployments?.[0]?.versions;
 if(!Array.isArray(versions)||versions.length!==1||versions[0].percentage!==100||!uuid.test(versions[0].version_id||''))die('TRAFFIC_ALLOCATION_UNVERIFIED');
 if(expected&&versions[0].version_id!==expected)die('PRODUCTION_DRIFT');
 return versions[0].version_id;
}
async function api(path,{method='GET',body,gitlab=false}={}){
 const token=gitlab?process.env.GITLAB_SOURCE_TOKEN:process.env.CLOUDFLARE_API_TOKEN;
 if(!token)die(gitlab?'MISSING_GITLAB_SOURCE_TOKEN':'MISSING_CLOUDFLARE_API_TOKEN');
 if(!gitlab&&process.env.CLOUDFLARE_ACCOUNT_ID!==account)die('CLOUDFLARE_ACCOUNT_MISMATCH');
 const headers={accept:'application/json',...(gitlab?{'private-token':token}:{authorization:'Bearer '+token})};
 if(body!==undefined)headers['content-type']='application/json';
 let r;try{r=await fetch((gitlab?'https://gitlab.com/api/v4':'https://api.cloudflare.com/client/v4')+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{die(method==='GET'?'PROVIDER_READ_FAILED':'UNKNOWN_DELIVERY_DO_NOT_RETRY');}
 if(!r.ok){await r.body?.cancel();die('PROVIDER_HTTP_'+r.status);}
 // API responses have bounded finite metadata; reject oversized bodies while streaming.
 const reader=r.body.getReader();let length=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2097152)die('PROVIDER_RESPONSE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const data=JSON.parse(Buffer.concat(chunks).toString());if(!gitlab&&data.success!==true)die('CLOUDFLARE_OPERATION_FAILED');return data;
}
const path=worker=>'/accounts/'+account+'/workers/scripts/'+worker;
async function snapshot(worker,expected){
 const [d,s,domains,subdomain,zones]=await Promise.all([api(path(worker)+'/deployments'),api(path(worker)+'/settings'),api('/accounts/'+account+'/workers/domains'),api(path(worker)+'/subdomain'),api('/zones?account.id='+account+'&per_page=50')]);
 if(zones.result_info?.total_count>50)die('ROUTE_SNAPSHOT_INCOMPLETE');
 const routes=[];for(const z of zones.result){const r=await api('/zones/'+z.id+'/workers/routes');routes.push({zone:z.id,routes:r.result});}
 const id=assertActive(d,expected),v=await api(path(worker)+'/versions/'+id);
 if(!v.result?.resources?.bindings||!s.result?.bindings)die('ACTIVE_VERSION_UNREADABLE');
 return {id,bindings:s.result.bindings,versionBindings:v.result.resources.bindings,annotations:v.result.annotations||{},scriptEtag:v.result.resources?.script?.etag,assetIdentity:'NOT_EXPOSED_BY_VERSION_METADATA',routesHash:hash(routes),domainsHash:hash({domains:domains.result,subdomain:subdomain.result})};
}
function receiptPath(){return (process.env.RELEASE_ARTIFACT_DIR||'release-receipt')+'/receipt.json';}
function writeReceipt(v){mkdirSync(process.env.RELEASE_ARTIFACT_DIR||'release-receipt',{recursive:true});writeFileSync(receiptPath(),JSON.stringify(v,null,2)+'\n');}
function readReceipt(){return JSON.parse(readFileSync(receiptPath(),'utf8'));}
function run(cmd,args,options={}){execFileSync(cmd,args,{stdio:'inherit',...options});}
function wrangler(args){run(process.execPath,[resolve('.github/runner/patch-wrangler.cjs'),'--verify']);try{execFileSync(process.execPath,[resolve('.github/runner/node_modules/wrangler/bin/wrangler.js'),...args],{stdio:'pipe',maxBuffer:2*1024*1024});}catch(e){const status=String(e.stderr||'').match(/\b(401|403|429)\b/)?.[1];die(status?'CLOUDFLARE_DEPLOY_HTTP_'+status:'WRANGLER_COMMAND_FAILED');}}
async function accessSnapshot(){
 const apps=await api('/accounts/'+account+'/access/apps?per_page=100');
 if(apps.result_info?.total_count>100)die('ACCESS_SNAPSHOT_INCOMPLETE');
 const relevant=apps.result.filter(a=>String(a.domain||'').includes('go-together')||String(a.domain||'').includes('ygg-connection-hub-v2'));
 if(!relevant.length)die('ACCESS_CONFIGURATION_UNVERIFIED');
 const policies=[];for(const app of relevant){const p=await api('/accounts/'+account+'/access/apps/'+app.id+'/policies');policies.push({id:app.id,domain:app.domain,aud:app.aud,policies:p.result});}
 return hash(policies);
}
async function publicAcceptance(v,htmlPath){
 const origin='https://go-together.pureekangraw.workers.dev';
 const r=await fetch(origin+'/?release='+v.requestId,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'cache-control':'no-cache'}});
 if(r.status===302||r.status===403)die('OWNER_ACCESS_READBACK_REQUIRED');
 if(r.status!==200)die('GO_HTML_UNAVAILABLE');
 const actual=Buffer.from(await r.arrayBuffer());if(actual.length>1048576)die('GO_HTML_TOO_LARGE');
 if(createHash('sha256').update(actual).digest('hex')!==createHash('sha256').update(readFileSync(htmlPath)).digest('hex'))die('GO_ASSET_BYTES_MISMATCH');
 if(!/no-store/i.test(r.headers.get('cache-control')||''))die('GO_STATIC_CACHE_UNSAFE');
 for(const route of ['/api/factory-approvals','/mcp']){
  const denied=await fetch(origin+route,{method:route==='/mcp'?'POST':'GET',body:route==='/mcp'?'{}':undefined,redirect:'manual',signal:AbortSignal.timeout(15000)});
  await denied.body?.cancel();if(![302,401,403].includes(denied.status))die('PUBLIC_OWNER_API_NOT_DENIED');
 }
 return {htmlSha256:createHash('sha256').update(actual).digest('hex'),unauthenticatedApi:'DENIED',ownerBrowser:'NOT_VERIFIED'};
}
async function privateAcceptance(v,goVersion,phase='go',artifact=null){
 const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'https://invalid.invalid');
 if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com')||url.username||url.password||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)die('GITHUB_OIDC_NOT_CONFIGURED');
 url.searchParams.set('audience','go-release:'+v.requestId);
 const r=await fetch(url,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(!r.ok)die('GITHUB_OIDC_UNAVAILABLE');
 const raw=await r.text();if(raw.length>20000)die('GITHUB_OIDC_RESPONSE_TOO_LARGE');
 const token=JSON.parse(raw).value;if(typeof token!=='string'||token.length>16000)die('GITHUB_OIDC_INVALID');
 const response=await fetch('https://go-together.pureekangraw.workers.dev/_release/acceptance',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({requestId:v.requestId,goVersion,phase,...(artifact?{artifact:{assetId:artifact.assetId,releaseId:artifact.releaseId,sha256:artifact.sha256}}:{})}),redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(!response.ok){await response.body?.cancel();die('PRIVATE_GO_ACCEPTANCE_UNAVAILABLE');}
 const text=await response.text();if(text.length>4096)die('PRIVATE_GO_ACCEPTANCE_INVALID');const result=JSON.parse(text);
 if(result.ok!==true||result.goVersion!==goVersion||result.pending!=='PRESERVED'||result.goReadback!=='VERIFIED'||(phase==='final'&&result.privateRpc!=='VERIFIED'))die('PRIVATE_GO_ACCEPTANCE_FAILED');
 return result;
}
const repo='pureekangraw-ops/Go-Together';
async function boundedBytes(response,max=32*1024*1024){
 const reader=response.body?.getReader();if(!reader)die('PROVIDER_EMPTY_RESPONSE');const chunks=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max)die('PROVIDER_RESPONSE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks);
}
export async function github(pathname,{method='GET',body,raw=false,upload=false}={}){
 const token=process.env.GITHUB_TOKEN;if(!token)die('MISSING_GITHUB_RUNNER_TOKEN');
 const r=await fetch((upload?'https://uploads.github.com':'https://api.github.com')+'/repos/'+repo+pathname,{method,headers:{authorization:'Bearer '+token,accept:raw?'application/octet-stream':'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'GO-Release-Runner',...(body!==undefined?{'content-type':upload?'application/octet-stream':'application/json'}:{})},body:body===undefined?undefined:raw?body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(raw&&method==='GET'&&r.status===302){const to=new URL(r.headers.get('location')||'https://invalid.invalid');await r.body?.cancel();if(to.protocol!=='https:'||!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(to.hostname)||to.username||to.password)die('ARTIFACT_REDIRECT_REFUSED');const downloaded=await fetch(to,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!downloaded.ok)die('ARTIFACT_DOWNLOAD_FAILED');return boundedBytes(downloaded);}
 if(!r.ok){await r.body?.cancel();die((method==='GET'?'GITHUB_HTTP_':'GITHUB_MUTATION_UNKNOWN_HTTP_')+r.status);}
 const bytes=await boundedBytes(r);return raw&&method==='GET'?bytes:JSON.parse(bytes);
}
export function trustedManifest(v,m,{recoveryRequired=true}={}){
 if(!m||m.controllerReviewed!==true)die('CONTROL_SOURCE_REVIEW_REQUIRED');
 const intended=v.action==='prepare'&&m.bootstrap===true&&m.bootstrapSources?{...m,...m.bootstrapSources}:m;
 for(const k of ['releaseId','goSha','hubSha','goVersion','hubVersion'])if(intended[k]!==v[k])die('APPROVED_MANIFEST_MISMATCH');
 if(recoveryRequired){const r=m.recovery;if(!r||!Number.isSafeInteger(r.assetId)||r.assetId<=0||!/^[a-f0-9]{64}$/.test(r.sha256||'')||!/^[a-f0-9]{40}$/.test(r.goSha||'')||!/^[a-f0-9]{40}$/.test(r.hubSha||''))die('APPROVED_RECOVERY_BUNDLE_REQUIRED');}
 return m;
}
function manifest(v,requireRecovery=true){return trustedManifest(v,JSON.parse(readFileSync('.github/release-manifest.json','utf8')),{recoveryRequired:requireRecovery});}
function configs(){if(!process.env.RELEASE_HUB_CONFIG_PATH)die('PRIVATE_HUB_INFRASTRUCTURE_REQUIRED');return {go:JSON.parse(readFileSync('.github/release-infrastructure/go.json','utf8')),hub:JSON.parse(readFileSync(process.env.RELEASE_HUB_CONFIG_PATH,'utf8'))};}
function materialize(bytes,digest){return materializeBundle(bytes,digest,configs(),mkdtempSync(join(tmpdir(),'go-release-payload-')));}
export function assertInfrastructurePlan(live,config){
 const services=new Map((config.services||[]).map(x=>[x.binding,x]));
 const databases=new Map((config.d1_databases||[]).map(x=>[x.binding,x]));
 const stores=new Map((config.secrets_store_secrets||[]).map(x=>[x.binding,x]));
 for(const b of live){
  if(b.type==='service'){const next=services.get(b.name);if(!next||next.service!==b.service)die('INFRASTRUCTURE_SERVICE_DRIFT');const repaired=b.name==='OBSERVATORY_GO'?'ObservatoryGoBridge':b.name==='GOVIEW_GO'?'GoviewGoBridge':null;if((b.entrypoint||'')!==(next.entrypoint||'')&&!(repaired&&!b.entrypoint&&next.entrypoint===repaired))die('INFRASTRUCTURE_ENTRYPOINT_DRIFT');}
  else if(b.type==='d1'){if(databases.get(b.name)?.database_id!==(b.id||b.database_id))die('INFRASTRUCTURE_DATABASE_DRIFT');}
  else if(b.type==='secrets_store_secret'){const next=stores.get(b.name);if(!next||next.store_id!==b.store_id||next.secret_name!==b.secret_name)die('INFRASTRUCTURE_SECRETS_STORE_DRIFT');}
  else if(b.type==='plain_text'&&Object.hasOwn(config.vars||{},b.name)&&String(config.vars[b.name])!==b.text)die('INFRASTRUCTURE_VARIABLE_DRIFT');
  else if(b.type==='assets'&&config.assets?.binding!==b.name)die('INFRASTRUCTURE_ASSETS_DRIFT');
  else if(!['plain_text','json','secret_text','secret_key','version_metadata','assets'].includes(b.type))die('INFRASTRUCTURE_UNSUPPORTED_BINDING');
 }
}
async function approvedRecovery(m){
 const metadata=await github('/releases/assets/'+m.recovery.assetId);if(metadata.id!==m.recovery.assetId||metadata.state!=='uploaded'||metadata.name!=='go-hub-bundle.json'||metadata.size>32*1024*1024)die('RECOVERY_ASSET_UNAVAILABLE');
 if(metadata.digest&&metadata.digest!=='sha256:'+m.recovery.sha256)die('RECOVERY_ASSET_DIGEST_MISMATCH');
 const bytes=await github('/releases/assets/'+m.recovery.assetId,{raw:true});const v=validateBundle(bytes,m.recovery.sha256);if(v.controllerAbi===0&&m.bootstrap!==true)die('LEGACY_RECOVERY_BOOTSTRAP_ONLY');if(v.sources.go!==m.recovery.goSha||v.sources.hub!==m.recovery.hubSha)die('RECOVERY_SOURCE_MISMATCH');return materialize(bytes,m.recovery.sha256);
}
async function publishBundle(v,bytes,digest){
 const payload=validateBundle(bytes,digest);if(payload.controllerAbi===0&&!(v.action==='prepare'&&manifest(v,false).bootstrap===true))die('LEGACY_PREPARATION_BOOTSTRAP_ONLY');if(payload.sources.go!==v.goSha||payload.sources.hub!==v.hubSha)die('CANDIDATE_SOURCE_MISMATCH');
 // Draft release assets have no CI retention expiry. Never overwrite an existing release/asset.
 const created=await github('/releases',{method:'POST',body:{tag_name:'go-hub-'+v.releaseId+'-'+v.requestId,target_commitish:process.env.GITHUB_SHA,name:'GO/Hub '+v.releaseId,draft:true,make_latest:'false',body:'Pinned build artifact; production and owner acceptance are recorded separately. SHA-256: '+digest}});
 if(!Number.isSafeInteger(created.id))die('ARTIFACT_PUBLICATION_UNKNOWN');
 const asset=await github('/releases/'+created.id+'/assets?name=go-hub-bundle.json',{method:'POST',raw:true,upload:true,body:bytes});
 if(!Number.isSafeInteger(asset.id)||asset.state!=='uploaded')die('ARTIFACT_PUBLICATION_UNKNOWN');return {releaseId:created.id,assetId:asset.id,sha256:digest,sources:payload.sources,controllerAbi:payload.controllerAbi,runtimeVerified:false};
}
export async function fetchHub(v){
 // GitLab archive API returned HTTP 406 on a real protected runner. Git-over-HTTPS
 // is GitLab's supported repository transport. Keep one fixed remote and exact commit.
 if(!process.env.GITLAB_SOURCE_TOKEN)die('MISSING_GITLAB_SOURCE_TOKEN');
 const commit=await api('/projects/'+project+'/repository/commits/'+v.hubSha,{gitlab:true});
 if(commit.id!==v.hubSha)die('HUB_SOURCE_MISMATCH');
 const target=resolve(process.env.RELEASE_HUB_SOURCE_DIR||'sources/hub');
 mkdirSync(target,{recursive:true});
 if(readdirSync(target).length)die('HUB_SOURCE_TARGET_NOT_EMPTY');
 const helper=join(mkdtempSync(join(tmpdir(),'go-hub-askpass-')),'askpass.sh');
 // Git asks for a password via a private temporary helper, never via argv/URL/log.
 writeFileSync(helper,"#!/bin/sh\ncase \"$1\" in\n*Username*) printf 'oauth2\\n' ;;\n*Password*) printf '%s\\n' \"$GITLAB_SOURCE_TOKEN\" ;;\n*) exit 1 ;;\nesac\n",{mode:0o700});
 const gitEnv={...process.env,GIT_ASKPASS:helper,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'};
 const git=args=>{
  try{return execFileSync('git',args,{env:gitEnv,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024,timeout:180000}).trim();}
  catch{die('HUB_GIT_FETCH_FAILED');}
 };
 git(['init','-q',target]);
 git(['-C',target,'remote','add','origin','https://gitlab.com/pureekangraw/hubstation.git']);
 // Fetch history on the one approved recovery source, then detach at exact SHA.
 // Do not rely on arbitrary SHA fetch being allowed by every GitLab server.
 git(['-C',target,'-c','credential.helper=','fetch','-q','--no-tags','origin','refs/heads/recovery/hub-v21-e4d7a9c1']);
 const found=git(['-C',target,'rev-parse',v.hubSha+'^{commit}']);
 if(found!==v.hubSha)die('HUB_SOURCE_COMMIT_NOT_REACHABLE');
 git(['-C',target,'checkout','-q','--detach',v.hubSha]);
 if(git(['-C',target,'rev-parse','HEAD'])!==v.hubSha)die('HUB_CHECKOUT_SOURCE_MISMATCH');
 writeFileSync(join(target,'.release-source-sha'),v.hubSha+'\n');
 console.log('HUB_SOURCE_PINNED '+v.hubSha);
}
async function deploy(kind,target,v,expected,tag){
 const worker=kind==='go'?go:hub,before=await snapshot(worker,expected),current=configs()[kind];assertInfrastructurePlan(before.bindings,current);const accessHash=await accessSnapshot();
 wrangler(['deploy','--config',target.config,'--keep-vars','--tag',tag,'--message',target.sourceSha]);
 const after=await snapshot(worker);assertPreserved(before.bindings,after.bindings);
 if(before.routesHash!==after.routesHash||before.domainsHash!==after.domainsHash||accessHash!==await accessSnapshot())die('ROUTING_OR_ACCESS_CHANGED');
 if(after.annotations['workers/tag']!==tag||after.annotations['workers/message']!==target.sourceSha)die('DEPLOYED_SOURCE_UNVERIFIED');
 return {previousVersion:before.id,version:after.id,sourceSha:target.sourceSha,infrastructureDigest:hash(current),bindingsFingerprint:bindingsFingerprint(after.bindings),accessHash};
}
async function restore(v,m,automatic){
 let receipt;try{receipt=readReceipt();}catch{if(automatic){console.log('NO_DEPLOYMENT_RECEIPT');return;}receipt={...v};}
 if(receipt.requestId!==v.requestId&&automatic)die('RECOVERY_RECEIPT_MISMATCH');
 const recovery=await approvedRecovery(m),states={go:await snapshot(go),hub:await snapshot(hub)},tag='rollback-'+v.requestId;
 const original=automatic?v.requestId:process.env.RELEASE_ORIGINAL_REQUEST_ID;
 const changes=[];
 for(const [kind,s] of Object.entries(states)){
  if(automatic&&s.id===v[kind+'Version'])continue;
  if(s.annotations['workers/tag']!==original||s.annotations['workers/message']!==v[kind+'Sha'])die('RECOVERY_PRODUCTION_DRIFT');
  assertInfrastructurePlan(s.bindings,configs()[kind]);changes.push(kind);
 }
 // Validate the complete fallback bundle and both current infrastructure plans before any effect.
 const restored={};for(const kind of ['hub','go'].filter(k=>changes.includes(k)))restored[kind]=await deploy(kind,recovery[kind],v,states[kind].id,tag);
 const liveGo=restored.go?.version||states.go.id;let acceptance=null;if(changes.length){if(recovery.manifest.controllerAbi===0)acceptance={...await publicAcceptance(v,join(dirnameOfConfig(recovery.go.config),'static/index.html')),privateRpc:'NOT_AVAILABLE_IN_LEGACY_BOOTSTRAP',pending:'NOT_VERIFIED'};else acceptance=await privateAcceptance(v,liveGo,changes.includes('hub')?'final':'go');}
 writeReceipt({...receipt,status:automatic?'FAILED_RECOVERED':'RECOVERED',recovery:{assetId:m.recovery.assetId,sha256:m.recovery.sha256,sources:{go:m.recovery.goSha,hub:m.recovery.hubSha},versions:restored},acceptance});
}
async function main(stage){
 const v=inputs();if(v.action==='rollback'&&!uuid.test(process.env.RELEASE_ORIGINAL_REQUEST_ID||''))die('ROLLBACK_ORIGINAL_REQUEST_REQUIRED');
 if(stage==='validate')return;
 const m=manifest(v,v.action!=='prepare');
 if(stage==='manifest')return;
 if(stage==='fetch-infrastructure'){
  const ref=m.hubInfrastructureSha||m.hubSha;if(!sha.test(ref))die('INFRASTRUCTURE_SOURCE_INVALID');
  const f=await api('/projects/'+project+'/repository/files/release-infrastructure%2Fhub.json?ref='+ref,{gitlab:true});
  if(f.encoding!=='base64'||typeof f.content!=='string'||f.size>65536||!process.env.RELEASE_HUB_CONFIG_PATH)die('PRIVATE_HUB_INFRASTRUCTURE_INVALID');
  const bytes=Buffer.from(f.content.replace(/\s/g,''),'base64');const cfg=JSON.parse(bytes);if(cfg.name!==hub)die('PRIVATE_HUB_INFRASTRUCTURE_INVALID');
  writeFileSync(process.env.RELEASE_HUB_CONFIG_PATH,bytes,{mode:0o600});return;
 }
 if(stage==='fetch-hub'){await fetchHub(v);return;}
 if(stage==='source'){
  const root=resolve(process.env.RELEASE_GO_SOURCE_DIR||'sources/go');if(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==v.goSha)die('CHECKOUT_SOURCE_MISMATCH');
  execFileSync('git',['-C',root,'diff','--exit-code'],{stdio:'pipe'});return;
 }
 if(stage==='bundle-check'){
  const bytes=readFileSync('go-hub-bundle.json'),digest=createHash('sha256').update(bytes).digest('hex'),payload=materialize(bytes,digest);
  if(payload.manifest.sources.go!==v.goSha||payload.manifest.sources.hub!==v.hubSha)die('CANDIDATE_SOURCE_MISMATCH');
  for(const kind of ['go','hub'])wrangler(['deploy','--config',payload[kind].config,'--dry-run','--outdir',join(mkdtempSync(join(tmpdir(),'go-payload-preflight-')),kind)]);
  return;
 }
 if(stage==='publish'||stage==='deploy'){
  const bytes=readFileSync(process.env.RELEASE_BUNDLE_PATH||'go-hub-bundle.json'),digest=createHash('sha256').update(bytes).digest('hex');const candidate=materialize(bytes,digest);
  if(stage==='deploy'&&candidate.manifest.controllerAbi!==2)die('CANDIDATE_CONTROL_ABI_REQUIRED');
  if(candidate.manifest.sources.go!==v.goSha||candidate.manifest.sources.hub!==v.hubSha)die('CANDIDATE_SOURCE_MISMATCH');
  // Recovery is fetched/verified before production mutation, not after a failure.
  if(stage==='deploy'){
   await approvedRecovery(m);const [g,h]=await Promise.all([snapshot(go,v.goVersion),snapshot(hub,v.hubVersion)]);assertInfrastructurePlan(g.bindings,configs().go);assertInfrastructurePlan(h.bindings,configs().hub);
  }
  writeReceipt({...v,status:'ARTIFACT_PUBLICATION_IN_PROGRESS',candidateDigest:digest});const artifact=await publishBundle(v,bytes,digest);writeReceipt({...v,artifact,status:'PREPARED'});
  if(stage==='publish')return;
  const deployedGo=await deploy('go',candidate.go,v,v.goVersion,v.requestId);writeReceipt({...readReceipt(),go:deployedGo,status:'GO_DEPLOYED'});
  const goAcceptance={...await publicAcceptance(v,join(dirnameOfConfig(candidate.go.config),'static/index.html')),...await privateAcceptance(v,deployedGo.version,'go')};
  writeReceipt({...readReceipt(),goAcceptance,status:'GO_VERIFIED'});
  const deployedHub=await deploy('hub',candidate.hub,v,v.hubVersion,v.requestId);writeReceipt({...readReceipt(),hub:deployedHub,status:'HUB_DEPLOYED'});
  const acceptance=await privateAcceptance(v,deployedGo.version,'final',artifact);writeReceipt({...readReceipt(),status:'DEPLOYED',acceptance,artifact:{...artifact,runtimeVerified:true}});return;
 }
 if(stage==='recover'){await restore(v,m,true);return;}
 if(stage==='rollback'){await restore(v,m,false);return;}
 die('UNKNOWN_RUNNER_STAGE');
}
const dirnameOfConfig=file=>resolve(file,'..');
if(process.argv[1]===fileURLToPath(import.meta.url))main(process.argv[2]).catch(e=>{const code=/^[A-Z_0-9]+$/.test(e.message)?e.message:'RELEASE_RUNNER_FAILED';console.error(code);if(code!=='RELEASE_RERUN_REFUSED')try{writeReceipt({...readReceipt(),status:'UNKNOWN',code});}catch{}process.exitCode=1;});
