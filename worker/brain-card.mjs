// Source-backed view only. No inference, association engine or source verification.
const TIMES=['occurred_at','effective_at','source_updated_at','source_verified_at'];
const KEYS=['context','work_status',...TIMES,'source_refs'];
export const METADATA_SCHEMA={type:'object',additionalProperties:false,properties:{
 context:{type:['string','null'],maxLength:4000},work_status:{type:['string','null'],maxLength:200},
 ...Object.fromEntries(TIMES.map(k=>[k,{type:['string','null'],description:'Explicit ISO date or UTC timestamp from source; null if unknown.'}])),
 source_refs:{type:'array',maxItems:20,items:{type:'object',additionalProperties:false,required:['locator'],properties:{locator:{type:'string',maxLength:2000},revision:{type:['string','null'],maxLength:200}}}}
}};
function invalid(){throw new RangeError('invalid_metadata');}
function bounded(v,max){if(v===null)return null;if(typeof v!=='string'||v.length>max)invalid();return v.trim()||null;}
function date(v){
 if(v===null)return null;
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(v))invalid();
 const parsed=new Date(v);if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==v.slice(0,10))invalid();
 if(v.length>10&&parsed.toISOString().slice(11,19)!==v.slice(11,19))invalid();return v;
}
export function normalizeMetadata(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!KEYS.includes(k)))invalid();
 const out={context:bounded(input.context??null,4000),work_status:bounded(input.work_status??null,200)};
 for(const k of TIMES)out[k]=date(input[k]??null);
 if(input.source_refs!==undefined&&(!Array.isArray(input.source_refs)||input.source_refs.length>20))invalid();
 out.source_refs=(input.source_refs||[]).map(ref=>{
  if(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).some(k=>!['locator','revision'].includes(k)))invalid();
  const locator=bounded(ref.locator,2000);if(!locator||!/^(?:https?:\/\/|notion:\/\/|user:\/\/)/i.test(locator))invalid();
  return {locator,revision:bounded(ref.revision??null,200)};
 });return out;
}
export function buildMemoryCard(memory){
 const meta=normalizeMetadata(memory.metadata||{});let work=null;
 if(memory.kind==='work_item')try{const value=JSON.parse(memory.content);if(value?.schema==='go-brain-r2.1/work-item/v1')work=value;}catch{/* preserve free text */}
 const warnings=[];
 if(!meta.source_verified_at)warnings.push('SOURCE_FRESHNESS_UNKNOWN');
 if(!memory.evidence_url&&!meta.source_refs.length)warnings.push('NO_SOURCE_REFERENCE');
 if(memory.confidence!=='confirmed')warnings.push('MEMORY_CONFIDENCE_NOT_CONFIRMED');
 if(memory.status!=='active')warnings.push('NOT_ACTIVE');
 return {schema:'go-brain/memory-card/v1',memory_id:memory.id,revision:memory.revision,title:memory.title,kind:memory.kind,
 lifecycle_status:memory.status,work_status:meta.work_status??(typeof work?.detail_status==='string'?work.detail_status:null),
 work_group:['in_progress','completed'].includes(work?.group)?work.group:null,confidence:memory.confidence,context:meta.context,
 time:{memory_created_at:memory.created_at,memory_updated_at:memory.updated_at,...Object.fromEntries(TIMES.map(k=>[k,meta[k]]))},
 source:{content:memory.content,tags:memory.tags,work_id:memory.work_id,evidence_url:memory.evidence_url,outcome:memory.outcome,refs:meta.source_refs},
 source_assessment:'NOT_INDEPENDENTLY_VERIFIED',warnings};
}
