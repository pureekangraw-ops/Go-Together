import {REPOSITORY_JOB_SCHEMA} from './repository-job-contract.mjs';
const shape=(p={},r=[])=>({type:'object',properties:p,required:r,additionalProperties:false});
const str=(max=300)=>({type:'string',minLength:1,maxLength:max});
const writable=(name,description,p,r)=>({name,description:description+' Reuse requestId to inspect an uncertain delivery; use a new ID only for a new intended operation.',inputSchema:shape({...p,requestId:str(120)},[...r,'requestId']),annotations:{readOnlyHint:false,destructiveHint:false}});
export const PROVIDER_WRITES={
 github:[
  {name:'github_code_job_dispatch',description:'Dispatch the existing Factory repository workflow once after owner approval. No merge or deploy.',inputSchema:shape({requestId:{type:'string',format:'uuid'},...REPOSITORY_JOB_SCHEMA.properties},['requestId','baseSha','files']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'github_code_job_readback',description:'Read the correlated Factory workflow and independently verify every submitted file. Never dispatches.',inputSchema:shape({requestId:{type:'string',format:'uuid'},...REPOSITORY_JOB_SCHEMA.properties},['requestId','baseSha','files']),annotations:{readOnlyHint:true,destructiveHint:false}},

  writable('github_branch','Create a work branch from a pinned commit; does not modify main.',{repo:str(),branch:str(120),from_sha:{type:'string',pattern:'^[0-9a-fA-F]{40}$'}},['repo','branch','from_sha']),
  writable('github_put_file','Create or replace a UTF-8 file on a non-default work branch, with SHA for existing files.',{repo:str(),branch:str(120),path:str(300),content:str(65536),message:str(300),sha:{type:'string',pattern:'^[0-9a-fA-F]{40}$'}},['repo','branch','path','content','message']),
  writable('github_open_pr','Open a PR from a work branch; does not merge.',{repo:str(),head:str(120),base:str(120),title:str(200),body:{type:'string',maxLength:4000}},['repo','head','base','title'])
 ],
 notion:[
  writable('notion_create_page','Create a page under an existing shared parent page.',{parent_page_id:str(),title:str(200)},['parent_page_id','title']),
  writable('notion_append_paragraph','Append one paragraph to an existing shared page/block.',{block_id:str(),text:str(2000)},['block_id','text']),
  writable('notion_update_page_title','Update the title of an existing shared page.',{page_id:str(),title:str(200)},['page_id','title'])
 ],
 google:[
  {name:'google_files',description:'List files in the connected Google Drive.',inputSchema:shape({page_size:{type:'integer',minimum:1,maximum:100},page_token:str(1000)}),annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'google_document',description:'Read one Google Docs document.',inputSchema:shape({document_id:str(150)},['document_id']),annotations:{readOnlyHint:true,destructiveHint:false}},
  writable('google_create_document','Create a Google Docs file optionally in one owner-selected folder.',{name:str(200),parent_id:str(150)},['name']),
  writable('google_append_text','Append text to an existing Google Docs document.',{document_id:str(150),text:str(5000)},['document_id','text'])
 ],
 gitlab:[
  {name:'gitlab_status',description:'Verify GitLab provider identity.',inputSchema:shape(),annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'gitlab_project',description:'Read GitLab project metadata.',inputSchema:shape({project:str(300)},['project']),annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'gitlab_file',description:'Read a GitLab file and last commit ID before editing it.',inputSchema:shape({project:str(300),path:str(300),ref:str(120)},['project','path','ref']),annotations:{readOnlyHint:true,destructiveHint:false}},
  writable('gitlab_branch','Create a GitLab work branch.',{project:str(300),branch:str(120),ref:str(120)},['project','branch','ref']),
  writable('gitlab_put_file','Create or update a text file on a GitLab work branch. Updates require last_commit_id from file readback.',{project:str(300),branch:str(120),path:str(300),content:str(65536),message:str(300),update:{type:'boolean'},last_commit_id:{type:'string',pattern:'^[0-9a-fA-F]{40}$'}},['project','branch','path','content','message','update']),
  writable('gitlab_open_mr','Open merge request; does not merge.',{project:str(300),source_branch:str(120),target_branch:str(120),title:str(200)},['project','source_branch','target_branch','title'])
 ],
 slack:[
  {name:'slack_status',description:'Verify Slack API identity.',inputSchema:shape(),annotations:{readOnlyHint:true,destructiveHint:false}},
  {name:'slack_history',description:'Read a bounded page of messages for one explicit channel.',inputSchema:shape({channel:str(100),limit:{type:'integer',minimum:1,maximum:100},cursor:str(1000)},['channel']),annotations:{readOnlyHint:true,destructiveHint:false}},
  writable('slack_update_message','Edit an existing message owned by the connected Slack identity.',{channel:str(100),ts:{type:'string',pattern:'^[0-9]+[.][0-9]+$'},text:str(3500)},['channel','ts','text']),
  writable('slack_post_message','Post a message to one explicit channel.',{channel:str(100),text:str(3500)},['channel','text'])
 ],
 storage:[
  {name:'storage_upload',description:'Upload a Product file or create a new immutable version after Hub Owner approval. Does not accept Environment files through AI.',inputSchema:shape({storageClass:{const:'PRODUCT'},project:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'},filename:str(180),displayName:str(200),description:{type:'string',maxLength:2000},category:{type:'string',maxLength:80},contentType:str(120),contentBase64:{type:'string',minLength:1,maxLength:180000},fileId:{type:'string',format:'uuid'},requestId:{type:'string',format:'uuid'}},['storageClass','project','filename','contentType','contentBase64','requestId']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'storage_update_metadata',description:'Update file metadata or archive a file after Hub Owner approval; never deletes or moves the R2 object.',inputSchema:shape({fileId:{type:'string',format:'uuid'},requestId:{type:'string',format:'uuid'},displayName:{type:'string',maxLength:200},description:{type:'string',maxLength:2000},category:{type:'string',maxLength:80},project:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'},status:{enum:['ACTIVE','ARCHIVED']}},['fileId','requestId']),annotations:{readOnlyHint:false,destructiveHint:false}}
 ]
};

