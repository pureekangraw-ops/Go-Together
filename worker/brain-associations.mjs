// Bounded, evidence-backed derived indexing. This module never modifies source memories.
import {EXTRACTOR_VERSION,associationStatus} from './brain-keywords.mjs';

const LIVE = "('active','needs_review')";
const SCHEMA = {
 type:'object',additionalProperties:false,required:['intents','entities','keywords','relations'],properties:{
  intents:{type:'array',items:{type:'object',additionalProperties:false,required:['label','evidence'],properties:{label:{type:'string'},evidence:{$ref:'#/$defs/evidence'}}}},
  entities:{type:'array',items:{type:'object',additionalProperties:false,required:['label','evidence','aliases'],properties:{
   label:{type:'string'},evidence:{$ref:'#/$defs/evidence'},
   aliases:{type:'array',items:{type:'object',additionalProperties:false,required:['label','evidence'],properties:{label:{type:'string'},evidence:{$ref:'#/$defs/evidence'}}}}
  }}},
  keywords:{type:'array',items:{type:'object',additionalProperties:false,required:['label','evidence'],properties:{label:{type:'string'},evidence:{$ref:'#/$defs/evidence'}}}},
  relations:{type:'array',items:{type:'object',additionalProperties:false,required:['target_id','target_revision','type','evidence','target_evidence'],properties:{
   target_id:{type:'string'},target_revision:{type:'integer'},type:{type:'string',enum:['related']},
   evidence:{$ref:'#/$defs/evidence'},target_evidence:{$ref:'#/$defs/evidence'}
  }}}
 },$defs:{evidence:{type:'object',additionalProperties:false,required:['field','quote'],properties:{field:{type:'string',enum:['title','content','tags','outcome']},quote:{type:'string'}}}}
};
function isObject(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function keys(v,required){return isObject(v)&&Object.keys(v).length===required.length&&required.every(k=>Object.hasOwn(v,k));}
function label(v){return typeof v==='string'&&v.trim().length>0&&v.length<=128;}
function sourceField(memory,field){
 if(field==='tags'){try{return JSON.parse(memory.tags||'[]').join(' ');}catch{return '';}}
 return String(memory[field]||'');
}
function validEvidence(e,memory){
 return keys(e,['field','quote'])&&['title','content','tags','outcome'].includes(e.field)
  &&typeof e.quote==='string'&&e.quote.length>0&&e.quote.length<=400
  &&sourceField(memory,e.field).includes(e.quote);
}
function validate(raw,source,candidates){
 if(!keys(raw,['intents','entities','keywords','relations']))return null;
 for(const [name,max] of [['intents',12],['entities',24],['keywords',32],['relations',12]])
  if(!Array.isArray(raw[name])||raw[name].length>max)return null;
 const terms=[],links=[];
 const add=(kind,item,entity_key='')=>{
  if(!keys(item,['label','evidence'])||!label(item.label)||!validEvidence(item.evidence,source))return false;
  terms.push({kind,label:item.label.trim(),entity_key,evidence:item.evidence});return true;
 };
 for(const x of raw.intents)if(!add('intent',x))return null;
 for(const x of raw.entities){
  if(!keys(x,['label','evidence','aliases'])||!label(x.label)||!validEvidence(x.evidence,source)
    ||!Array.isArray(x.aliases)||x.aliases.length>12)return null;
  const entity_key=x.label.trim().toLowerCase();
  terms.push({kind:'entity',label:x.label.trim(),entity_key,evidence:x.evidence});
  for(const alias of x.aliases)if(!add('alias',alias,entity_key))return null;
 }
 for(const x of raw.keywords)if(!add('keyword',x,
  raw.entities.find(e=>e.label.toLowerCase()===x?.label?.toLowerCase())?.label.toLowerCase()||''))return null;
 for(const x of raw.relations){
  if(!keys(x,['target_id','target_revision','type','evidence','target_evidence'])||
   typeof x.target_id!=='string'||x.type!=='related'||!Number.isSafeInteger(x.target_revision)||
   !validEvidence(x.evidence,source))return null;
  const target=candidates.find(m=>m.id===x.target_id&&m.revision===x.target_revision);
  if(!target||!validEvidence(x.target_evidence,target))return null;
  links.push(x);
 }
 return {terms,links};
}
function sanitizedCode(error){return error instanceof RangeError?'invalid_association_output':'provider_request_failed';}
async function fail(db,run,token,code){
 await db.prepare("UPDATE brain_association_runs SET state='failed',last_error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND state='running' AND lease_token=?")
  .bind(code,new Date().toISOString(),run.id,token).run();
 const result=await associationStatus(db,run.memory_id);
 return result.state==='failed'?result:{...result,state:result.state==='superseded'?'superseded':result.state};
}
async function getRun(db,id,revision){
 return db.prepare('SELECT * FROM brain_association_runs WHERE memory_id=? AND revision=? AND extractor_version=?')
  .bind(id,revision,EXTRACTOR_VERSION).first();
}
const short=m=>({id:m.id,revision:m.revision,title:String(m.title||'').slice(0,250),
 content:String(m.content||'').slice(0,5000),tags:m.tags,outcome:String(m.outcome||'').slice(0,500)});
export async function processAssociation(env,{id,expected_revision,retry_failed=false}={}, {requester=fetch}={}){
 if(typeof id!=='string'||!Number.isInteger(expected_revision)||expected_revision<1)throw new RangeError('invalid_revision');
 const db=env.DB;
 const source=await db.prepare('SELECT id,revision,status,kind,title,content,tags,outcome FROM memories WHERE id=?').bind(id).first();
 if(!source)throw new RangeError('memory_not_found');
 if(source.revision!==expected_revision||!['active','needs_review'].includes(source.status))
  return {memory_id:id,revision:source.revision,state:'superseded'};
 const run=await getRun(db,id,expected_revision);
 if(!run)return {memory_id:id,revision:expected_revision,state:'not_indexed'};
 if(run.state==='ready'||run.state==='superseded'||run.state==='failed'&&!retry_failed)
  return associationStatus(db,id);
 const now=new Date(),token=crypto.randomUUID(),leaseUntil=new Date(now.getTime()+180000).toISOString();
 const claim=await db.prepare(
  "UPDATE brain_association_runs SET state='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?,last_error=NULL "+
  "WHERE id=? AND (state='pending' OR (state='failed' AND ?=1) OR (state='running' AND lease_until<?)) "+
  "AND EXISTS(SELECT 1 FROM memories WHERE id=? AND revision=? AND status IN "+LIVE+")")
  .bind(token,leaseUntil,now.toISOString(),run.id,retry_failed?1:0,now.toISOString(),id,expected_revision).run();
 if(claim.meta.changes!==1)return associationStatus(db,id);
 run.memory_id=id;
 let secret;
 try{secret=await env.BRAIN_ASSOCIATION_API_KEY?.get?.();}
 catch{return fail(db,run,token,'secret_binding_unavailable');}
 if(typeof secret!=='string'||!secret.trim())return fail(db,run,token,'secret_binding_unavailable');
 if(env.BRAIN_ASSOCIATIONS_ENABLED!=='true')return fail(db,run,token,'associations_disabled');
 const model=env.BRAIN_ASSOCIATION_MODEL||'gpt-4.1-mini-2025-04-14';
 const candidates=(await db.prepare(
  "SELECT id,revision,status,title,content,tags,outcome FROM memories WHERE id<>? AND status IN "+LIVE+" ORDER BY updated_at DESC,id DESC LIMIT 12"
 ).bind(id).all()).results||[];
 const body={model,store:false,max_output_tokens:2000,
  instructions:'Extract only grounded evidence from the provided source JSON. Return short labels and exact quoted evidence from the named field. Aliases are suggestions, not proof of equivalence. Relations must point to candidate IDs and exact revisions. Use related only, never claim approved or superseded. Empty arrays are valid when unsupported. No tool use.',
  input:[{role:'user',content:JSON.stringify({source:short(source),candidates:candidates.map(m=>short(m))})}],
  text:{format:{type:'json_schema',name:'brain_associations',strict:true,schema:SCHEMA}}};
 let result;
 try{
  const response=await requester('https://api.openai.com/v1/responses',{
   method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  if(!response.ok)return fail(db,run,token,'provider_http_'+String(response.status));
  const payload=await response.json();
  if(payload.status!=='completed')return fail(db,run,token,'invalid_association_output');
  const texts=(payload.output||[]).flatMap(x=>(x.content||[]).filter(c=>c.type==='output_text').map(c=>c.text));
  if(texts.length!==1||texts[0].length>20000)return fail(db,run,token,'invalid_association_output');
  result=validate(JSON.parse(texts[0]),source,candidates);
  if(!result)return fail(db,run,token,'invalid_association_output');
 }catch(e){return fail(db,run,token,sanitizedCode(e));}
 const current=await db.prepare('SELECT revision,status FROM memories WHERE id=?').bind(id).first();
 if(!current||current.revision!==expected_revision||!['active','needs_review'].includes(current.status))
  return {memory_id:id,revision:expected_revision,state:'superseded'};
 for(const link of result.links){
  const target=await db.prepare('SELECT revision,status FROM memories WHERE id=?').bind(link.target_id).first();
  if(!target||target.revision!==link.target_revision||!['active','needs_review'].includes(target.status))
   return fail(db,run,token,'target_revision_changed');
 }
 const timestamp=new Date().toISOString(),statements=[];
 // Only exact current revisions may publish. All operations run inside one D1 batch transaction.
 const guard="EXISTS(SELECT 1 FROM memories m JOIN brain_association_runs r ON r.memory_id=m.id AND r.revision=m.revision "+
  "WHERE m.id=? AND m.revision=? AND m.status IN "+LIVE+" AND r.id=? AND r.state='running' AND r.lease_token=?)";
 const guardArgs=[id,expected_revision,run.id,token];
 // A timed-out worker must not delete the results of a newer lease holder.
 // Lease and source-revision guards apply to deletes as well as inserts.
 statements.push(db.prepare('DELETE FROM brain_memory_terms WHERE run_id=? AND '+guard).bind(run.id,...guardArgs));
 statements.push(db.prepare('DELETE FROM brain_memory_links WHERE run_id=? AND '+guard).bind(run.id,...guardArgs));
 for(const t of result.terms){
  statements.push(db.prepare(
   'INSERT INTO brain_memory_terms(memory_id,revision,run_id,term,label,kind,entity_key,provenance,evidence_json) '+
   'SELECT ?,?,?,?,?,?,?,?,? WHERE '+guard+' ON CONFLICT DO NOTHING')
   .bind(id,expected_revision,run.id,t.label.toLowerCase(),t.label,t.kind,t.entity_key,'ai_suggested',JSON.stringify(t.evidence),...guardArgs));
 }
 for(const l of result.links){
  statements.push(db.prepare(
   'INSERT INTO brain_memory_links(run_id,target_id,target_revision,type,evidence_json,target_evidence_json) '+
   'SELECT ?,?,?,?,?,? WHERE '+guard+' AND EXISTS(SELECT 1 FROM memories WHERE id=? AND revision=? AND status IN '+LIVE+') ON CONFLICT DO NOTHING')
   .bind(run.id,l.target_id,l.target_revision,l.type,JSON.stringify(l.evidence),JSON.stringify(l.target_evidence),...guardArgs,l.target_id,l.target_revision));
 }
 const targetsGuard=result.links.map(()=>"EXISTS(SELECT 1 FROM memories WHERE id=? AND revision=? AND status IN "+LIVE+")").join(' AND ');
 const finalGuard=targetsGuard?' AND '+targetsGuard:'';
 const targets=result.links.flatMap(l=>[l.target_id,l.target_revision]);
 statements.push(db.prepare("UPDATE brain_association_runs SET state='ready',lease_token=NULL,lease_until=NULL,model=?,result_json=?,last_error=NULL,updated_at=? "+
  "WHERE id=? AND state='running' AND lease_token=? AND "+guard+finalGuard)
  .bind(model,JSON.stringify(result),timestamp,run.id,token,...guardArgs,...targets));
 try{await db.batch(statements);}
 catch{return fail(db,run,token,'association_write_failed');}
 const completed=await associationStatus(db,id);
 return completed;
}
export async function drainAssociations(env,{requester=fetch,limit=5}={}){
 const max=Number.isInteger(limit)&&limit>0?Math.min(limit,10):5;
 const jobs=(await env.DB.prepare(
  "SELECT r.memory_id AS id,r.revision FROM brain_association_runs r JOIN memories m ON m.id=r.memory_id AND m.revision=r.revision "+
  "WHERE (r.state='pending' OR (r.state='running' AND r.lease_until IS NOT NULL AND r.lease_until<?)) "+
  "AND r.extractor_version=? AND m.status IN "+LIVE+
  " ORDER BY r.created_at ASC,r.memory_id ASC LIMIT ?").bind(new Date().toISOString(),EXTRACTOR_VERSION,max).all()).results||[];
 const results=[];
 for(const job of jobs)results.push(await processAssociation(env,{id:job.id,expected_revision:job.revision},{requester}));
 return {processed:results.length,results};
}
