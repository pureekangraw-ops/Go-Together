// GO-Together Personal Brain — single-owner, explicit Intake
const ORIGIN='https://go-together.pureekangraw.workers.dev';
const RESOURCE=ORIGIN+'/mcp';
const HEAD={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const EDIT=['kind','title','content','status','work_id','evidence_url','outcome','confidence','tags'];
const STAT=['active','needs_review','stale','archived','deleted'];
const CONF=['confirmed','probable','unknown'];
const stamp=()=>new Date().toISOString();
const reply=(o,code=200,h={})=>new Response(JSON.stringify(o),{status:code,headers:{...HEAD,...h}});
const error=(s,m)=>reply({error:m},s);
const id=()=>crypto.randomUUID();
const secret=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function hash(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
class Bad extends Error{constructor(status,message){super(message);this.status=status;}}
function restrict(v,keys){if(!v||typeof v!=='object'||Array.isArray(v))throw new Bad(400,'json_object_required');for(const k of Object.keys(v))if(!keys.includes(k))throw new Bad(400,'unknown_field:'+k);}
function clean(v,create=false){restrict(v,EDIT);if(create&&(!('title'in v)||!('content'in v)))throw new Bad(400,'title_and_content_required');const out={};
for(const [key,x] of Object.entries(v)){
 if(key==='tags'){if(!Array.isArray(x)||x.length>30||x.some(t=>typeof t!=='string'||t.length>80))throw new Bad(400,'invalid_tags');out.tags=JSON.stringify([...new Set(x.map(t=>t.trim()).filter(Boolean))]);continue;}
 if(typeof x!=='string')throw new Bad(400,'field_must_be_string:'+key);
 const value=x.trim();if(value.length>(key==='content'?50000:key==='evidence_url'?2000:1000)||((key==='title'||key==='content'||key==='kind')&&!value))throw new Bad(400,'invalid_length:'+key);
 if(key==='title'&&value.length>200)throw new Bad(400,'title_too_long');
 if(key==='kind'&&value.length>80)throw new Bad(400,'kind_too_long');
 if(key==='status'&&!STAT.includes(value))throw new Bad(400,'invalid_status');
 if(key==='confidence'&&!CONF.includes(value))throw new Bad(400,'invalid_confidence');
 if(key==='evidence_url'&&value&&!/^(https?:\/\/|notion:\/\/|user:\/\/)/i.test(value))throw new Bad(400,'invalid_evidence_url');
 out[key]=value;
}
if(create)Object.assign(out,{kind:out.kind||'operational_memory',status:out.status||'active',confidence:out.confidence||'unknown',tags:out.tags||'[]',work_id:out.work_id||'',evidence_url:out.evidence_url||'',outcome:out.outcome||''});
return out;}
const memory=x=>x?{...x,tags:JSON.parse(x.tags||'[]')}:null;
async function one(db,key){return memory(await db.prepare('SELECT * FROM memories WHERE id=?').bind(key).first());}
async function save(db,args){const x=clean(args,true),key=id(),t=stamp();
await db.prepare('INSERT INTO memories (id,kind,title,content,status,work_id,evidence_url,outcome,confidence,tags,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(key,x.kind,x.title,x.content,x.status,x.work_id,x.evidence_url,x.outcome,x.confidence,x.tags,1,t,t).run();
return one(db,key);}
async function edit(db,key,args,version=null){const before=await one(db,key);if(!before)throw new Bad(404,'memory_not_found');if(version!==null&&version!==before.revision)throw new Bad(409,'revision_conflict');
const x=clean(args);if(!Object.keys(x).length)throw new Bad(400,'empty_patch');
const fields=Object.keys(x),values=fields.map(k=>x[k]),sql='UPDATE memories SET '+fields.map(k=>k+'=?').join(',')+',revision=revision+1,updated_at=? WHERE id=? AND revision=?';
const r=await db.prepare(sql).bind(...values,stamp(),key,before.revision).run();
if(r.meta?.changes!==1)throw new Bad(409,'revision_conflict');
return one(db,key);}
async function audit(db,key){if(!(await one(db,key)))throw new Bad(404,'memory_not_found');const r=await db.prepare('SELECT * FROM history WHERE memory_id=? ORDER BY created_at DESC,id DESC LIMIT 500').bind(key).all();return (r.results||[]).map(x=>({id:x.id,action:x.action,created_at:x.created_at,before:x.before_json?JSON.parse(x.before_json):null,after:x.after_json?JSON.parse(x.after_json):null}));}
const sortCols=['updated_at','created_at','title','kind','status'];
async function listing(db,args={}){restrict(args,['kind','status','q','sort','limit']);const clauses=[],params=[];
let status=args.status||'active';if(status!=='all'){if(!STAT.includes(status))throw new Bad(400,'invalid_status');clauses.push('status=?');params.push(status);}
if(args.kind){if(typeof args.kind!=='string')throw new Bad(400,'invalid_kind');clauses.push('kind=?');params.push(args.kind);}
if(args.q){if(typeof args.q!=='string'||args.q.length>200)throw new Bad(400,'invalid_query');clauses.push('(title LIKE ? OR content LIKE ? OR work_id LIKE ? OR tags LIKE ? OR outcome LIKE ?)');params.push(...Array(5).fill('%'+args.q+'%'));}
const col=sortCols.includes(args.sort)?args.sort:'updated_at',max=Math.min(200,Math.max(1,Number(args.limit)||100));
const sql='SELECT * FROM memories'+(clauses.length?' WHERE '+clauses.join(' AND '):'')+' ORDER BY '+col+(col==='title'?' ASC':' DESC')+', id DESC LIMIT ?';
const r=await db.prepare(sql).bind(...params,max).all();return (r.results||[]).map(memory);}
function tokenize(t){const found=new Set(),words=String(t||'').toLowerCase().match(/[\p{L}\p{M}\p{N}_-]+/gu)||[];
for(const w of words){if(w.length>1)found.add(w);if(/[\u0e00-\u0e7f]/.test(w))for(let n=2;n<=4;n++)for(let i=0;i+n<=w.length;i++)found.add(w.slice(i,i+n));}return found;}
async function search(db,query,limit=25){if(typeof query!=='string'||!query.trim()||query.length>200)throw new Bad(400,'invalid_query');const wanted=tokenize(query),r=await db.prepare("SELECT * FROM memories WHERE status IN ('active','needs_review') ORDER BY updated_at DESC LIMIT 2000").all(),hits=[];
if(!wanted.size)throw new Bad(400,'invalid_query');
for(const raw of r.results||[]){const x=memory(raw),got=tokenize([x.title,x.title,x.title,x.content,x.work_id,x.outcome,...x.tags].join(' '));let n=0;for(const term of wanted)if(got.has(term))n++;if(n)hits.push({score:Math.round(1000*n/wanted.size)/1000,memory:x});}
hits.sort((a,b)=>b.score-a.score||b.memory.updated_at.localeCompare(a.memory.updated_at));const rows=hits.slice(0,Math.min(50,Math.max(1,Number(limit)||25)));
return {query,method:'lexical-v2',items:rows,count:rows.length,notice:'Lexical matching only; GO interprets the evidence.'};}
async function summary(db,query,limit=10){const r=await search(db,query,Math.min(20,Number(limit)||10));return {type:'source_excerpts_not_ai_summary',query,items:r.items.map(x=>({id:x.memory.id,title:x.memory.title,evidence_url:x.memory.evidence_url,revision:x.memory.revision,excerpt:x.memory.content.slice(0,700)})),count:r.count};}
async function body(req){const txt=await req.text();if(txt.length>1000000)throw new Bad(413,'body_too_large');try{return JSON.parse(txt);}catch{throw new Bad(400,'invalid_json');}}
async function authenticate(req,env){const bearer=/^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization')||'');if(bearer&&bearer[1].length<=512){const r=await env.DB.prepare('SELECT * FROM auth_tokens WHERE token_hash=? AND expires_at>?').bind(await hash(bearer[1]),stamp()).first();if(r&&r.resource===RESOURCE)return {scope:r.scope};}
const c=/\bgt_session=([a-f0-9]{64})\b/.exec(req.headers.get('cookie')||'');if(c){const r=await env.DB.prepare('SELECT token_hash FROM auth_sessions WHERE token_hash=? AND expires_at>?').bind(await hash(c[1]),stamp()).first();if(r)return {scope:'brain:read brain:write'};}return null;}
const challenge=()=>reply({error:'unauthorized'},401,{'www-authenticate':'Bearer resource_metadata="'+ORIGIN+'/.well-known/oauth-protected-resource", scope="brain:read brain:write"'});
async function api(req,env,url){const actor=await authenticate(req,env);if(!actor)return challenge();if(req.method==='GET'&&!actor.scope.split(' ').includes('brain:read'))return error(403,'insufficient_scope');if(req.method!=='GET'&&!actor.scope.split(' ').includes('brain:write'))return error(403,'insufficient_scope');const p=url.pathname,m=req.method,d=env.DB;
if(p==='/api/stats'&&m==='GET'){const r=await d.prepare('SELECT status,COUNT(*) AS n FROM memories GROUP BY status').all();const out=Object.fromEntries(STAT.map(x=>[x,0]));for(const x of r.results||[])out[x.status]=x.n;return reply(out);}
if(p==='/api/retrieve'&&m==='GET')return reply(await search(d,url.searchParams.get('q')||'',url.searchParams.get('limit')||25));
if(p==='/api/summarize'&&m==='GET')return reply(await summary(d,url.searchParams.get('q')||'',url.searchParams.get('limit')||10));
if(p==='/api/memories'){if(m==='GET'){const items=await listing(d,Object.fromEntries(url.searchParams));return reply({items,count:items.length});}if(m==='POST')return reply(await save(d,await body(req)),201);}
const hit=/^\/api\/memories\/([0-9a-f-]{36})(?:\/(history|restore|status))?$/.exec(p);
if(!hit)return error(404,'not_found');const key=hit[1],action=hit[2];
if(m==='GET'&&action==='history')return reply({items:await audit(d,key)});
if(m==='GET'&&!action){const x=await one(d,key);return x?reply(x):error(404,'memory_not_found');}
if(m==='PATCH'&&!action){const args=await body(req),version=args.expected_revision;delete args.expected_revision;if(!Number.isInteger(version))throw new Bad(400,'expected_revision_required');return reply(await edit(d,key,args,version));}
if(m==='DELETE'&&!action){const x=await one(d,key);if(!x)throw new Bad(404,'memory_not_found');return reply({ok:true,item:await edit(d,key,{status:'deleted'},x.revision)});}
if(m==='POST'&&action==='status'){const args=await body(req);restrict(args,['status','expected_revision']);if(!Number.isInteger(args.expected_revision))throw new Bad(400,'expected_revision_required');return reply(await edit(d,key,{status:args.status},args.expected_revision));}
if(m==='POST'&&action==='restore'){const args=await body(req);restrict(args,['expected_revision']);const x=await one(d,key);if(!x)throw new Bad(404,'memory_not_found');return reply(await edit(d,key,{status:'active'},args.expected_revision??x.revision));}
return error(405,'method_not_allowed');}
const SCHEMA=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const type=(s)=>({type:s}),Q=type('string'),N=type('integer');
const fields={kind:Q,title:Q,content:Q,status:Q,work_id:Q,evidence_url:Q,outcome:Q,confidence:Q,tags:{type:'array',items:Q}};
const tools=[
{name:'brain_search',description:'Search memory using lexical evidence matching; no autonomous reasoning.',inputSchema:SCHEMA({query:Q,limit:N},['query'])},
{name:'brain_retrieve',description:'Return an exact memory record by its internal record ID.',inputSchema:SCHEMA({id:Q},['id'])},
{name:'brain_list',description:'Organize and list memories by filters and sort order.',inputSchema:SCHEMA({kind:Q,status:Q,q:Q,sort:Q,limit:N})},
{name:'brain_save',description:'Save exactly supplied memory details. GO makes the decision.',inputSchema:SCHEMA(fields,['title','content'])},
{name:'brain_edit',description:'Change only the specified fields if the expected revision matches.',inputSchema:SCHEMA({id:Q,expected_revision:N,...fields},['id','expected_revision'])},
{name:'brain_set_status',description:'Explicitly archive, delete, restore, or flag a record.',inputSchema:SCHEMA({id:Q,status:Q,expected_revision:N},['id','status','expected_revision'])},
{name:'brain_history',description:'Read an exact record change history with snapshots.',inputSchema:SCHEMA({id:Q},['id'])},
{name:'brain_summarize',description:'Return extractive source-linked excerpts only; GO synthesizes conclusions.',inputSchema:SCHEMA({query:Q,limit:N},['query'])}
];
async function toolCall(name,a,d){if(!a||typeof a!=='object')a={};
if(name==='brain_search'){restrict(a,['query','limit']);return search(d,a.query,a.limit);}
if(name==='brain_retrieve'){restrict(a,['id']);return one(d,a.id);}
if(name==='brain_list')return {items:await listing(d,a)};
if(name==='brain_save')return save(d,a);
if(name==='brain_edit'){restrict(a,['id','expected_revision',...EDIT]);const {id,expected_revision,...patch}=a;if(!Number.isInteger(expected_revision))throw new Bad(400,'expected_revision_required');return edit(d,id,patch,expected_revision);}
if(name==='brain_set_status'){restrict(a,['id','status','expected_revision']);if(!Number.isInteger(a.expected_revision))throw new Bad(400,'expected_revision_required');return edit(d,a.id,{status:a.status},a.expected_revision);}
if(name==='brain_history'){restrict(a,['id']);return {items:await audit(d,a.id)};}
if(name==='brain_summarize'){restrict(a,['query','limit']);return summary(d,a.query,a.limit);}
throw new Bad(404,'unknown_tool');}
const rpc=(id,result)=>reply({jsonrpc:'2.0',id,result});
async function mcp(req,env){const actor=await authenticate(req,env);if(!actor)return challenge();if(req.method!=='POST')return error(405,'method_not_allowed');const x=await body(req);
if(x.method==='notifications/initialized')return new Response(null,{status:202});
if(x.method==='initialize')return rpc(x.id,{protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'go-together',version:'1.0.0'}});
if(x.method==='ping')return rpc(x.id,{});
if(x.method==='tools/list')return rpc(x.id,{tools:tools.map(t=>({...t,securitySchemes:[{type:'oauth2',scopes:['brain:read','brain:write']}]}))});
if(x.method==='tools/call'){const name=x.params?.name,a=x.params?.arguments||{};if(!tools.some(t=>t.name===name))return reply({jsonrpc:'2.0',id:x.id,error:{code:-32601,message:'unknown_tool'}});if(['brain_save','brain_edit','brain_set_status'].includes(name)&&!actor.scope.includes('brain:write'))return error(403,'insufficient_scope');
try{const value=await toolCall(name,a,env.DB);return rpc(x.id,{content:[{type:'text',text:JSON.stringify(value)}]});}catch(e){return rpc(x.id,{content:[{type:'text',text:e.message}],isError:true});}}
return reply({jsonrpc:'2.0',id:x.id,error:{code:-32601,message:'method_not_found'}});}
let accessJwks=null,accessJwksAge=0;
const bytes64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
async function owner(req,env,ctx){
  if(ctx?.access?.aud===env.ACCESS_AUD){try{const person=await ctx.access.getIdentity();if(person?.email)return true;}catch{}}
  const token=req.headers.get('cf-access-jwt-assertion');
  if(!token||!env.ACCESS_AUD||!env.ACCESS_TEAM_DOMAIN)return false;
  const p=token.split('.');if(p.length!==3)return false;
  try{
    const h=JSON.parse(new TextDecoder().decode(bytes64(p[0])));
    const claims=JSON.parse(new TextDecoder().decode(bytes64(p[1])));
    const nowSecs=Math.floor(Date.now()/1000);
    if(h.alg!=='RS256'||!h.kid||claims.iss!=='https://'+env.ACCESS_TEAM_DOMAIN||!([].concat(claims.aud||[]).includes(env.ACCESS_AUD))||!claims.email||!Number.isFinite(claims.exp)||claims.exp<=nowSecs||(claims.nbf&&claims.nbf>nowSecs))return false;
    let jwk=accessJwks?.keys?.find(x=>x.kid===h.kid);
    if(!jwk||Date.now()-accessJwksAge>300000){
      const r=await fetch('https://'+env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs',{redirect:'error'});
      if(!r.ok)return false;
      accessJwks=await r.json();accessJwksAge=Date.now();jwk=accessJwks.keys?.find(x=>x.kid===h.kid);
    }
    if(!jwk)return false;
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes64(p[2]),new TextEncoder().encode(p[0]+'.'+p[1]));
  }catch{return false;}
}
const oauthMeta=()=>({issuer:ORIGIN,authorization_endpoint:ORIGIN+'/auth/authorize',token_endpoint:ORIGIN+'/oauth/token',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],client_id_metadata_document_supported:true,scopes_supported:['brain:read','brain:write'],authorization_response_iss_parameter_supported:true});
async function clientAllowed(client,redirect){if(!/^https:\/\/chatgpt\.com\/oauth\/(?:client\.json|[a-zA-Z0-9_-]+\/client\.json)$/.test(client)||!/^https:\/\/chatgpt\.com\/(?:connector_platform_oauth_redirect|connector\/oauth\/[a-zA-Z0-9_-]+)$/.test(redirect))return false;
try{const r=await fetch(client,{redirect:'error'});if(!r.ok)return false;const v=await r.json();return v.client_id===client&&Array.isArray(v.redirect_uris)&&v.redirect_uris.includes(redirect);}catch{return false;}}
const b64=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
async function authorize(req,env,ctx,url){if(!(await owner(req,env,ctx)))return error(403,'owner_only');const p=url.searchParams,client=p.get('client_id'),redirect=p.get('redirect_uri'),challenge=p.get('code_challenge'),resource=p.get('resource'),scope=p.get('scope')||'brain:read brain:write',state=p.get('state')||'';
if(p.get('response_type')!=='code'||p.get('code_challenge_method')!=='S256'||!challenge||!/^[a-zA-Z0-9_-]{43,128}$/.test(challenge)||resource!==RESOURCE||scope.split(' ').some(s=>!['brain:read','brain:write'].includes(s))||!(await clientAllowed(client,redirect)))return error(400,'invalid_oauth_request');
const c=secret();await env.DB.prepare('INSERT INTO oauth_codes(code_hash,client_id,redirect_uri,resource,code_challenge,scope,expires_at) VALUES(?,?,?,?,?,?,?)').bind(await hash(c),client,redirect,resource,challenge,scope,new Date(Date.now()+120000).toISOString()).run();
const dest=new URL(redirect);dest.searchParams.set('code',c);dest.searchParams.set('state',state);dest.searchParams.set('iss',ORIGIN);return Response.redirect(dest.toString(),302);}
async function token(req,env){const p=new URLSearchParams(await req.text()),grant=p.get('grant_type'),client=p.get('client_id'),resource=p.get('resource');
if(!client||resource!==RESOURCE)return error(400,'invalid_client_or_resource');
if(grant==='authorization_code'){
const code=p.get('code')||'',verifier=p.get('code_verifier')||'',redirect=p.get('redirect_uri')||'';if(!/^[a-zA-Z0-9_.~-]{43,128}$/.test(verifier)||!code)return error(400,'invalid_grant');
const key=await hash(code),row=await env.DB.prepare('SELECT * FROM oauth_codes WHERE code_hash=? AND expires_at>?').bind(key,stamp()).first();if(!row||row.client_id!==client||row.redirect_uri!==redirect||row.resource!==resource)return error(400,'invalid_grant');
const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));if(row.code_challenge!==challenge)return error(400,'invalid_grant');
const access=secret(),refresh=secret();const results=await env.DB.batch([env.DB.prepare('DELETE FROM oauth_codes WHERE code_hash=?').bind(key),env.DB.prepare('INSERT INTO auth_tokens(token_hash,refresh_hash,client_id,resource,scope,expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?,?)').bind(await hash(access),await hash(refresh),client,resource,row.scope,new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+2592000000).toISOString())]);if(results[0].meta?.changes!==1)return error(400,'invalid_grant');
return reply({access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:row.scope});}
if(grant==='refresh_token'){
const old=p.get('refresh_token')||'',key=await hash(old),row=await env.DB.prepare('SELECT * FROM auth_tokens WHERE refresh_hash=? AND refresh_expires_at>?').bind(key,stamp()).first();if(!row||row.client_id!==client||row.resource!==resource)return error(400,'invalid_grant');
const access=secret(),refresh=secret();await env.DB.prepare('UPDATE auth_tokens SET token_hash=?,refresh_hash=?,expires_at=?,refresh_expires_at=? WHERE refresh_hash=?').bind(await hash(access),await hash(refresh),new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+2592000000).toISOString(),key).run();
return reply({access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:row.scope});}
return error(400,'unsupported_grant_type');}
async function login(req,env,ctx){if(!(await owner(req,env,ctx)))return error(403,'owner_only');const c=secret();await env.DB.prepare('INSERT INTO auth_sessions(token_hash,expires_at) VALUES(?,?)').bind(await hash(c),new Date(Date.now()+604800000).toISOString()).run();return new Response(null,{status:303,headers:{location:'/', 'set-cookie':'gt_session='+c+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800','cache-control':'no-store'}});}
async function logout(req,env){const m=/\bgt_session=([0-9a-f]{64})\b/.exec(req.headers.get('cookie')||'');if(m)await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hash(m[1])).run();return new Response(null,{status:303,headers:{location:'/', 'set-cookie':'gt_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'}});}
export default {async fetch(req,env,ctx){try{const url=new URL(req.url),p=url.pathname;
if(p==='/api/health'){const v=await env.DB.prepare('SELECT 1 AS healthy').first();return reply({ok:v?.healthy===1,app:'GO-Together Personal Brain',storage:'Cloudflare D1',binding:'DB',memory_api_enabled:true,authentication:'owner-only'},v?.healthy===1?200:503);}
if(p==='/.well-known/oauth-protected-resource'||p==='/.well-known/oauth-protected-resource/mcp')return reply({resource:RESOURCE,authorization_servers:[ORIGIN],scopes_supported:['brain:read','brain:write']});
if(p==='/.well-known/oauth-authorization-server')return reply(oauthMeta());
if(p==='/auth/login')return login(req,env,ctx);
if(p==='/auth/authorize')return authorize(req,env,ctx,url);
if(p==='/auth/logout'&&req.method==='POST')return logout(req,env);
if(p==='/oauth/token'&&req.method==='POST')return token(req,env);
if(p==='/mcp')return mcp(req,env);
if(p.startsWith('/api/'))return api(req,env,url);
return env.ASSETS.fetch(req);
}catch(e){if(e instanceof Bad)return error(e.status,e.message);console.error('GO-Together error',e?.name);return error(500,'internal_error');}}};