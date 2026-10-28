import test from 'node:test';
import assert from 'node:assert/strict';
import {assertActive,assertPreserved,bindingsFingerprint,inputs,validateRollback} from '../scripts/paired-release-runner.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('runner refuses split traffic and production drift',()=>{assert.throws(()=>assertActive({result:{deployments:[{versions:[{version_id:id,percentage:50}]}]}}),/TRAFFIC/);assert.throws(()=>assertActive({result:{deployments:[{versions:[{version_id:id,percentage:100}]}]}},'other'),/DRIFT/);});
test('binding check preserves D1 and secrets while allowing reviewed entrypoint repairs',()=>{const b=[{name:'DB',type:'d1',id:'db'},{name:'SECRET',type:'secret_text'},{name:'GOVIEW_GO',type:'service',service:'goview-package-bridge'}];assert.doesNotThrow(()=>assertPreserved(b,[b[0],b[1],{...b[2],entrypoint:'GoviewGoBridge'}]));assert.throws(()=>assertPreserved(b,[b[0],{...b[2],entrypoint:'GoviewGoBridge'}]),/BINDINGS_CHANGED/);assert.throws(()=>assertPreserved(b,[{...b[0],id:'other'},b[1],{...b[2],entrypoint:'GoviewGoBridge'}]),/BINDINGS_CHANGED/);});
test('receipts contain binding fingerprints without plaintext variable values',()=>{assert.ok(!JSON.stringify(bindingsFingerprint([{name:'PRIVATE',type:'plain_text',text:'sensitive-value'}])).includes('sensitive-value'));});
test('runner rejects shell input and arbitrary accounts before network effects',()=>{assert.throws(()=>inputs({RELEASE_ID:'$(evil)'}),/INVALID_RELEASE_INPUTS/);});

test('unsafe original GO rollback is blocked before publication; corrected target retains both named entrypoints',()=>{
 assert.throws(()=>validateRollback({versionBindings:[{name:'OBSERVATORY_GO',type:'service'},{name:'GOVIEW_GO',type:'service'}]},'go-together'),/ROLLBACK_BINDINGS_UNSAFE/);
 assert.doesNotThrow(()=>validateRollback({versionBindings:[{name:'OBSERVATORY_GO',entrypoint:'ObservatoryGoBridge'},{name:'GOVIEW_GO',entrypoint:'GoviewGoBridge'}]},'go-together'));
 assert.throws(()=>assertPreserved([{name:'ASSETS',type:'assets'}],[]),/ASSETS_BINDING_REMOVED/);
});
test('unreviewed recovery manifest cannot start CI production work without secrets',async()=>{
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const script=fileURLToPath(new URL('../scripts/paired-release-runner.mjs',import.meta.url));
 const cwd=fileURLToPath(new URL('../',import.meta.url));
 const r=spawnSync(process.execPath,[script,'manifest'],{cwd,encoding:'utf8',env:{PATH:process.env.PATH,RELEASE_ACTION:'start',RELEASE_ID:'owner-recovery-20261028',RELEASE_REQUEST_ID:id,RELEASE_GO_SHA:'5f8f99cb1debcf2cb5677645357be1491153c332',RELEASE_HUB_SHA:'dbfbdd715018722355041da50dcdb68188d9d485',RELEASE_GO_BASELINE:'45c62178-6991-4ed9-a35c-314eca1e98fa',RELEASE_HUB_BASELINE:'9f631634-e9dd-4682-bf10-ccafe3d79819',RELEASE_CONFIRM:'DEPLOY owner-recovery-20261028'}});
 assert.equal(r.status,1);assert.match(r.stderr,/CONTROL_SOURCE_REVIEW_REQUIRED/);
});
