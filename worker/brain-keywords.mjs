import {queryTerms,pageSize,scope,encodeCursor,decodeCursor} from './brain-search.mjs';
export const EXTRACTOR_VERSION='association-v1';
export async function associationStatus(db,id){
 const memory=await db.prepare('SELECT id,revision,status FROM memories WHERE id=?').bind(id).first();
 if(!memory)throw new RangeError('memory_not_found');
 const row=await db.prepare('SELECT id,state,attempts,model,last_error,updated_at,lease_until FROM brain_association_runs WHERE memory_id=? AND revision=? AND extractor_version=?').bind(id,memory.revision,EXTRACTOR_VERSION).first();
 return {memory_id:id,revision:memory.revision,lifecycle_status:memory.status,state:row?.state??(['active','needs_review'].includes(memory.status)?'not_indexed':'inactive'),attempts:row?.attempts??0,
 model:row?.model??null,last_error:row?.last_error??null,updated_at:row?.updated_at??null,lease_until:row?.lease_until??null,provenance:'ai_suggested'};
}
// An occurrence is authoritative only as an index pointer to its exact current source revision.
const LIVE_TERM="(t.run_id='' OR EXISTS(SELECT 1 FROM brain_association_runs r WHERE r.id=t.run_id AND r.memory_id=t.memory_id AND r.revision=t.revision AND r.state='ready'))";
export async function keywordFinder(db,{query,status,kind,limit,cursor}={}){
 const terms=queryTerms(query,'any'),statuses=scope(status),max=pageSize(limit,10,25);
 if(kind!==undefined&&(typeof kind!=='string'||!kind||kind.length>80))throw new RangeError('invalid_kind');
 const identity=JSON.stringify({query:query.trim().toLowerCase(),status:statuses,kind:kind??null});let offset=0;
 if(cursor){const c=decodeCursor(cursor);if(c.identity!==identity||!Number.isSafeInteger(c.offset)||c.offset<0||c.offset>1000000)throw new RangeError('invalid_cursor');offset=c.offset;}
 const params=[...statuses];let filters='m.status IN ('+statuses.map(()=>'?').join(',')+')';
 if(kind!==undefined){filters+=' AND m.kind=?';params.push(kind);}
 const matched=terms.map(term=>{params.push(term);return 'instr(t.term,?)>0';}).join(' OR ');
 const rows=(await db.prepare(`SELECT m.id,m.revision,m.title,m.status,m.updated_at FROM memories m WHERE ${filters} AND EXISTS(SELECT 1 FROM brain_memory_terms t WHERE t.memory_id=m.id AND t.revision=m.revision AND ${LIVE_TERM} AND (${matched})) ORDER BY m.updated_at DESC,m.id DESC LIMIT ? OFFSET ?`).bind(...params,max+1,offset).all()).results||[];
 const items=[];
 for(const m of rows.slice(0,max)){
  const occurrences=(await db.prepare(`SELECT t.label,t.term,t.kind,t.entity_key,t.provenance,t.evidence_json FROM brain_memory_terms t WHERE t.memory_id=? AND t.revision=? AND ${LIVE_TERM} ORDER BY CASE t.provenance WHEN 'GO_supplied' THEN 0 ELSE 1 END,t.kind,t.term LIMIT 120`).bind(m.id,m.revision).all()).results||[];
  const hits=occurrences.filter(t=>terms.some(q=>t.term.includes(q)));
  const links=(await db.prepare(`SELECT r.memory_id,r.revision,l.target_id,l.target_revision,l.type,l.evidence_json,l.target_evidence_json FROM brain_memory_links l JOIN brain_association_runs r ON r.id=l.run_id JOIN memories s ON s.id=r.memory_id AND s.revision=r.revision JOIN memories d ON d.id=l.target_id AND d.revision=l.target_revision WHERE r.state='ready' AND s.status IN ('active','needs_review') AND d.status IN ('active','needs_review') AND (s.id=? OR d.id=?) ORDER BY r.updated_at DESC,l.target_id LIMIT 10`).bind(m.id,m.id).all()).results||[];
  const paths=occurrences.filter(t=>!hits.includes(t)).slice(0,20).map(t=>({label:t.label,kind:t.kind,entity_key:t.entity_key||null,type:hits.some(h=>h.entity_key&&h.entity_key===t.entity_key)?'same_entity_candidate':'co_occurs',provenance:t.provenance,evidence:JSON.parse(t.evidence_json)}));
  items.push({memory_id:m.id,revision:m.revision,title:m.title,status:m.status,matches:hits.map(t=>({label:t.label,kind:t.kind,provenance:t.provenance,evidence:JSON.parse(t.evidence_json)})),paths,
   relations:links.map(l=>({...l,evidence:JSON.parse(l.evidence_json),target_evidence:JSON.parse(l.target_evidence_json),evidence_json:undefined,target_evidence_json:undefined,provenance:'ai_suggested'})),
   suggested_queries:[...new Set(paths.map(t=>t.label))],association_state:(await associationStatus(db,m.id)).state});
 }
 const more=rows.length>max;
 return {query,method:'keyword-finder-v1',items,count:items.length,next_cursor:more?encodeCursor({identity,offset:offset+max}):null,
 coverage:{statuses,kind:kind??null,has_more:more,paths_per_memory:20,relations_per_memory:10,notice:'Only current indexed occurrences; historical memories may have explicit tags only. Paths are bounded and pages can change during edits.'},
 notice:'Discovery suggestions only. Co-occurrence is not proof of equivalence; AI aliases and relations are unconfirmed. GO selects the next search or exact record.'};
}
