// Direct GO readback lets the first GO upgrade be verified before Hub is upgraded.
// GitHub OIDC grants bounded reads only; it never deploys or approves a Factory job.
import {readOwnerDashboard} from './owner-control.mjs';
const issuer='https://token.actions.githubusercontent.com';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const fail=()=>{throw Error('RELEASE_CI_UNAUTHORIZED');};
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function keys(fetcher){
 const r=await fetcher(issuer+'/.well-known/jwks',{redirect:'manual',signal:AbortSignal.timeout(5000)});if(!r.ok)fail();
 const reader=r.body?.getReader();if(!reader)fail();const chunks=[];let total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>262144)fail();chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(total);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function goCiAcceptance({authorization,body}={},env={},deps={}){
 if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['requestId','goVersion','phase','artifact'].includes(k))||!uuid.test(body.requestId||'')||!uuid.test(body.goVersion||'')||!['go','final'].includes(body.phase))fail();
 try{
  const token=authorization?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1];if(!token||token.length>16000)fail();const parts=token.split('.');
  const h=JSON.parse(new TextDecoder().decode(decode(parts[0]))),p=JSON.parse(new TextDecoder().decode(decode(parts[1]))),now=Math.floor(Date.now()/1000);
  if(h.alg!=='RS256'||typeof h.kid!=='string'||h.kid.length>128||p.iss!==issuer||p.aud!=='go-release:'+body.requestId||p.sub!=='repo:pureekangraw-ops/Go-Together:environment:go-production'||!Number.isInteger(p.exp)||!Number.isInteger(p.iat)||p.exp<=now||p.exp>now+600||p.iat<now-300||p.iat>now+30||(p.nbf!==undefined&&(!Number.isInteger(p.nbf)||p.nbf>now+30))||p.repository!=='pureekangraw-ops/Go-Together'||p.repository_id!=='1411826899'||p.ref!=='refs/heads/main'||p.event_name!=='workflow_dispatch'||p.workflow_ref!=='pureekangraw-ops/Go-Together/.github/workflows/go-manual-assets-deploy.yml@refs/heads/main'||p.run_attempt!=='1'||!/^\d+$/.test(p.run_id||''))fail();
  const doc=await keys(deps.fetcher||fetch),matches=doc.keys?.filter(k=>k.kid===h.kid&&k.kty==='RSA');if(matches?.length!==1)fail();
  const key=await crypto.subtle.importKey('jwk',matches[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))fail();
 }catch{fail();}
 const dashboard=await (deps.readDashboard||readOwnerDashboard)(env);
 const pending=dashboard?.factory?.approvals?.find(v=>v.id==='187e2e08-52f6-4cf6-afec-5baa663446d1');
 if(dashboard?.version?.id!==body.goVersion||pending?.status!=='PENDING')throw Error('GO_PRIVATE_ACCEPTANCE_FAILED');
 if(body.artifact){const a=body.artifact;if(Object.keys(a).sort().join(',')!=='assetId,releaseId,sha256'||!Number.isSafeInteger(a.assetId)||a.assetId<=0||!Number.isSafeInteger(a.releaseId)||a.releaseId<=0||!/^[a-f0-9]{64}$/.test(a.sha256||''))fail();}
 if(body.phase==='final'){
  if(!env.HUB_V2?.ciAcceptance)throw Error('RELEASE_CI_NOT_INSTALLED');
  return {...await env.HUB_V2.ciAcceptance({authorization,body}),goReadback:'VERIFIED'};
 }
 return {ok:true,requestId:body.requestId,goVersion:body.goVersion,goReadback:'VERIFIED',pending:'PRESERVED',privateRpc:'NOT_RUN',ownerBrowser:'NOT_VERIFIED'};
}
