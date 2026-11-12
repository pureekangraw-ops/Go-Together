// Literal source search. No AI, alias expansion, historical corpus cutoff or LIKE wildcards.
export const MEMORY_COLUMNS='id,kind,title,content,status,work_id,evidence_url,outcome,confidence,tags,revision,created_at,updated_at,metadata';
export const STATUSES=['active','needs_review','stale','archived','deleted'];
const FIELDS={title:6,tags:5,work_id:4,content:2,outcome:2};
export function publicMemory(row){const {save_request_id,save_request_hash,save_response,score,...value}=row;return {...value,tags:typeof row.tags==='string'?JSON.parse(row.tags):row.tags||[],metadata:typeof row.metadata==='string'?JSON.parse(row.metadata):row.metadata||{}};}
export function pageSize(value,fallback=25,max=50){const n=value===undefined?fallback:Number(value);if(!Number.isInteger(n)||n<1||n>max)throw new RangeError('invalid_limit');return n;}
export function scope(status){if(status===undefined)return ['active','needs_review'];if(status==='all')return STATUSES;if(!STATUSES.includes(status))throw new RangeError('invalid_status');return [status];}
export function encodeCursor(value){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export function decodeCursor(value){try{if(typeof value!=='string'||value.length>3000)throw 0;return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));}catch{throw new RangeError('invalid_cursor');}}
export function queryTerms(query,match='all'){
 if(typeof query!=='string'||!query.trim()||query.length>200)throw new RangeError('invalid_query');
 if(!['all','any','phrase'].includes(match))throw new RangeError('invalid_match');
 const terms=[...new Set((match==='phrase'?[query.trim()]:query.trim().split(/\s+/u)).map(x=>x.toLowerCase()))];
 if(terms.length>10)throw new RangeError('too_many_query_terms');return terms;
}
export const needsUnicodeFold=terms=>terms.some(t=>/[\u0080-\uFFFF]/u.test(t)&&t.toUpperCase()!==t);
function evidence(memory,terms){return Object.keys(FIELDS).flatMap(field=>{
 const value=field==='tags'?memory.tags.join(' '):String(memory[field]||'');const lower=value.toLowerCase();const found=terms.filter(t=>lower.includes(t));
 if(!found.length)return [];const at=lower.indexOf(found[0]),start=Math.max(0,at-70);
 return [{field,terms:found,excerpt:value.slice(start,start+320)}];
});}
export async function keywordSearch(db,{query,limit,kind,status,match='all',cursor}={}){
 const terms=queryTerms(query,match),statuses=scope(status),max=pageSize(limit);
 if(kind!==undefined&&(typeof kind!=='string'||!kind.trim()||kind.length>80))throw new RangeError('invalid_kind');
 const identity=JSON.stringify({query:query.trim().toLowerCase(),kind:kind??null,status:statuses,match});let offset=0;
 if(cursor){const c=decodeCursor(cursor);if(c.identity!==identity||!Number.isSafeInteger(c.offset)||c.offset<0||c.offset>1000000)throw new RangeError('invalid_cursor');offset=c.offset;}
 const values=[];const scores=terms.map((term,i)=>'max('+Object.entries(FIELDS).map(([field,weight])=>{values.push(term);return `CASE WHEN instr(lower(${field}),?)>0 THEN ${weight} ELSE 0 END`;}).join(',')+`) AS t${i}`);
 const clauses=['status IN ('+statuses.map(()=>'?').join(',')+')'];values.push(...statuses);
 if(kind!==undefined){clauses.push('kind=?');values.push(kind);}
 const names=terms.map((_,i)=>'t'+i),where=names.map(n=>n+'>0').join(match==='any'?' OR ':' AND ');
 const sql=`WITH ranked AS (SELECT ${MEMORY_COLUMNS},${scores.join(',')} FROM memories WHERE ${clauses.join(' AND ')}) SELECT ${MEMORY_COLUMNS},(${names.join('+')}) AS score FROM ranked WHERE (${where}) ORDER BY score DESC,updated_at DESC,id DESC LIMIT ? OFFSET ?`;
 let rows;
 if(needsUnicodeFold(terms)){
  // SQLite lower() folds ASCII only. Scan selected sources in bounded batches,
  // fold in JS, and retain only the requested ranked window. Never rewrite sources.
  let after=null;const best=[];
  const compare=(a,b)=>b.score-a.score||(a.updated_at===b.updated_at?(a.id===b.id?0:a.id>b.id?-1:1):a.updated_at>b.updated_at?-1:1);
  for(;;){
   const filters=[...clauses];const args=[...statuses,...(kind!==undefined?[kind]:[])];
   if(after!==null){filters.push('id>?');args.push(after);}
   const batch=(await db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE ${filters.join(' AND ')} ORDER BY id LIMIT 200`).bind(...args).all()).results||[];
   for(const row of batch){
    const scores=terms.map(term=>Math.max(...Object.entries(FIELDS).map(([field,weight])=>String(row[field]||'').toLowerCase().includes(term)?weight:0)));
    if(match==='any'?scores.some(Boolean):scores.every(Boolean))best.push({...row,score:scores.reduce((a,b)=>a+b,0)});
   }
   best.sort(compare);best.length=Math.min(best.length,offset+max+1);
   if(batch.length<200)break;after=batch.at(-1).id;
  }
  rows=best.slice(offset);
 }else rows=(await db.prepare(sql).bind(...values,max+1,offset).all()).results||[];
 const more=rows.length>max,items=rows.slice(0,max).map(row=>{const memory=publicMemory(row);return {score:Math.round(1000*row.score/(6*terms.length))/1000,memory,matches:evidence(memory,terms)};});
 return {query,method:'source-keyword-v3',match,items,count:items.length,next_cursor:more?encodeCursor({identity,offset:offset+max}):null,
 coverage:{statuses,kind:kind??null,pre_match_limit:null,source_fields:Object.keys(FIELDS),page_size:max,has_more:more,consistency:'Pages may move if memories are edited between requests; restart for a fresh view.'},
 notice:'Literal source matches only; scores measure field-weighted matching, not factual confidence. Finder and AI are independent.'};
}
