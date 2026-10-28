import test from 'node:test';
import assert from 'node:assert/strict';
import {assertActive,assertPreserved,bindingsFingerprint,inputs,trustedManifest,assertInfrastructurePlan} from '../scripts/paired-release-runner.mjs';
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
