// GO Brain's existing D1 memories implement this learning cycle.
// Structured evidence/measurements, not model training, automatic policy or new infrastructure.
// Keep exact source pointers: this service never copies or guesses source documents.
export const LEARNING_SCHEMA='go-brain-learning/v1';
const STAGES=new Set(['receive','learn','improve','use']);
const DIRECTIONS=new Set(['UP','DOWN']);
const KINDS=new Set(['START','PLAN','OBSERVE','USE','STATUS']);
const URL=/^https:\/\/[^\s]+$/i;
const CODE=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/;
const bad=code=>{throw new RangeError(code)};
const compact=(v,n,field)=>{
 if(typeof v!=='string'||!v.trim()||v.trim().length>n)bad('LEARNING_INVALID_'+field);
 return v.trim();
};
const optional=(v,n,field)=>v===undefined?'':compact(v,n,field);
const numeric=(v,field)=>{
 if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12)bad('LEARNING_INVALID_'+field);
 return v;
};
function fields(x,allow,required=[]){
 if(!x||typeof x!=='object'||Array.isArray(x))bad('LEARNING_PAYLOAD_REQUIRED');
 for(const key of Object.keys(x))if(!allow.includes(key))bad('LEARNING_UNKNOWN_FIELD_'+key);
 for(const key of required)if(x[key]===undefined)bad('LEARNING_REQUIRED_'+key);
}
function pointer(value,name){
 const v=compact(value,2000,name);
 if(!URL.test(v))bad('LEARNING_EVIDENCE_POINTER_INVALID');
 return v;
}
function stage(record,note){
 if(!STAGES.has(note.stage)||!record.tags.includes('stage:'+note.stage))bad('LEARNING_STAGE_MISMATCH');
 return note.stage;
}
function read(record){
 if(!record||record.kind!=='learning')bad('LEARNING_RECORD_NOT_FOUND');
 let data;
 try{data=JSON.parse(record.content)}catch{bad('LEARNING_RECORD_CORRUPT')}
 if(!data||data.schema!==LEARNING_SCHEMA||typeof data.lesson!=='string'||
    typeof data.context!=='string'||!STAGES.has(data.stage))bad('LEARNING_RECORD_CORRUPT');
 stage(record,data);
 return data;
}
const evidenceStatus=(result)=>result?.verifiedReceipt===true?'FACTORY_RECEIPT_READBACK':'SOURCE_POINTER_ONLY';
export function learningDecision(note){
 if(!note||note.schema!==LEARNING_SCHEMA)bad('LEARNING_RECORD_CORRUPT');
 if(note.stage==='receive')return {nextAction:'PLAN',comparison:null,targetMet:null};
 if(note.stage==='learn')return {nextAction:'OBSERVE',comparison:null,targetMet:null};
 const exp=note.experiment,result=note.observation;
 if(!exp||!result)bad('LEARNING_OBSERVATION_MISSING');
 const delta=(exp.direction==='UP'?1:-1)*(result.observed-exp.baseline);
 const improved=delta>0;
 const targetMet=exp.direction==='UP'?result.observed>=exp.target:result.observed<=exp.target;
 const comparison=delta>0?'IMPROVED':delta<0?'REGRESSED':'UNCHANGED';
 return {nextAction:note.stage==='use'?'OBSERVE_NEXT_WORK':targetMet&&improved?'USE':'PLAN',
   comparison,targetMet,improved,delta};
}
function view(record){
 const note=read(record);
 return {type:'go_brain_learning_cycle_v1',record_id:record.id,revision:record.revision,
  stage:note.stage,work_id:record.work_id||null,source_pointer:record.evidence_url||null,
  ...learningDecision(note),note,
  notice:'Evidence pointers and reported metrics are not independently verified measurements. USE changes only retrievable work guidance; no model weights, policy, deployment or task runner are modified.'};
}
function nextTags(tags,phase){
 const keep=tags.filter(t=>!t.startsWith('stage:')&&!t.startsWith('learning:')&&t!=='evolution:learning');
 return [...new Set([...keep,'evolution:learning','stage:'+phase,...(phase==='use'?['learning:use']:[])])];
}
export async function runBrainLearning({get,save,edit,verifyReceipt=async()=>null},input){
 if(!input||!KINDS.has(input.action))bad('LEARNING_ACTION_INVALID');
 const action=input.action;
 fields(input,['action','id','expected_revision','payload']);
 if(action==='START'){
  if(input.id!==undefined||input.expected_revision!==undefined)bad('LEARNING_START_HAS_ID');
  const x=input.payload;
  fields(x,['title','lesson','context','sourceUrl','workId'],['title','lesson','context','sourceUrl']);
  const note={schema:LEARNING_SCHEMA,stage:'receive',
    lesson:compact(x.lesson,4000,'LESSON'),context:compact(x.context,4000,'CONTEXT'),
    sourceUrl:pointer(x.sourceUrl,'SOURCE'),experiment:null,observation:null,history:[]};
  const record=await save({kind:'learning',title:compact(x.title,200,'TITLE'),
    content:JSON.stringify(note),status:'active',confidence:'unknown',
    evidence_url:note.sourceUrl,work_id:optional(x.workId,120,'WORK_ID'),
    tags:nextTags([],'receive'),outcome:''});
  return view(record);
 }
 if(typeof input.id!=='string'||!/^[0-9a-f-]{36}$/i.test(input.id))bad('LEARNING_RECORD_ID_INVALID');
 const record=await get(input.id);
 const note=read(record);
 if(action==='STATUS'){
  if(input.payload!==undefined||input.expected_revision!==undefined)bad('LEARNING_STATUS_READ_ONLY');
  return view(record);
 }
 if(!Number.isInteger(input.expected_revision)||input.expected_revision<1||
    input.expected_revision!==record.revision)bad('LEARNING_REVISION_CONFLICT');
 let output,confidence='unknown',outcome='';
 if(action==='PLAN'){
  if(!['receive','learn','improve'].includes(note.stage))bad('LEARNING_PLAN_STAGE_INVALID');
  const x=input.payload;
  fields(x,['method','metric','direction','baseline','target','limitations','testPlan'],
    ['method','metric','direction','baseline','target','limitations','testPlan']);
  if(!DIRECTIONS.has(x.direction))bad('LEARNING_DIRECTION_INVALID');
  const baseline=numeric(x.baseline,'BASELINE'),target=numeric(x.target,'TARGET');
  if((x.direction==='UP'&&target<=baseline)||(x.direction==='DOWN'&&target>=baseline))
    bad('LEARNING_TARGET_NOT_IMPROVED');
  const experiment={method:compact(x.method,4000,'METHOD'),
    metric:compact(x.metric,120,'METRIC'),direction:x.direction,baseline,target,
    limitations:compact(x.limitations,2000,'LIMITATIONS'),
    testPlan:compact(x.testPlan,4000,'TEST_PLAN')};
  const history=Array.isArray(note.history)?note.history.slice(-9):[];
  if(note.stage==='improve')history.push({experiment:note.experiment,observation:note.observation});
  output={...note,stage:'learn',experiment,observation:null,history};
 }else if(action==='OBSERVE'){
  if(!['learn','use'].includes(note.stage))bad('LEARNING_OBSERVE_STAGE_INVALID');
  const x=input.payload;
  fields(x,['observed','resultUrl','sampleSize','notes','receiptId'],
    ['observed','resultUrl','sampleSize']);
  const observed=numeric(x.observed,'OBSERVED'),resultUrl=pointer(x.resultUrl,'RESULT');
  if(!Number.isInteger(x.sampleSize)||x.sampleSize<1||x.sampleSize>1000000)
   bad('LEARNING_INVALID_SAMPLE_SIZE');
  let proof={verifiedReceipt:false};
  if(x.receiptId!==undefined){
   const receiptId=compact(x.receiptId,90,'RECEIPT');
   if(!/^receipt-[A-Za-z0-9-]{8,80}$/.test(receiptId))bad('LEARNING_RECEIPT_INVALID');
   proof=await verifyReceipt({receiptId,workId:record.work_id||null});
   if(!proof||proof.verifiedReceipt!==true)bad('LEARNING_RECEIPT_UNVERIFIED');
  }
  output={...note,stage:'improve',observation:{
   observed,sampleSize: x.sampleSize,resultUrl,
   notes:optional(x.notes,2000,'NOTES'),recordedAt:new Date().toISOString(),
   evidenceStatus:evidenceStatus(proof),
   ...(proof.verifiedReceipt?{receiptId:x.receiptId,verifiedJobId:proof.jobId||null}:{})
  }};
  const result=learningDecision(output);
  outcome=result.comparison+'; TARGET_'+(result.targetMet?'MET':'MISSED')+
   '; '+evidenceStatus(proof)+'; METRIC_SELF_REPORTED';
  confidence='probable';
 }else if(action==='USE'){
  if(note.stage!=='improve')bad('LEARNING_USE_STAGE_INVALID');
  fields(input.payload||{},[]);
  const decision=learningDecision(note);
  if(!decision.targetMet||!decision.improved)bad('LEARNING_NOT_IMPROVED');
  if(!note.observation?.resultUrl)bad('LEARNING_RESULT_POINTER_MISSING');
  output={...note,stage:'use',usedAt:new Date().toISOString()};
  confidence='probable';outcome='REPORTED_TARGET_MET_METHOD_AVAILABLE_FOR_NEXT_PLAN';
 }else bad('LEARNING_ACTION_INVALID');
 if(JSON.stringify(output).length>47000)bad('LEARNING_NOTE_TOO_LARGE');
 const updated=await edit(input.id,{
  content:JSON.stringify(output),tags:nextTags(record.tags,output.stage),
  confidence,outcome
 },input.expected_revision);
 return view(updated);
}

// Pure selector used by Operational context: guidance only, never a command.
export function appliedLearningFromMemory(row){
 if(row?.kind!=='learning'||!Array.isArray(row.tags)||
    !row.tags.includes('stage:use')||row.status!=='active')return null;
 let note;
 try{note=read(row)}catch{return null}
 if(note.stage!=='use'||!note.experiment||!note.observation)return null;
 const result=learningDecision(note);
 if(!result.targetMet||!result.improved)return null;
 return {lesson:note.lesson.slice(0,500),method:note.experiment.method.slice(0,1000),
  metric:note.experiment.metric,baseline:note.experiment.baseline,
  observed:note.observation.observed,sampleSize:note.observation.sampleSize,
  resultEvidencePointer:note.observation.resultUrl,
  verification:note.observation.evidenceStatus,
  authority:'PROVISIONAL_NEXT_PLAN_GUIDANCE_NOT_POLICY'};
}
