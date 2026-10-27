// One existing GO-owned Factory CODE receipt -> a reviewable GitHub PR.
// No Factory re-execution, merge, deployment, tokens in arguments, or new worker.
import {factoryDirectReadback,factoryDirectArtifact} from './factory-direct.mjs';
import {hubTool} from './hub-client.mjs';

const SHA40=/^[a-f0-9]{40}$/, SHA256=/^[a-f0-9]{64}$/;
const JOB=/^GOJOB-[a-f0-9]{32}$/;
const REPO=/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const PATH=/^(?:src|scripts|examples|docs)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:js|mjs)$/;
const fail=(reason,phase='PREFLIGHT')=>({ok:false,status:'UNKNOWN',reason,phase,
  delivered:false,merged:false,deployed:false,executed:false});
const sha256=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(v=>v.toString(16).padStart(2,'0')).join('');
function response(result) {
  if(result?.ok!==true||!Number.isInteger(result.upstream_status)||
     result.upstream_status<200||result.upstream_status>=300)return null;
  // Read providers return REST body; Hub V2 GitHub write tools instead
  // return normalized top-level commitSha/contentSha/branch/prNumber/prUrl.
  return result.body&&typeof result.body==='object'?result.body:result;
}
export async function deliverFactoryCodeToGithub(env,input={},deps={}){
 const read=deps.readback||factoryDirectReadback;
 const artifactRead=deps.artifact||factoryDirectArtifact;
 const hub=deps.hub||hubTool;
 const {receiptId,repo,baseSha,filePath,requestId,approved}=input;
 if(approved!==true||!/^receipt-[A-Za-z0-9-]{8,80}$/.test(receiptId||'')||
   !REPO.test(repo||'')||!SHA40.test(baseSha||'')||
   !PATH.test(filePath||'')||filePath.split('/').includes('..')||
   !/^[a-zA-Z0-9_-]{8,72}$/.test(requestId||''))
   return fail('CODE_GITHUB_INPUT_OR_APPROVAL_INVALID');
 let receipt;
 try{receipt=await read(env,{receiptId});}
 catch{return fail('FACTORY_RECEIPT_READ_UNAVAILABLE');}
 if(!receipt?.ok||receipt.verified!==true||receipt.jobStatus!=='COMPLETED'||
    receipt.domain!=='CODE'||receipt.receiptId!==receiptId||
    !JOB.test(receipt.jobId||'')||!SHA40.test(receipt.sourceSha||'')||
    !Array.isArray(receipt.artifactRefs))
   return fail('FACTORY_CODE_RECEIPT_UNVERIFIED');
 if(receipt.jobStamp&&receipt.jobStamp.status!=='PASS')
   return fail('FACTORY_CODE_STAMP_NOT_PASSED');
 const sources=receipt.artifactRefs.filter(x=>typeof x==='string'&&
   x.startsWith('r2://factory/edge-results/')&&x.endsWith('/main.js'));
 if(sources.length!==1)return fail('FACTORY_CODE_SOURCE_AMBIGUOUS');
 const artifactRef=sources[0];
 let file;
 try{file=await artifactRead(env,{receiptId,artifactRef});}
 catch{return fail('FACTORY_CODE_BYTES_UNAVAILABLE');}
 if(!file?.ok||file.receiptId!==receiptId||file.artifactRef!==artifactRef||
    file.mime!=='text/javascript; charset=utf-8'||!SHA256.test(file.sha256||'')||
    !Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>48000||
    typeof file.base64!=='string')
   return fail('FACTORY_CODE_FILE_UNVERIFIED');
 let content;
 try{
   const binary=atob(file.base64.replace(/\s/g,''));
   const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
   if(bytes.length!==file.bytes||await sha256(bytes)!==file.sha256)
     return fail('FACTORY_CODE_BYTES_HASH_MISMATCH');
   content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   if(content.includes('\u0000')||content.length>48000||!content.length)
     return fail('FACTORY_CODE_NOT_UTF8_SOURCE');
 }catch{return fail('FACTORY_CODE_NOT_UTF8_SOURCE');}
 // The work branch is deterministically bound to the verified Factory job.
 // Different request IDs cannot create a second branch for the same job.
 const branch='code/jobs/'+receipt.jobId;
 let metadata;
 try{metadata=response(await hub(env,'github_repo',{repo}));}
 catch{return fail('GITHUB_REPOSITORY_UNAVAILABLE');}
 const base=metadata?.default_branch;
 if(!metadata||metadata.full_name!==repo||!base||base===branch)
   return fail('GITHUB_REPOSITORY_NOT_VERIFIED');
 async function effect(tool,payload,phase){
   try{return response(await hub(env,tool,{...payload,requestId:requestId+'-'+phase}));}
   catch{return null;}
 }
 // Never reuse an uncertain side effect with a new request ID.
 const created=await effect('github_branch',{repo,branch,from_sha:baseSha},'branch');
 if((created?.ref??created?.branch)!=='refs/heads/'+branch||
    (created?.object?.sha??created?.commitSha)!==baseSha)
   return {...fail('GITHUB_BRANCH_UNVERIFIED_NO_REPLAY','BRANCH'),branch};
 const committed=await effect('github_put_file',{
   repo,branch,path:filePath,content,
   message:'code('+receipt.jobId+'): deliver verified Factory CODE output'
 },'commit');
 const commitSha=committed?.commit?.sha??committed?.commitSha;
 const contentSha=committed?.content?.sha??committed?.contentSha;
 if(!SHA40.test(commitSha||'')||!SHA40.test(contentSha||''))
   return {...fail('GITHUB_COMMIT_UNVERIFIED_NO_REPLAY','COMMIT'),branch};
 let saved;
 try{saved=response(await hub(env,'github_file',{repo,path:filePath,ref:branch}));}
 catch{return {...fail('GITHUB_FILE_READBACK_UNAVAILABLE','READBACK'),branch,commitSha};}
 if(saved?.type!=='file'||saved?.sha!==contentSha||
    typeof saved.content!=='string'||saved.encoding!=='base64')
   return {...fail('GITHUB_FILE_READBACK_MISMATCH','READBACK'),branch,commitSha};
 try{
   const bytes=Uint8Array.from(atob(saved.content.replace(/\s/g,'')),c=>c.charCodeAt(0));
   if(await sha256(bytes)!==file.sha256||bytes.length!==file.bytes)
     return {...fail('GITHUB_FILE_BYTES_MISMATCH','READBACK'),branch,commitSha};
 }catch{return {...fail('GITHUB_FILE_BYTES_UNVERIFIED','READBACK'),branch,commitSha};}
 const pr=await effect('github_open_pr',{
   repo,head:branch,base,
   title:'CODE '+receipt.jobId+': '+filePath,
   body:'Factory CODE receipt: '+receiptId+'\nSource SHA: '+receipt.sourceSha+
     '\nArtifact: '+artifactRef+'\nFile SHA-256: '+file.sha256+
     '\nGitHub commit: '+commitSha+
     '\n\nVerified bytes were delivered for review. Not merged or deployed.'
 },'pr');
 const prNumber=pr?.number??pr?.prNumber;
 const prUrl=pr?.html_url??pr?.prUrl;
 const exactUrl='https://github.com/'+repo+'/pull/'+prNumber;
 const richMatches=pr?.head?pr.head.ref===branch&&
   pr.head.sha===commitSha&&pr?.base?.ref===base:true;
 if(!Number.isInteger(prNumber)||prNumber<1||prUrl!==exactUrl||!richMatches)
   return {...fail('GITHUB_PR_UNVERIFIED_NO_REPLAY','PR'),branch,commitSha};
 return {ok:true,status:'PR_OPENED',jobId:receipt.jobId,receiptId,sourceSha:receipt.sourceSha,
   artifactRef,artifactSha256:file.sha256,repo,branch,commitSha,filePath,
   prNumber,prUrl,delivered:true,merged:false,deployed:false,
   applicationAccepted:false};
}
