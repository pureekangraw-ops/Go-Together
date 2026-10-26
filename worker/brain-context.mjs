// Read-only evidence pack for GO. No second memory store, model, or decision engine.
// The caller (GO) reasons over these source-linked records; stored text is untrusted.
const OPERATIONAL=new Set(['work_item','work_checkpoint','checkpoint','workflow','handoff','project','plan','decision','task']);
const EVOLUTION=new Set(['analysis','experiment','lesson','learning','rca','research','hypothesis','postmortem']);
const MODES=new Set(['operational','evolution','all']);
const shorten=(s,n)=>typeof s==='string'?s.slice(0,n):'';
const text=(v,n)=>typeof v==='string'&&v.trim()?v.trim().slice(0,n):null;
function groupOf(item){
 const kind=String(item.kind||'').toLowerCase();
 const tags=Array.isArray(item.tags)?item.tags:[];
 if(EVOLUTION.has(kind)||tags.some(t=>/^(rca|lesson|experiment|evolution)(:|-|$)/i.test(t)))return 'evolution';
 if(OPERATIONAL.has(kind))return 'operational';
 return 'reference';
}
function structuredNextAction(item){
 // Only extract a next action from our known, versioned Work Item schema.
 // Never invent actions by summarizing arbitrary free-form memory content.
 if(item.kind!=='work_item')return null;
 try{
  const obj=JSON.parse(item.content||'');
  if(obj?.schema!=='go-brain-r2.1/work-item/v1')return null;
  return text(obj.checkpoint?.next_action,500);
 }catch{return null;}
}
export function buildBrainContext(searchResult,{mode='operational',limit=10}={}){
 if(!MODES.has(mode))throw new RangeError('invalid_context_mode');
 if(!Number.isInteger(limit)||limit<1||limit>15)throw new RangeError('invalid_context_limit');
 const hits=Array.isArray(searchResult?.items)?searchResult.items.slice(0,limit):[];
 const entries=hits.map(hit=>{
  const m=hit.memory||{},body=String(m.content||'');
  const evidence=typeof m.evidence_url==='string'&&m.evidence_url.trim()?m.evidence_url.trim():null;
  const warnings=[];
  if(m.status!=='active')warnings.push('NOT_ACTIVE_REVIEW_SOURCE');
  if(m.confidence!=='confirmed')warnings.push('MEMORY_CONFIDENCE_NOT_CONFIRMED');
  if(!evidence)warnings.push('NO_EXTERNAL_EVIDENCE_LINK');
  if(body.length>900)warnings.push('EXCERPT_TRUNCATED_FETCH_EXACT_RECORD');
  return {
   section:groupOf(m),
   record_id:m.id||null,
   revision:Number.isInteger(m.revision)?m.revision:null,
   title:shorten(m.title,200),
   kind:m.kind||null,status:m.status||null,
   confidence:m.confidence||'unknown',
   lexical_score:typeof hit.score==='number'?hit.score:null,
   memory_updated_at:m.updated_at||null,
   source_updated_at:null, // A memory edit timestamp is NOT proof the original source is current.
   external_evidence_pointer:evidence, // Unverified stored pointer, NOT proof the URL was opened.
   work_id:m.work_id||null,
   tags:Array.isArray(m.tags)?m.tags.slice(0,15):[],
   excerpt:body.slice(0,900),
   next_action_from_structured_work_item:structuredNextAction(m),
   warnings
  };
 });
 const preference=mode==='evolution'?['evolution','operational','reference']:
   mode==='operational'?['operational','evolution','reference']:null;
 const ordered=preference?entries.sort((a,b)=>preference.indexOf(a.section)-preference.indexOf(b.section)):entries;
 return {
  type:'go_brain_source_context_v1',query:searchResult?.query||'',
  mode,method:searchResult?.method||'unknown',
  records:ordered,
  count:ordered.length,
  source_assessment:'NOT_INDEPENDENTLY_VERIFIED',
  notice:'GO Brain supplies ranked memory excerpts and version pointers only. GO checks exact sources, performs reasoning, chooses tools, and confirms real outcomes. Memory updated_at is not source freshness; lexical score is not factual confidence. No training, task execution, or memory mutation.'
 };
}
