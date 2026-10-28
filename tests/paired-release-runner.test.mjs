import test from 'node:test';
import assert from 'node:assert/strict';
import {assertActive,assertPreserved,bindingsFingerprint,inputs,trustedManifest,assertInfrastructurePlan} from '../scripts/paired-release-runner.mjs';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createBundle} from '../scripts/release-bundle.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('runner refuses split traffic and production drift',()=>{assert.throws(()=>assertActive({result:{deployments:[{versions:[{version_id:id,percentage:50}]}]}}),/TRAFFIC/);assert.throws(()=>assertActive({result:{deployments:[{versions:[{version_id:id,percentage:100}]}]}},'other'),/DRIFT/);});
test('binding check preserves D1 and secrets while allowing reviewed entrypoint repairs',()=>{const b=[{name:'DB',type:'d1',id:'db'},{name:'SECRET',type:'secret_text'},{name:'GOVIEW_GO',type:'service',service:'goview-package-bridge'}];assert.doesNotThrow(()=>assertPreserved(b,[b[0],b[1],{...b[2],entrypoint:'GoviewGoBridge'}]));assert.throws(()=>assertPreserved(b,[b[0],{...b[2],entrypoint:'GoviewGoBridge'}]),/BINDINGS_CHANGED/);assert.throws(()=>assertPreserved(b,[{...b[0],id:'other'},b[1],{...b[2],entrypoint:'GoviewGoBridge'}]),/BINDINGS_CHANGED/);});
test('receipts contain binding fingerprints without plaintext variable values',()=>{assert.ok(!JSON.stringify(bindingsFingerprint([{name:'PRIVATE',type:'plain_text',text:'sensitive-value'}])).includes('sensitive-value'));});
test('runner rejects shell input and arbitrary accounts before network effects',()=>{assert.throws(()=>inputs({RELEASE_ID:'$(evil)'}),/INVALID_RELEASE_INPUTS/);});

test('legacy missing entrypoints are repaired by current infrastructure instead of blocking on old version configuration',()=>{
 const old=[{name:'GOVIEW_GO',type:'service',service:'goview-package-bridge'}];
 assert.doesNotThrow(()=>assertInfrastructurePlan(old,{services:[{binding:'GOVIEW_GO',service:'goview-package-bridge',entrypoint:'GoviewGoBridge'}]}));
 assert.throws(()=>assertInfrastructurePlan([{name:'DB',type:'d1',id:'database-a'}],{d1_databases:[{binding:'DB',database_id:'database-b'}]}),/DATABASE_DRIFT/);
 assert.throws(()=>assertPreserved([{name:'ASSETS',type:'assets'}],[]),/ASSETS_BINDING_REMOVED/);
});
test('unreviewed recovery manifest cannot start CI production work without secrets',async()=>{
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const script=fileURLToPath(new URL('../scripts/paired-release-runner.mjs',import.meta.url));
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const cwd=mkdtempSync(join(tmpdir(),'unreviewed-release-'));mkdirSync(join(cwd,'.github'));writeFileSync(join(cwd,'.github/release-manifest.json'),JSON.stringify({controllerReviewed:false}));
 const r=spawnSync(process.execPath,[script,'manifest'],{cwd,encoding:'utf8',env:{PATH:process.env.PATH,RELEASE_ACTION:'start',RELEASE_ID:'owner-recovery-20261028',RELEASE_REQUEST_ID:id,RELEASE_GO_SHA:'5f8f99cb1debcf2cb5677645357be1491153c332',RELEASE_HUB_SHA:'dbfbdd715018722355041da50dcdb68188d9d485',RELEASE_GO_BASELINE:'45c62178-6991-4ed9-a35c-314eca1e98fa',RELEASE_HUB_BASELINE:'9f631634-e9dd-4682-bf10-ccafe3d79819',RELEASE_CONFIRM:'DEPLOY owner-recovery-20261028'}});rmSync(cwd,{recursive:true,force:true});
 assert.equal(r.status,1);assert.match(r.stderr,/CONTROL_SOURCE_REVIEW_REQUIRED/);
});
test('a reviewed fallback bundle is required, independent of legacy version bindings',()=>{
 const v={releaseId:'r1',goSha:'a'.repeat(40),hubSha:'b'.repeat(40),goVersion:id,hubVersion:id};
 assert.throws(()=>trustedManifest(v,{...v,controllerReviewed:true,recovery:null}),/APPROVED_RECOVERY_BUNDLE_REQUIRED/);
 assert.doesNotThrow(()=>trustedManifest(v,{...v,controllerReviewed:true,recovery:{assetId:1,sha256:'c'.repeat(64),goSha:'d'.repeat(40),hubSha:'e'.repeat(40)}}));
});

function runAttemptFixture(){
 const root=mkdtempSync(join(tmpdir(),'release-run-attempt-'));
 const script=fileURLToPath(new URL('../scripts/paired-release-runner.mjs',import.meta.url));
 const marker=join(root,'provider-calls.jsonl'),receipt=join(root,'release-receipt/receipt.json');
 mkdirSync(join(root,'.github/release-infrastructure'),{recursive:true});
 const manifest={releaseId:'rerun-guard',goSha:'a'.repeat(40),hubSha:'b'.repeat(40),goVersion:id,hubVersion:id,controllerReviewed:true,recovery:{assetId:1,sha256:'c'.repeat(64),goSha:'d'.repeat(40),hubSha:'e'.repeat(40)}};
 writeFileSync(join(root,'.github/release-manifest.json'),JSON.stringify(manifest));
 writeFileSync(join(root,'.github/release-infrastructure/go.json'),JSON.stringify({name:'go-together',assets:{binding:'ASSETS'}}));
 writeFileSync(join(root,'hub-infrastructure.json'),JSON.stringify({name:'ygg-connection-hub-v2'}));
 const candidate=createBundle({releaseId:manifest.releaseId,goSha:manifest.goSha,hubSha:manifest.hubSha,files:{
  'go/runtime.js':Buffer.from('release_control releaseControl ciAcceptance'),
  'hub/runtime.js':Buffer.from('releaseControl ciAcceptance loadReleaseManifest'),
  'go/static/index.html':Buffer.from('<html>fixture</html>'),
  'go/static/manifest.webmanifest':Buffer.from('{}'),
  'go/static/service-worker.js':Buffer.from('network-only'),
  'go/static/_headers':Buffer.from('Cache-Control: no-store')
 }});
 writeFileSync(join(root,'go-hub-bundle.json'),candidate.bytes);
 const preload=join(root,'provider-sentinel.mjs');
 writeFileSync(preload,"import {appendFileSync} from 'node:fs';\nglobalThis.fetch=async(input,options={})=>{const url=new URL(input);appendFileSync(process.env.PROVIDER_MARKER,JSON.stringify({method:options.method||'GET',host:url.hostname,path:url.pathname})+'\\n');throw Error('PROVIDER_SENTINEL');};\n");
 const env={PATH:process.env.PATH,PROVIDER_MARKER:marker,RELEASE_HUB_CONFIG_PATH:join(root,'hub-infrastructure.json'),RELEASE_ACTION:'start',RELEASE_ID:manifest.releaseId,RELEASE_REQUEST_ID:id,RELEASE_GO_SHA:manifest.goSha,RELEASE_HUB_SHA:manifest.hubSha,RELEASE_GO_BASELINE:id,RELEASE_HUB_BASELINE:id,RELEASE_CONFIRM:'DEPLOY '+manifest.releaseId,GITHUB_TOKEN:'fixture-token'};
 return {root,marker,receipt,run:(stage,attempt)=>spawnSync(process.execPath,['--import',preload,script,stage],{cwd:root,env:{...env,GITHUB_RUN_ATTEMPT:attempt},encoding:'utf8'}),clean:()=>rmSync(root,{recursive:true,force:true})};
}

for(const stage of ['manifest','deploy'])test('rerun refuses '+stage+' before provider calls or receipt changes',()=>{
 for(const existingReceipt of [false,true]){
  const f=runAttemptFixture();
  try{
   const prior=JSON.stringify({requestId:id,status:'PREPARED',artifact:{assetId:7}})+'\n';
   if(existingReceipt){mkdirSync(join(f.root,'release-receipt'));writeFileSync(f.receipt,prior);}
   const r=f.run(stage,'2');
   assert.equal(r.status,1,stage+' rerun must fail');
   assert.match(r.stderr,/RELEASE_RERUN_REFUSED/,stage);
   assert.equal(existsSync(f.marker),false,stage+' must not call any provider');
   if(existingReceipt)assert.equal(readFileSync(f.receipt,'utf8'),prior,stage+' must preserve its prior receipt');
   else assert.equal(existsSync(f.receipt),false,stage+' must not create a receipt');
  }finally{f.clean();}
 }
});

test('first run passes manifest and reaches the normal read-only provider preflight',()=>{
 const f=runAttemptFixture();
 try{
  const manifest=f.run('manifest','1');
  assert.equal(manifest.status,0,manifest.stderr);
  assert.equal(existsSync(f.marker),false);
  assert.equal(existsSync(f.receipt),false);
  const deploy=f.run('deploy','1');
  assert.equal(deploy.status,1,'the provider sentinel stops before deployment');
  assert.match(deploy.stderr,/PROVIDER_SENTINEL/);
  assert.deepEqual(readFileSync(f.marker,'utf8').trim().split('\n').map(line=>JSON.parse(line)),[{method:'GET',host:'api.github.com',path:'/repos/pureekangraw-ops/Go-Together/releases/assets/1'}]);
  assert.equal(existsSync(f.receipt),false);
 }finally{f.clean();}
});
