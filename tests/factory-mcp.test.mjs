import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
const ROOT='https://go-together.pureekangraw.workers.dev';
const id='task_'+'a'.repeat(32);
const ctx={access:{aud:'aud',getIdentity:async()=>({email:'owner@example.com'})}};
const baseEnv={ACCESS_AUD:'aud',OWNER_EMAIL:'owner@example.com',DB:{prepare:()=>({first:async()=>({healthy:1})})}};
function call(env, name, args, context=ctx) {
  return worker.fetch(new Request(ROOT+'/mcp',{method:'POST',
    body:JSON.stringify({jsonrpc:'2.0',id:51,method:'tools/call',params:{name,arguments:args}})}),env,context);
}
async function read(res) {const value=await res.json();return value.result.isError
  ? {isError:true,content:value.result.content[0].text}
  : JSON.parse(value.result.content[0].text);}
test('Factory MCP tool appears in native list and is marked read-only',async()=>{
  const res=await worker.fetch(new Request(ROOT+'/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/list'})}),baseEnv,ctx);
  const tools=(await res.json()).result.tools;
  const row=tools.find(t=>t.name==='factory_report');
  assert.ok(row);assert.equal(row.annotations.readOnlyHint,true);
  assert.deepEqual(row.inputSchema.required,['taskIds']);
});
test('Factory report owner auth applies before bridge invocation',async()=>{
  let calls=0;const env={...baseEnv,PANTHEON_OWNER:{ownerCall:async()=>{calls++;throw Error('no access');}}};
  assert.equal((await call(env,'factory_report',{taskIds:[id],execute:true},{})).status,401);
  assert.equal(calls,0);
});
test('Factory report is dry-run by default; no owner read',async()=>{
  let calls=0;const env={...baseEnv,PANTHEON_OWNER:{ownerCall:async()=>{calls++;throw Error('no access');}}};
  const data=await read(await call(env,'factory_report',{taskIds:[id]}));
  assert.equal(data.status,'DRY_RUN');assert.equal(data.readOnly,true);
  assert.equal(data.maxCalls,3);assert.equal(data.contract,'factory-status-report/v1');
  assert.equal(calls,0);
});
test('Factory report executes exactly three scoped reads; repeat remains read-only',async()=>{
  const ops=[];
  const e={...baseEnv,PANTHEON_OWNER:{ownerCall:async a=>{
    ops.push(a);
    if(a.operation==='factory_health')return {ok:true,upstream_status:200,result:{factory:{connection:'CONNECTED',machinery:{CODE:'READY',VISUAL:'READY',LOGIC:'READY'}}}};
    if(a.operation==='intent')return {ok:true,upstream_status:200,result:{task:{task_id:id,status:'QUEUED'}}};
    if(a.operation==='factory_job')return {ok:true,upstream_status:200,result:{job:{task_id:id,status:'QUEUED',task_status:'QUEUED',updated_at:new Date().toISOString()}}};
    throw Error('unexpected operation');
  }}};
  for(let i=0;i<2;i++){
    const v=await read(await call(e,'factory_report',{taskIds:[id],execute:true}));
    assert.equal(v.status,'REPORT_READ_COMPLETED');
    assert.equal(v.readOnly,true);assert.equal(v.reportTool,'GO_BRAIN_MCP_FACTORY_REPORT');
    assert.equal(v.health.connection,'CONNECTED');assert.equal(v.tasks[0].bucket,'queued');
    assert.equal(v.tasks[0].evidenceStatus,'MISSING');
    assert.equal(v.evidence.length,3);
    assert.deepEqual(v.evidence.map(x=>x.status),Array(3).fill('READ_RETURNED'));
  }
  assert.deepEqual(ops.map(x=>x.operation),['factory_health','intent','factory_job','factory_health','intent','factory_job']);
  assert.deepEqual(ops[1].payload,{intent:'SHOW_TASK',task_id:id});
  assert.equal(ops[2].task_id,id);
});
test('Factory report denies invalid params without any remote calls',async()=>{
  let calls=0;const e={...baseEnv,PANTHEON_OWNER:{ownerCall:async()=>{calls++;throw Error('bad');}}};
  for(const args of [{taskIds:[id],execute:true,operation:'dispatch_factory'},
    {taskIds:[id],execute:'true'},{taskIds:[id,id],execute:true},
    {taskIds:['not-a-task'],execute:true},{taskIds:[],execute:true},
    {taskIds:Array(4).fill(id),execute:true}]){
    const r=await read(await call(e,'factory_report',args));
    assert.ok(r.isError===true||r.status==='INVALID_ARGUMENTS');
  }
  assert.equal(calls,0);
});
test('Factory report stops on upstream 403 without fallback or retries',async()=>{
  let calls=0;
  const e={...baseEnv,PANTHEON_OWNER:{ownerCall:async a=>{
    calls++;assert.equal(a.operation,'factory_health');
    return {ok:false,upstream_status:403,status:'ACCESS_DENIED'};
  }}};
  const result=await read(await call(e,'factory_report',{taskIds:[id],execute:true}));
  assert.equal(result.status,'PARTIAL');assert.equal(calls,1);
  assert.equal(result.evidence[0].status,'AUTH_REFUSED');
  assert.equal(result.evidence.filter(e=>e.attempted).length,1);
});
