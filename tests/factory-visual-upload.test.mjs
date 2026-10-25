import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import worker from '../worker/index.js';
import {factoryVisualUpload,factoryVisualUploadStatus} from '../worker/factory-direct.mjs';
const ORIGIN='https://go-together.pureekangraw.workers.dev';
const key='factory-go-test-key-ABCDEFGHIJKLMNOPQRSTUVWXY0123456789';
const sourceSha='a'.repeat(40),id='123e4567-e89b-42d3-a456-426614174000';
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';
const sha=b=>createHash('sha256').update(b).digest('hex');
const pngHash=sha(Buffer.from(PNG,'base64'));
const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
const owned={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',DB:{prepare:()=>({first:async()=>({healthy:1})})}};
function fixture(){
 const records=new Map(),seen=[];
 const env={...owned,GO_FACTORY_RAIL_SECRET:key,FACTORY_DIRECT:{fetch:async(req)=>{
  const path=new URL(req.url).pathname,body=req.method==='GET'?'':await req.text();
  seen.push({path,body});
  if(path==='/health')return Response.json({service:'factory-district',
   stationId:'FACTORY-STATION',status:'READY',sourceSha,
   storage:{status:'READY'},transport:{status:'READY'},
   machinery:{CODE:{status:'READY'},VISUAL:{status:'READY'},LOGIC:{status:'READY'}}});
  const stamp=req.headers.get('x-metropolis-factory-timestamp');
  const signature=req.headers.get('x-metropolis-factory-signature');
  const expected=createHmac('sha256',key).update(stamp+'.'+body).digest('hex');
  if(req.headers.get('x-factory-client')!=='GO'||expected!==signature)throw Error('invalid go signature');
  if(path==='/station/go-auth-probe'){
   const data=JSON.parse(body);
   const proof=createHmac('sha256',key)
    .update(data.purpose+'\n'+data.nonce+'\n'+sourceSha+'\nFACTORY-STATION').digest('hex');
   return Response.json({status:'AUTHENTICATED',service:'factory-district',
    stationId:'FACTORY-STATION',nonce:data.nonce,sourceSha,proof,readOnly:true,executed:false});
  }
  if(path==='/station/go-asset-upload'){
   const data=JSON.parse(body);
   if(data.schema!=='FACTORY_GO_PNG_INPUT_V1'||data.sha256!==pngHash)
    return Response.json({reason:'BAD_INPUT'},{status:400});
   const previous=records.get(data.requestId);
   if(previous&&previous.sha256!==data.sha256)return Response.json({reason:'CONFLICT'},{status:409});
   const claim={requestId:data.requestId,sha256:data.sha256,bytes:Buffer.from(data.pngBase64,'base64').length,
    width:1,height:1,ref:'r2://factory/edge-source/go/'+pngHash+'.png#sha256='+pngHash,executed:false};
   records.set(data.requestId,claim);
   return Response.json({status:'STORED_NOT_PROCESSED',...claim},{status:201});
  }
  if(path==='/station/go-asset-status'){
   const rec=records.get(JSON.parse(body).requestId);
   return rec?Response.json({status:'STORED_NOT_PROCESSED',...rec})
    :Response.json({status:'NOT_FOUND'},{status:404});
  }
  throw Error('unexpected route '+path);
 }}};
 return {env,seen,records};
}
async function call(env,name,args,context=ctx){
 return worker.fetch(new Request(ORIGIN+'/mcp',{method:'POST',body:JSON.stringify({
  jsonrpc:'2.0',id:5,method:'tools/call',params:{name,arguments:args}})}),env,context);
}
const result=async resp=>JSON.parse((await resp.json()).result.content[0].text);
test('GO schema exposes explicit inputRef cutouts and separate upload/status tools',async()=>{
 const {env}=fixture();
 const list=await worker.fetch(new Request(ORIGIN+'/mcp',{method:'POST',
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),env,ctx);
 const tools=(await list.json()).result.tools;
 assert.ok(tools.some(t=>t.name==='factory_visual_upload'));
 assert.ok(tools.some(t=>t.name==='factory_visual_upload_status'));
 const submit=tools.find(t=>t.name==='factory_direct_submit');
 assert.ok(submit.inputSchema.properties.spec.oneOf.some(o=>o.properties.imageSplit));
});
test('signed GO upload persists original bytes without issuing a Factory job',async()=>{
 const {env,seen}=fixture();
 const upload=await factoryVisualUpload(env,{requestId:id,pngBase64:PNG,sha256:pngHash},true);
 assert.equal(upload.ok,true);assert.equal(upload.status,'STORED_NOT_PROCESSED');
 assert.equal(upload.sha256,pngHash);assert.equal(upload.executed,false);
 const status=await factoryVisualUploadStatus(env,{requestId:id});
 assert.equal(status.ok,true);assert.equal(status.ref,upload.ref);
 assert.equal(seen.some(s=>s.path==='/station/go-job'),false);
});
test('rejects missing owner approval, forged digest and outsider without upload',async()=>{
 const {env,seen}=fixture();
 assert.equal((await factoryVisualUpload(env,{requestId:id,pngBase64:PNG,sha256:pngHash},false)).status,'OWNER_APPROVAL_REQUIRED');
 assert.equal((await factoryVisualUpload(env,{requestId:id,pngBase64:PNG,sha256:'f'.repeat(64)},true)).status,'GO_IMAGE_SHA_MISMATCH');
 const outside=await call(env,'factory_visual_upload',{requestId:id,pngBase64:PNG,sha256:pngHash,approved:true},{});
 assert.equal(outside.status,401);
 assert.equal(seen.some(x=>x.path==='/station/go-asset-upload'),false);
});
test('GO MCP upload requires explicit approval and rejects unknown fields',async()=>{
 const {env}=fixture();
 const denied=await call(env,'factory_visual_upload',{requestId:id,pngBase64:PNG,sha256:pngHash});
 assert.match(JSON.stringify(await denied.json()),/explicit_owner_approval_required/);
 const extra=await call(env,'factory_visual_upload',{requestId:id,pngBase64:PNG,sha256:pngHash,approved:true,token:'bad'});
 assert.match(JSON.stringify(await extra.json()),/unknown_field:token/);
 const approved=await result(await call(env,'factory_visual_upload',{requestId:id,pngBase64:PNG,sha256:pngHash,approved:true}));
 assert.equal(approved.ok,true);assert.equal(approved.executed,false);
});
