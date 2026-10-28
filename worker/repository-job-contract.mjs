export const REPOSITORY_JOB_SCHEMA={type:'object',additionalProperties:false,required:['baseSha','files'],properties:{
 baseSha:{type:'string',pattern:'^[a-f0-9]{40}$'},files:{type:'array',minItems:1,maxItems:16,items:{type:'object',additionalProperties:false,required:['path','content'],properties:{
 path:{type:'string',maxLength:300},content:{type:'string',maxLength:48000},expectedBlobSha:{type:'string',pattern:'^([a-f0-9]{40})?$'}
 }}}}};
export function validRepositoryJob(job){
 if(!job||typeof job!=='object'||Object.keys(job).some(k=>!['baseSha','files'].includes(k))||
  !/^[a-f0-9]{40}$/.test(job.baseSha||'')||!Array.isArray(job.files)||job.files.length<1||job.files.length>16)return false;
 const paths=new Set();let bytes=0;
 for(const f of job.files){
  if(!f||Object.keys(f).some(k=>!['path','content','expectedBlobSha'].includes(k))||
   typeof f.path!=='string'||f.path.length>300||! /^(src|scripts|test|tests|docs|examples)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(f.path)||
   f.path.split('/').some(p=>p==='.'||p==='..')||paths.has(f.path)||typeof f.content!=='string'||f.content.includes('\0')||
   (f.expectedBlobSha!==undefined&&!/^([a-f0-9]{40})?$/.test(f.expectedBlobSha)))return false;
  const size=new TextEncoder().encode(f.content).length;if(size>48000)return false;bytes+=size;paths.add(f.path);
 }
 return bytes<=48000&&JSON.stringify(job).length<=50000&&![...paths].some(p=>[...paths].some(q=>p.startsWith(q+'/')));
}
