// GO Brain librarian: bounded, read-only reference health checking.
// This verifies HTTP reachability, NOT permission to open a private document,
// the content of a file, or the freshness of its revision.
const HOSTS=new Set([
 'github.com','raw.githubusercontent.com','gist.github.com',
 'gitlab.com','drive.google.com','docs.google.com','colab.research.google.com',
 'notion.so','www.notion.so','app.notion.com','figma.com','www.figma.com'
]);
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_PARAM=/(?:^|[_-])(token|secret|api[_-]?key|password|signature|credential|authorization|auth)(?:$|[_-])/i;
function approvedHost(host){
 return HOSTS.has(host)||(/^[a-z0-9-]+\.slack\.com$/.test(host));
}
function normalizedRef(value){
 if(typeof value!=='string'||!value.trim())return {reason:'NO_REFERENCE'};
 if(value.length>2000)return {reason:'INVALID_REFERENCE'};
 let u;
 try{u=new URL(value);}catch{return {reason:'INVALID_REFERENCE'};}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!approvedHost(u.hostname.toLowerCase()))return {reason:'UNSUPPORTED_OR_UNSAFE_URL'};
 if([...u.searchParams.keys()].some(k=>SECRET_PARAM.test(k)))return {reason:'SENSITIVE_QUERY_NOT_PROBED'};
 u.hash=''; // Never submit fragments; they do not identify the network resource.
 return {url:u.toString(),host:u.hostname.toLowerCase()};
}
function classify(status){
 if(status>=200&&status<=299)return 'HTTP_REACHABLE_NOT_CONTENT_VERIFIED';
 if(status>=300&&status<=399)return 'REDIRECT_NOT_VERIFIED';
 if(status===401||status===403)return 'AUTH_REQUIRED_OR_BLOCKED';
 if(status===404)return 'NOT_FOUND_OR_PRIVATE';
 if(status===410)return 'GONE_REPORTED';
 if(status===429)return 'RATE_LIMITED';
 if(status>=500)return 'UPSTREAM_UNAVAILABLE';
 return 'HTTP_UNCERTAIN';
}
function safeLocationHost(base,location){
 if(typeof location!=='string'||!location)return null;
 try{const u=new URL(location,base);return u.protocol==='https:'?u.hostname.toLowerCase():null;}catch{return null;}
}
export async function probeStoredReference(record,{fetchImpl=fetch,now=()=>new Date().toISOString(),timeoutMs=4000}={}){
 const checked_at=now();
 const base={
  record_id:record?.id||null,record_revision:record?.revision??null,
  title:typeof record?.title==='string'?record.title.slice(0,200):null,
  checked_at,read_only:true,link_host:null,http_status:null,method:null,
  redirected_to_host:null,status:null,
  content_verified:false,provider_authorization_verified:false
 };
 if(!record)return {...base,status:'RECORD_NOT_FOUND'};
 if(record.status==='deleted'||record.status==='archived')return {...base,status:'INACTIVE_RECORD'};
 const parsed=normalizedRef(record.evidence_url);
 if(!parsed.url)return {...base,status:parsed.reason};
 base.link_host=parsed.host;
 // No cookies, bearer token, credentials, redirect following, or response bodies.
 async function request(method){
  const headers=method==='GET'?{'Range':'bytes=0-0'}:{};
  return fetchImpl(parsed.url,{method,headers,redirect:'manual',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(timeoutMs)});
 }
 try{
  let result=await request('HEAD'),method='HEAD';
  if(result.status===405||result.status===501){
   try{await result.body?.cancel();}catch{}
   result=await request('GET');method='GET';
  }
  const out={
   ...base,method,http_status:result.status,status:classify(result.status),
   redirected_to_host:result.status>=300&&result.status<=399?
    safeLocationHost(parsed.url,result.headers?.get?.('location')):null
  };
  try{await result.body?.cancel();}catch{}
  return out;
 }catch{
  return {...base,method:'HEAD_OR_GET',status:'NETWORK_UNVERIFIED'};
 }
}
export async function checkReferenceById(db,id,options={}){
 if(typeof id!=='string'||!ID.test(id))throw new RangeError('invalid_record_id');
 const r=await db.prepare('SELECT id,title,revision,status,evidence_url FROM memories WHERE id=?').bind(id).first();
 return {type:'go_brain_reference_health_v1',result:await probeStoredReference(r,options),
  notice:'HTTP status is not proof a private document is readable, current or even present. For restricted Google Drive/Notion/GitHub files, verify using the authorized provider connector. No records were changed.'};
}
export async function auditReferences(db,limit=3,options={}){
 if(!Number.isInteger(limit)||limit<1||limit>5)throw new RangeError('invalid_audit_limit');
 const d=await db.prepare("SELECT id,title,revision,status,evidence_url FROM memories WHERE status IN ('active','needs_review') AND evidence_url <> '' ORDER BY updated_at DESC LIMIT ?").bind(limit).all();
 const items=Array.isArray(d.results)?d.results:[];
 // Two requests at a time; no background scans, no scheduler, no mass crawler.
 const result=[];
 for(let i=0;i<items.length;i+=2){
  result.push(...await Promise.all(items.slice(i,i+2).map(item=>probeStoredReference(item,options))));
 }
 return {type:'go_brain_reference_audit_v1',checked:result.length,max_checked:limit,results:result,
  notice:'Read-only spot-check of recent stored reference URLs, not an exhaustive audit. Access to private content and document revision are unverified.'};
}
