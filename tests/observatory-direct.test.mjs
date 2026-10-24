import test from "node:test";
import assert from "node:assert/strict";
import worker from "./hub-fixture.mjs";
import {observatoryDirect} from "../worker/observatory-direct.mjs";
const ROOT="https://go-together.pureekangraw.workers.dev";
const owner={access:{aud:"aud",getIdentity:async()=>({email:"owner@example.com"})}};
const base={ACCESS_AUD:"aud",OWNER_EMAIL:"owner@example.com",DB:{
 prepare:()=>({first:async()=>({healthy:1})})},ASSETS:{fetch:async()=>new Response("ok")}};
const call=(env,name,args={},ctx=owner)=>worker.fetch(new Request(ROOT+"/mcp",{
 method:"POST",body:JSON.stringify({jsonrpc:"2.0",id:19,method:"tools/call",
 params:{name,arguments:args}})}),env,ctx);
test("existing Brain and Observatory tools are listed together",async()=>{
 const res=await worker.fetch(new Request(ROOT+"/mcp",{method:"POST",body:JSON.stringify({
  jsonrpc:"2.0",id:3,method:"tools/list"})}),base,owner);
 const list=(await res.json()).result.tools.map(x=>x.name);
 for(const x of ["brain_search","brain_save","factory_direct_status","observatory_session",
   "observatory_observe","observatory_action","observatory_run","observatory_screenshot",
   "observatory_note","observatory_job"])assert.ok(list.includes(x),x);
});
test("GO Brain's own OAuth gate precedes Observatory binding",async()=>{
 let calls=0;const env={...base,OBSERVATORY_GO:{invoke:async()=>{calls++;return {ok:true}}}};
 const result=await call(env,"observatory_session",{},{});assert.equal(result.status,401);assert.equal(calls,0);
});
test("GO routes owner's read-only status to named Service Binding",async()=>{
 let action;const env={...base,OBSERVATORY_GO:{invoke:async(name,args)=>{
  action={name,args};return {ok:true,status:"CONNECTED",result:{status:"IDLE"}};}}};
 const r=await call(env,"observatory_session");
 const parsed=JSON.parse((await r.json()).result.content[0].text);
 assert.equal(parsed.ok,true);assert.deepEqual(action,{name:"observatory_session",args:{}});
});
test("read without service binding never invents a page",async()=>{
 const r=await call(base,"observatory_session");
 const body=(await r.json()).result;assert.equal(body.isError,true);
 assert.match(body.content[0].text,/OBSERVATORY_BINDING_NOT_CONFIGURED/);
});
test("image tool produces genuine MCP image block",async()=>{
 const env={...base,OBSERVATORY_GO:{invoke:async()=>({ok:true,result:{
  mimeType:"image/jpeg",image:"AQID",observedAt:"2026-10-24T00:00:00Z"}})}};
 const r=await call(env,"observatory_screenshot"),b=(await r.json()).result.content;
 assert.deepEqual(b[0],{type:"image",mimeType:"image/jpeg",data:"AQID"});
 assert.equal(b[1].type,"text");assert.ok(!b[1].text.includes("AQID"));
});
test("reject bad job id and unsupported tool",async()=>{
 let n=0;const env={...base,OBSERVATORY_GO:{invoke:async()=>{n++;return {ok:true}}}};
 assert.equal((await observatoryDirect(env,"observatory_close",{})).status,"UNSUPPORTED");
 assert.equal((await observatoryDirect(env,"observatory_run",
  {requestId:"not-a-uuid",steps:[{type:"reload"}]})).status,"INVALID_REQUEST_ID_UUID");
 assert.equal(n,0);
});
test("explicit owner refusal from DO stays refused in GO Brain",async()=>{
 const env={...base,OBSERVATORY_GO:{invoke:async()=>({ok:false,error:"OWNER_HAS_NOT_INVITED_GO",upstream_status:403})}};
 const r=await call(env,"observatory_observe");
 const doc=(await r.json()).result;
 assert.equal(doc.isError,true);assert.match(doc.content[0].text,/OWNER_HAS_NOT_INVITED_GO/);
});

