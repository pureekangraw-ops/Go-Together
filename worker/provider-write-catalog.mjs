const shape=(p={},r=[])=>({type:'object',properties:p,required:r,additionalProperties:false});
const str=(max=300)=>({type:'string',minLength:1,maxLength:max});
const writable=(name,description,p,r)=>({name,description,inputSchema:shape(p,r),annotations:{readOnlyHint:false,destructiveHint:false}});
export const PROVIDER_WRITES={
 github:[
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
  writable('gitlab_branch','Create a GitLab work branch.',{project:str(300),branch:str(120),ref:str(120)},['project','branch','ref']),
  writable('gitlab_put_file','Create or update a text file on a GitLab work branch.',{project:str(300),branch:str(120),path:str(300),content:str(65536),message:str(300),update:{type:'boolean'}},['project','branch','path','content','message','update']),
  writable('gitlab_open_mr','Open merge request; does not merge.',{project:str(300),source_branch:str(120),target_branch:str(120),title:str(200)},['project','source_branch','target_branch','title'])
 ],
 slack:[
  {name:'slack_status',description:'Verify Slack API identity.',inputSchema:shape(),annotations:{readOnlyHint:true,destructiveHint:false}},
  writable('slack_post_message','Post a message to one explicit channel.',{channel:str(100),text:str(3500)},['channel','text'])
 ]
};
