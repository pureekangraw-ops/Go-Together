import test from 'node:test';
import assert from 'node:assert/strict';
import {GREENHOUSE_TOOLS,validateGreenhouseRead} from '../worker/greenhouse-read.mjs';
import {hubGroup,hubTool} from '../worker/hub-client.mjs';
test('only three station read tools route through Greenhouse Hub connector',()=>{
 assert.equal(GREENHOUSE_TOOLS.length,3);
 for(const t of GREENHOUSE_TOOLS){assert.equal(hubGroup(t.name),'greenhouse');assert.equal(t.annotations.readOnlyHint,true);assert.equal(t.inputSchema.additionalProperties,false);}
 assert.equal(hubGroup('greenhouse_execute'),null);
});
test('reject invalid and ownership/execution arguments before relay',async()=>{
 let calls=0;const env={HUB_V2:{relay:async()=>{calls++;throw Error('must not relay');}}};
 for(const [name,args] of [['greenhouse_delivery_list',{limit:31}],['greenhouse_delivery_list',{limit:1.5}],['greenhouse_delivery_list',{ownerId:'other'}],['greenhouse_delivery_get',{}],['greenhouse_result_get',{attemptId:'../other'}],['greenhouse_delivery_get',{attemptId:'valid',execute:true}]]){
  await assert.rejects(hubTool(env,name,args),/INVALID_GREENHOUSE_ARGUMENTS/);
 }
 assert.equal(calls,0);validateGreenhouseRead('greenhouse_delivery_list',{});
 validateGreenhouseRead('greenhouse_delivery_get',{attemptId:'attempt-1:abc'});
});
test('fresh read polls preserve unresolved ownership and unavailable results without writes',async()=>{
 const calls=[];let state='ACCEPTED';
 const env={HUB_V2:{async relay(x){calls.push(x);return {receipt:{state:'RESPONDED'},response:{body:JSON.stringify({result:{content:[{type:'text',text:JSON.stringify({scope:{kind:'STATION',stationId:'GREENHOUSE_STATION'},workRef:{workId:'work1',resolution:'UNRESOLVED'},state,availability:'UNAVAILABLE'})}]}})}};}}};
 const first=await hubTool(env,'greenhouse_delivery_get',{attemptId:'attempt1'});state='UNCERTAIN';
 const next=await hubTool(env,'greenhouse_delivery_get',{attemptId:'attempt1'});
 assert.equal(first.state,'ACCEPTED');assert.equal(next.state,'UNCERTAIN');assert.equal(next.workRef.resolution,'UNRESOLVED');assert.equal(next.availability,'UNAVAILABLE');
 assert.notEqual(calls[0].messageId,calls[1].messageId);assert.equal(calls[0].connectorId,'greenhouse');
 assert.equal('domainCompleted' in next,false);
});
