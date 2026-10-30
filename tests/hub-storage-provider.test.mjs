import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PROVIDER_TOOLS} from '../worker/provider-catalog.mjs';
import {hubGroup,hubTool} from '../worker/hub-client.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical)
 :value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]))
 :value;

test('GO exposes the exact Hub storage schema pinned by the Central Storage candidate',()=>{
 const digest=createHash('sha256').update(JSON.stringify(canonical(PROVIDER_TOOLS))).digest('hex');
 assert.equal(digest,'b020cb44943e36999b1de1cdca10109376793e9329b588d97bead074e1e94330');
 assert.deepEqual(PROVIDER_TOOLS.storage.map(tool=>tool.name),[
  'storage_search','storage_download','storage_history','storage_upload','storage_update_metadata'
 ]);
 assert.equal(PROVIDER_TOOLS.storage.find(tool=>tool.name==='storage_upload').annotations.readOnlyHint,false);
 assert.equal(PROVIDER_TOOLS.storage.find(tool=>tool.name==='storage_search').annotations.readOnlyHint,true);
});

test('storage calls route through Hub with the storage connector identity',async()=>{
 const calls=[];
 const env={HUB_V2:{relay:async input=>{
  calls.push(input);
  return {
   receipt:{state:'RESPONDED',messageId:input.messageId},
   response:{body:JSON.stringify({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify({ok:true,status:'READBACK'})}]}})}
  };
 }}};
 assert.equal(hubGroup('storage_search'),'storage');
 assert.equal(hubGroup('storage_upload'),'storage');
 const result=await hubTool(env,'storage_search',{query:'sample',storageClass:'PRODUCT'});
 assert.equal(result.status,'READBACK');
 assert.equal(calls.length,1);
 assert.equal(calls[0].connectorId,'storage');
 assert.equal(calls[0].name,'storage_search');
});

test('storage writes require request identity and retries preserve Hub idempotency',async()=>{
 const calls=[];
 const env={HUB_V2:{relay:async input=>{
  calls.push(input);
  return {receipt:{state:'UNKNOWN',messageId:input.messageId}};
 }}};
 await assert.rejects(hubTool(env,'storage_upload',{storageClass:'PRODUCT'}),/REQUEST_ID_REQUIRED/);
 assert.equal(calls.length,0);
 const payload={
  storageClass:'PRODUCT',project:'sample',filename:'sample.png',contentType:'image/png',
  contentBase64:'YWJj',requestId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
 };
 const first=await hubTool(env,'storage_upload',payload);
 const retry=await hubTool(env,'storage_upload',payload);
 assert.equal(first.status,'UNKNOWN');
 assert.equal(retry.status,'UNKNOWN');
 assert.equal(calls.length,2);
 assert.equal(calls[0].connectorId,'storage');
 assert.equal(calls[0].name,'storage_upload');
 assert.equal(calls[0].messageId,calls[1].messageId);
 assert.deepEqual(calls[0].payload,payload);
});