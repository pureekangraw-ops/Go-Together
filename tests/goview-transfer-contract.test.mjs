import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {goviewDirect} from '../worker/goview-direct.mjs';
import {snapshot,proposal,studio,receipt} from './goview-transfer-fixtures.mjs';
// Opt-in cross-repository fixture. Extract the pinned contract commit locally:
// git -C <observatory> archive 2be838f6799cb927f940f21f3af21b830442a8e7 \
//   goview-package-bridge android-browser/app/src/main/assets/goview-studio/engine.js | tar -x -C <fixture>
// GOVIEW_CONTRACT_ROOT=<fixture> node --test tests/goview-transfer-contract.test.mjs
const root=process.env.GOVIEW_CONTRACT_ROOT;
test('actual GO adapter → pinned GOVIEW Worker: selected read, proposal, Studio and receipt', {skip:!root},async()=>{
 const {default:worker}=await import(pathToFileURL(resolve(root,'goview-package-bridge/worker.mjs')));
 const {invokeGoview}=await import(pathToFileURL(resolve(root,'goview-package-bridge/go-adapter.mjs')));
 const data=new Map();let writes=0,failAfterWrite=false;
 const env={GO_WRITE_TOKEN:'synthetic-go-token'.repeat(2),ANDROID_READ_TOKEN:'synthetic-read-token'.repeat(2),ANDROID_UPLOAD_TOKEN:'synthetic-upload-token'.repeat(2),PACKAGES:{
  get:async k=>data.has(k)?{size:Buffer.byteLength(data.get(k)),text:async()=>data.get(k),httpEtag:'synthetic'}:null,
  put:async(k,v,o)=>{if(o?.onlyIf?.etagDoesNotMatch==='*'&&data.has(k))return null;data.set(k,String(v));writes++;if(failAfterWrite)throw Error('synthetic lost response');return {}}
 }};
 const go={GOVIEW_GO:{invoke:(name,args)=>invokeGoview(env,name,args)}};
 const request=(id,token,method='GET',value)=>worker.fetch(new Request('https://synthetic.invalid/v1/transfers/'+id,{method,headers:{authorization:'Bearer '+token},...(value?{body:JSON.stringify(value)}:{})}),env);
 const s=snapshot(),p=proposal(s);
 assert.equal((await request(s.transferId,env.ANDROID_UPLOAD_TOKEN,'PUT',s)).status,201);
 assert.deepEqual((await goviewDirect(go,'goview_transfer_read',{transferId:s.transferId,sha256:s.sha256})).envelope,s);
 const published=await goviewDirect(go,'goview_transfer_publish',{envelope:p});assert.equal(published.ok,true);assert.equal(published.androidStatus,'NOT_OBSERVED_OWNER_APPROVAL_REQUIRED');
 assert.deepEqual(await (await request(p.transferId,env.ANDROID_READ_TOKEN)).json(),p);
 assert.equal((await goviewDirect(go,'goview_transfer_receipt',{transferId:p.transferId})).status,'NOT_OBSERVED');
 // Synthetic device report only: this does not execute native Update or prove a device save.
 const r=receipt(p);assert.equal((await request(p.transferId+'/receipt',env.ANDROID_READ_TOKEN,'POST',r)).status,201);
 const observed=await goviewDirect(go,'goview_transfer_receipt',{transferId:p.transferId});assert.deepEqual(observed.receipt,r);assert.equal(observed.independentlyVerified,false);
 const graph=studio();assert.deepEqual((await goviewDirect(go,'goview_transfer_publish',{envelope:graph})).envelope,graph);
 // A committed typed write with lost response is never automatically repeated.
 const next={...p,identity:{...p.identity},transferId:p.transferId};
 const before=writes;assert.equal((await goviewDirect(go,'goview_transfer_publish',{envelope:next})).ok,true);assert.equal(writes,before);
 const s2=structuredClone(s),payload=JSON.parse(s2.payload);s2.transferId='synthetic-capture-0002';s2.identity.captureId=s2.transferId;payload.captureId=s2.transferId;payload.captureReceipt.correlationId=s2.transferId;
 const {hash}=await import('./goview-transfer-fixtures.mjs');s2.payload=JSON.stringify(payload);s2.sha256=hash(s2.payload);
 assert.equal((await request(s2.transferId,env.ANDROID_UPLOAD_TOKEN,'PUT',s2)).status,201);
 const p2=structuredClone(p),pp=JSON.parse(p2.payload);p2.transferId=s2.transferId+'-proposal';p2.identity.captureId=s2.transferId;p2.identity.snapshotSha256=s2.sha256;pp.sourceCaptureId=s2.transferId;p2.payload=JSON.stringify(pp);p2.sha256=hash(p2.payload);
 failAfterWrite=true;const at=writes;
 const uncertain=await goviewDirect(go,'goview_transfer_publish',{envelope:p2});assert.equal(uncertain.ok,false);assert.equal(uncertain.readbackRequired,true);assert.equal(writes,at+1);
 assert.deepEqual((await goviewDirect(go,'goview_transfer_read',{transferId:p2.transferId,sha256:p2.sha256})).envelope,p2);assert.equal(writes,at+1);
});
