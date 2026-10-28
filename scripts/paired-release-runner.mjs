// Trusted CI orchestration only. No tokens, response bodies or binding values enter artifacts/logs.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const account='e100c4619cd8f6eff0ce6603756bc439';
const project='88036575';
const branch='recovery/hub-v21-e4d7a9c1';
const go='go-together',hub='ygg-connection-hub-v2';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const sha=/^[a-f0-9]{40}$/;
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const die=code=>{throw Error(code);};
export function inputs(e=process.env){
 const v={action:e.RELEASE_ACTION,releaseId:e.RELEASE_ID,requestId:e.RELEASE_REQUEST_ID,goSha:e.RELEASE_GO_SHA,hubSha:e.RELEASE_HUB_SHA,goVersion:e.RELEASE_GO_BASELINE,hubVersion:e.RELEASE_HUB_BASELINE};
 if(!['start','rollback'].includes(v.action)||!/^[-a-z0-9]{1,60}$/.test(v.releaseId||'')||!uuid.test(v.requestId||'')||!sha.test(v.goSha||'')||!sha.test(v.hubSha||'')||!uuid.test(v.goVersion||'')||!uuid.test(v.hubVersion||'')||e.RELEASE_CONFIRM!==(v.action==='start'?'DEPLOY ':'ROLLBACK ')+v.releaseId)die('INVALID_RELEASE_INPUTS');
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
 const token=gitlab?process.env.GITLAB_RELEASE_TOKEN:process.env.CLOUDFLARE_API_TOKEN;
 if(!token)die(gitlab?'MISSING_GITLAB_RELEASE_TOKEN':'MISSING_CLOUDFLARE_API_TOKEN');
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
 if(!v.result?.resources?.bindings||!s.result?.bindings)die('ROLLBACK_VERSION_UNAVAILABLE');
 return {id,bindings:s.result.bindings,versionBindings:v.result.resources.bindings,annotations:v.result.annotations||{},scriptEtag:v.result.resources?.script?.etag,assetIdentity:'NOT_EXPOSED_BY_VERSION_METADATA',routesHash:hash(routes),domainsHash:hash({domains:domains.result,subdomain:subdomain.result})};
}
function receiptPath(){return (process.env.RELEASE_ARTIFACT_DIR||'release-receipt')+'/receipt.json';}
function writeReceipt(v){mkdirSync(process.env.RELEASE_ARTIFACT_DIR||'release-receipt',{recursive:true});writeFileSync(receiptPath(),JSON.stringify(v,null,2)+'\n');}
function readReceipt(){return JSON.parse(readFileSync(receiptPath(),'utf8'));}
function run(cmd,args,options={}){execFileSync(cmd,args,{stdio:'inherit',...options});}
function controllerPresent(worker){const file=worker===go?'worker/index.js':'src/entry.js';if(!readFileSync(file,'utf8').includes('releaseControl'))die('CONTROL_SOURCE_REVIEW_REQUIRED');}
async function accessSnapshot(){
 const apps=await api('/accounts/'+account+'/access/apps?per_page=100');
 if(apps.result_info?.total_count>100)die('ACCESS_SNAPSHOT_INCOMPLETE');
 const relevant=apps.result.filter(a=>String(a.domain||'').includes('go-together')||String(a.domain||'').includes('ygg-connection-hub-v2'));
 if(!relevant.length)die('ACCESS_CONFIGURATION_UNVERIFIED');
 const policies=[];for(const app of relevant){const p=await api('/accounts/'+account+'/access/apps/'+app.id+'/policies');policies.push({id:app.id,domain:app.domain,aud:app.aud,policies:p.result});}
 return hash(policies);
}
export function validateRollback(s,worker){
 // A blind version rollback must never reintroduce missing named entrypoints.
 const b=s.versionBindings;
 for(const [name,entrypoint] of [['OBSERVATORY_GO','ObservatoryGoBridge'],['GOVIEW_GO','GoviewGoBridge']]){
  const found=b.find(v=>v.name===name);if(worker===go&&(!found||found.entrypoint!==entrypoint))die('ROLLBACK_BINDINGS_UNSAFE');
 }
}
async function publicAcceptance(v){
 const origin='https://go-together.pureekangraw.workers.dev';
 const r=await fetch(origin+'/?release='+v.requestId,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'cache-control':'no-cache'}});
 if(r.status===302||r.status===403)die('OWNER_ACCESS_READBACK_REQUIRED');
 if(r.status!==200)die('GO_HTML_UNAVAILABLE');
 const actual=Buffer.from(await r.arrayBuffer());if(actual.length>1048576)die('GO_HTML_TOO_LARGE');
 if(createHash('sha256').update(actual).digest('hex')!==createHash('sha256').update(readFileSync('static/index.html')).digest('hex'))die('GO_ASSET_BYTES_MISMATCH');
 if(!/no-store/i.test(r.headers.get('cache-control')||''))die('GO_STATIC_CACHE_UNSAFE');
 for(const route of ['/api/factory-approvals','/mcp']){
  const denied=await fetch(origin+route,{method:route==='/mcp'?'POST':'GET',body:route==='/mcp'?'{}':undefined,redirect:'manual',signal:AbortSignal.timeout(15000)});
  await denied.body?.cancel();if(![302,401,403].includes(denied.status))die('PUBLIC_OWNER_API_NOT_DENIED');
 }
 return {htmlSha256:createHash('sha256').update(actual).digest('hex'),unauthenticatedApi:'DENIED',ownerBrowser:'NOT_VERIFIED'};
}
async function privateAcceptance(v,goVersion){
 const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL||'https://invalid.invalid');
 if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com')||url.username||url.password||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)die('GITHUB_OIDC_NOT_CONFIGURED');
 url.searchParams.set('audience','go-release:'+v.requestId);
 const r=await fetch(url,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'manual',signal:AbortSignal.timeout(10000)});
 if(!r.ok)die('GITHUB_OIDC_UNAVAILABLE');
 const raw=await r.text();if(raw.length>20000)die('GITHUB_OIDC_RESPONSE_TOO_LARGE');
 const token=JSON.parse(raw).value;if(typeof token!=='string'||token.length>16000)die('GITHUB_OIDC_INVALID');
 const response=await fetch('https://go-together.pureekangraw.workers.dev/_release/acceptance',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({requestId:v.requestId,goVersion}),redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(!response.ok){await response.body?.cancel();die('PRIVATE_GO_ACCEPTANCE_UNAVAILABLE');}
 const text=await response.text();if(text.length>4096)die('PRIVATE_GO_ACCEPTANCE_INVALID');const result=JSON.parse(text);
 if(result.ok!==true||result.goVersion!==goVersion||result.pending!=='PRESERVED'||result.privateRpc!=='VERIFIED')die('PRIVATE_GO_ACCEPTANCE_FAILED');
 return result;
}
async function deploy(worker,v){
 controllerPresent(worker);
 const expected=worker===go?v.goVersion:v.hubVersion;
 const before=await snapshot(worker,expected);validateRollback(before,worker);
 const accessHash=await accessSnapshot();
 // Wrangler performs assets upload sessions internally. No manual JWT or migration.
 const wrangler=worker===go?['--yes','wrangler@4.152.0']:['--no-install','wrangler'];
 run('npx',[...wrangler,'deploy','--config','wrangler.jsonc','--keep-vars','--tag',v.requestId,'--message',worker===go?v.goSha:v.hubSha]);
 const after=await snapshot(worker);assertPreserved(before.bindings,after.bindings);
 if(before.routesHash!==after.routesHash||before.domainsHash!==after.domainsHash||accessHash!==await accessSnapshot())die('ROUTING_OR_ACCESS_CHANGED');
 if(after.annotations['workers/tag']!==v.requestId||after.annotations['workers/message']!==(worker===go?v.goSha:v.hubSha))die('DEPLOYED_SOURCE_UNVERIFIED');
 return {previousVersion:before.id,version:after.id,bindingsFingerprint:bindingsFingerprint(after.bindings),accessHash};
}
async function main(stage){
 const v=inputs();
 if(v.action==='rollback'&&!uuid.test(process.env.RELEASE_ORIGINAL_REQUEST_ID||''))die('ROLLBACK_ORIGINAL_REQUEST_REQUIRED');
 if(stage==='validate')return;
 if(stage==='manifest'){
  const m=JSON.parse(readFileSync(process.env.RELEASE_MANIFEST_PATH||'.github/release-manifest.json','utf8'));
  if(m.controllerReviewed!==true)die('CONTROL_SOURCE_REVIEW_REQUIRED');
  for(const k of ['releaseId','goSha','hubSha','goVersion','hubVersion'])if(m[k]!==v[k])die('APPROVED_MANIFEST_MISMATCH');
  return;
 }
 if(stage==='source'){
  const expected=process.env.RELEASE_WORKER===hub?v.hubSha:v.goSha;
  if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==expected)die('CHECKOUT_SOURCE_MISMATCH');
  execFileSync('git',['diff','--exit-code'],{stdio:'pipe'});controllerPresent(process.env.RELEASE_WORKER===hub?hub:go);return;
 }
 if(stage==='go'){
  const prior=await snapshot(hub,v.hubVersion);validateRollback(prior,hub);
  writeReceipt({...v,status:'GO_DEPLOY_IN_PROGRESS'});
  const result=await deploy(go,v);writeReceipt({...v,go:result,status:'GO_DEPLOYED'});const acceptance={...await publicAcceptance(v),...await privateAcceptance(v,result.version)};
  writeReceipt({...v,go:result,acceptance,status:'GO_VERIFIED'});return;
 }
 if(stage==='trigger-hub'){
  const receipt=readReceipt();if(receipt.status!=='GO_VERIFIED'||receipt.requestId!==v.requestId)die('GO_RECEIPT_MISMATCH');
  const observed=await snapshot(go,receipt.go.version);if(observed.annotations['workers/tag']!==v.requestId)die('GO_VERSION_DRIFT');
  const p=await api('/projects/'+project+'/pipeline',{gitlab:true,method:'POST',body:{ref:branch,inputs:{release_action:'deploy',release_id:v.releaseId,release_request_id:v.requestId,release_hub_sha:v.hubSha,release_go_sha:v.goSha,release_go_baseline:v.goVersion,release_go_version:receipt.go.version,release_hub_baseline:v.hubVersion}}});
  if(!Number.isInteger(p.id))die('UNKNOWN_PIPELINE_DELIVERY');writeReceipt({...receipt,hubPipelineId:p.id,hubPipelineUrl:p.web_url,status:'HUB_PIPELINE_CREATED'});
  let job;for(let attempt=0;attempt<6;attempt++){const jobs=await api('/projects/'+project+'/pipelines/'+p.id+'/jobs',{gitlab:true});job=jobs.find(j=>j.name==='owner-recovery-release'&&j.status==='manual');if(job)break;if(attempt<5)await new Promise(resolve=>setTimeout(resolve,2000));}
  if(!job)die('HUB_MANUAL_JOB_NOT_READY_USE_STATUS');
  // One play only; no retries after uncertain results.
  await api('/projects/'+project+'/jobs/'+job.id+'/play',{gitlab:true,method:'POST',body:{}});
  writeReceipt({...readReceipt(),hubJobId:job.id,status:'HUB_IN_PROGRESS'});return;
 }
 if(stage==='hub'){
  if(process.env.CI_COMMIT_REF_NAME!==branch||process.env.CI_COMMIT_REF_PROTECTED!=='true'||!['api','web'].includes(process.env.CI_PIPELINE_SOURCE))die('HUB_PROTECTED_MANUAL_PIPELINE_REQUIRED');
  const observed=await snapshot(go,process.env.RELEASE_VERIFIED_GO_VERSION);
  if(observed.annotations['workers/tag']!==v.requestId||observed.annotations['workers/message']!==v.goSha)die('GO_ACCEPTANCE_REQUIRED');
  const result=await deploy(hub,v);writeReceipt({...v,hub:result,status:'HUB_VERIFIED',ownerBrowser:'NOT_VERIFIED'});return;
 }
 if(stage==='wait-hub'){
  const receipt=readReceipt();if(!receipt.hubPipelineId||!receipt.hubJobId)die('HUB_RECEIPT_MISSING');
  // Bounded runner polling, no LLM calls, no reruns, no redeployment. 10 minutes maximum.
  for(let i=0;i<60;i++){
   const p=await api('/projects/'+project+'/pipelines/'+receipt.hubPipelineId,{gitlab:true});
   if(p.status==='success'){
    const live=await snapshot(hub);if(live.annotations['workers/tag']!==v.requestId||live.annotations['workers/message']!==v.hubSha)die('HUB_VERSION_UNVERIFIED');
    const acceptance=await privateAcceptance(v,receipt.go.version);writeReceipt({...receipt,hubVersion:live.id,status:'DEPLOYED',acceptance:{...receipt.acceptance,...acceptance,ordinaryFreshChat:'NOT_VERIFIED'}});return;
   }
   if(['failed','canceled','skipped'].includes(p.status))die('HUB_PIPELINE_'+p.status.toUpperCase());
   await new Promise(resolve=>setTimeout(resolve,10000));
  }
  die('HUB_TIMEOUT_UNKNOWN_USE_STATUS');
 }
 if(stage==='recover'){
  let receipt;try{receipt=readReceipt();}catch{console.log('NO_DEPLOYMENT_RECEIPT');return;}
  if(receipt.requestId!==v.requestId||receipt.goSha!==v.goSha||receipt.hubSha!==v.hubSha)die('RECOVERY_RECEIPT_MISMATCH');
  const changes=[];
  for(const [worker,id,source] of [[hub,v.hubVersion,v.hubSha],[go,v.goVersion,v.goSha]]){
   const current=await snapshot(worker);if(current.id===id)continue;
   if(current.annotations['workers/tag']!==v.requestId||current.annotations['workers/message']!==source)die('RECOVERY_PRODUCTION_DRIFT');
   const previous=await api(path(worker)+'/versions/'+id);validateRollback({versionBindings:previous.result.resources.bindings},worker);
   assertPreserved(previous.result.resources.bindings,current.bindings);changes.push({worker,id});
  }
  // All rollback targets are checked before the first restore. Never force a rejected deployment.
  const accessHash=await accessSnapshot();
  for(const {worker,id} of changes){await api(path(worker)+'/deployments',{method:'POST',body:{strategy:'percentage',versions:[{version_id:id,percentage:100}]}});await snapshot(worker,id);}
  if(accessHash!==await accessSnapshot())die('RECOVERY_ACCESS_CHANGED');
  if(changes.length)await privateAcceptance(v,v.goVersion);
  writeReceipt({...receipt,status:'FAILED_ROLLED_BACK',restored:changes});return;
 }
 if(stage==='rollback'){
  // Fresh snapshot must prove the requested pair owns production before any effect.
  const states={go:await snapshot(go),hub:await snapshot(hub)};
  for(const [name,s] of Object.entries(states))if(s.annotations['workers/message']!==(name==='go'?v.goSha:v.hubSha)||s.annotations['workers/tag']!==process.env.RELEASE_ORIGINAL_REQUEST_ID)die('ROLLBACK_PRODUCTION_DRIFT');
  for(const [worker,id] of [[hub,v.hubVersion],[go,v.goVersion]]){
   const old=await api(path(worker)+'/versions/'+id);validateRollback({versionBindings:old.result.resources.bindings},worker);
   assertPreserved(old.result.resources.bindings,states[worker===go?'go':'hub'].bindings);
  }
  // Existing immutable version deployments restore actual code/assets versions only after binding parity.
  for(const [worker,id] of [[hub,v.hubVersion],[go,v.goVersion]]){
   await api(path(worker)+'/deployments',{method:'POST',body:{strategy:'percentage',versions:[{version_id:id,percentage:100}]}});
   const result=await snapshot(worker,id);writeReceipt({...v,status:'ROLLBACK_IN_PROGRESS',lastRestoredWorker:worker,version:result.id});
  }
  const acceptance=await privateAcceptance(v,v.goVersion);writeReceipt({...v,status:'ROLLED_BACK',acceptance});return;
 }
 die('UNKNOWN_RUNNER_STAGE');
}
if(process.argv[1]===fileURLToPath(import.meta.url))main(process.argv[2]).catch(e=>{const code=/^[A-Z_0-9]+$/.test(e.message)?e.message:'RELEASE_RUNNER_FAILED';console.error(code);try{const old=readReceipt();writeReceipt({...old,status:'UNKNOWN',code});}catch{}process.exitCode=1;});
