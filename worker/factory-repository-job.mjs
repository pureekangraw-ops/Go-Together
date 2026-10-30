import {hubTool} from './hub-client.mjs';
export const FACTORY_REPOSITORY='pureekangraw-ops/Factory-District';
import {validRepositoryJob} from './repository-job-contract.mjs';
export {validRepositoryJob,REPOSITORY_JOB_SCHEMA} from './repository-job-contract.mjs';
const unknown=(requestId,reason)=>({ok:false,status:'UNKNOWN',requestId,reason,executed:false,verified:false,merged:false,deployed:false});
export async function dispatchRepositoryJob(env,{requestId,spec},hub=hubTool){
 if(!validRepositoryJob(spec?.repositoryJob))return unknown(requestId,'REPOSITORY_JOB_INVALID');
 try{
  const result=await hub(env,'github_code_job_dispatch',{requestId,...spec.repositoryJob});
  if(result?.ok!==true||result.status!=='DISPATCH_ACCEPTED'||result.requestId!==requestId)
   return unknown(requestId,'DISPATCH_UNVERIFIED_NO_REPLAY');
  return {ok:true,status:'CODE_REPOSITORY_JOB_ACCEPTED',requestId,jobStatus:'ACCEPTED',executed:false,verified:false,merged:false,deployed:false};
 }catch{return unknown(requestId,'DISPATCH_UNCERTAIN_NO_REPLAY');}
}
export async function readRepositoryJob(env,{requestId,spec},hub=hubTool){
 if(!validRepositoryJob(spec?.repositoryJob))return unknown(requestId,'REPOSITORY_JOB_INVALID');
 try{
  const result=await hub(env,'github_code_job_readback',{requestId,baseSha:spec.repositoryJob.baseSha,files:spec.repositoryJob.files});
  if(result?.requestId!==requestId||result?.repository!==FACTORY_REPOSITORY)return unknown(requestId,'JOB_IDENTITY_MISMATCH');
  return {...result,merged:false,deployed:false,applicationAccepted:false};
 }catch{return unknown(requestId,'READBACK_UNAVAILABLE');}
}
