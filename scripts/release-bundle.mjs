// Release payloads deliberately contain no infrastructure config or credentials.
// Recovery republishes these verified bytes using the runner's reviewed CURRENT config.
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,existsSync,readdirSync,readFileSync,lstatSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const MAX_BYTES=16*1024*1024,MAX_FILES=256;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(code);};
const validPath=p=>typeof p==='string'&&/^(?:go\/runtime\.js|hub\/runtime\.js|go\/static\/[A-Za-z0-9_/-][A-Za-z0-9_./-]*)$/.test(p)&&!p.split('/').some(s=>!s||s==='.'||s==='..'||s.startsWith('.'))&&!/(?:^|\/)(?:wrangler\.[^/]*|package\.json)$/i.test(p);
function validateObject(v){
 if(!v||Object.keys(v).some(k=>!['format','controllerAbi','releaseId','sources','files'].includes(k))||v.format!=='go-hub-bundle-v1'||![0,2].includes(v.controllerAbi)||!/^[-a-z0-9]{1,60}$/.test(v.releaseId||'')||!v.sources||Object.keys(v.sources).sort().join(',')!=='go,hub'||!Object.values(v.sources).every(s=>/^[a-f0-9]{40}$/.test(s))||!Array.isArray(v.files)||!v.files.length||v.files.length>MAX_FILES)fail('BUNDLE_MANIFEST_INVALID');
 const seen=new Set();let total=0;const files=new Map();
 for(const f of v.files){
  if(!f||Object.keys(f).sort().join(',')!=='content,path,sha256'||!validPath(f.path)||seen.has(f.path))fail('BUNDLE_PATH_INVALID');seen.add(f.path);
  if(typeof f.content!=='string'||f.content.length>MAX_BYTES*2)fail('BUNDLE_CONTENT_INVALID');
  const bytes=Buffer.from(f.content,'base64');total+=bytes.length;
  if(bytes.toString('base64')!==f.content||sha256(bytes)!==f.sha256)fail('BUNDLE_FILE_DIGEST_MISMATCH');
  if(total>MAX_BYTES)fail('BUNDLE_TOO_LARGE');files.set(f.path,bytes);
 }
 for(const p of ['go/runtime.js','hub/runtime.js','go/static/index.html','go/static/manifest.webmanifest','go/static/service-worker.js','go/static/_headers'])if(!files.has(p))fail('BUNDLE_FILE_MISSING');
 const go=files.get('go/runtime.js').toString(),hub=files.get('hub/runtime.js').toString();
 if(v.controllerAbi===2&&(!['release_control','releaseControl','ciAcceptance'].every(x=>go.includes(x))||!['releaseControl','ciAcceptance','loadReleaseManifest'].every(x=>hub.includes(x))))fail('BUNDLE_CONTROL_ABI_MISSING');
 return v;
}
export function createBundle({releaseId,goSha,hubSha,files,controllerAbi=2}){
 const v={format:'go-hub-bundle-v1',controllerAbi,releaseId,sources:{go:goSha,hub:hubSha},files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([path,data])=>{const bytes=Buffer.from(data);return {path,sha256:sha256(bytes),content:bytes.toString('base64')};})};
 validateObject(v);const bytes=Buffer.from(JSON.stringify(v));if(bytes.length>MAX_BYTES*2)fail('BUNDLE_TOO_LARGE');return {bytes,sha256:sha256(bytes)};
}
export function validateBundle(bytes,expectedDigest){
 if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
 if(bytes.length>MAX_BYTES*2)fail('BUNDLE_TOO_LARGE');
 if(!/^[a-f0-9]{64}$/.test(expectedDigest||'')||sha256(bytes)!==expectedDigest)fail('BUNDLE_DIGEST_MISMATCH');
 let v;try{v=JSON.parse(bytes);}catch{fail('BUNDLE_JSON_INVALID');}return validateObject(v);
}
export function materializeBundle(bytes,expectedDigest,configs,root){
 const v=validateBundle(bytes,expectedDigest);root=resolve(root);
 // Use a fresh directory so a previous job cannot substitute a symlink or stale file.
 if(existsSync(root)&&(lstatSync(root).isSymbolicLink()||readdirSync(root).length))fail('BUNDLE_OUTPUT_NOT_EMPTY');mkdirSync(root,{recursive:true});
 for(const file of v.files){const target=join(root,file.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,Buffer.from(file.content,'base64'),{flag:'wx',mode:0o600});}
 const result={manifest:v};
 for(const [kind,name] of [['go','go-together'],['hub','ygg-connection-hub-v2']]){
  const current=configs[kind];if(current?.name!==name||current.migrations?.length)fail('INFRASTRUCTURE_CONFIG_INVALID');
  const config={...current,name,main:join(root,kind,'runtime.js'),no_bundle:true};
  if(kind==='go'){if(current.assets?.binding!=='ASSETS')fail('INFRASTRUCTURE_ASSETS_INVALID');config.assets={...current.assets,directory:join(root,'go/static')};}
  const configPath=join(root,kind,'wrangler.json');writeFileSync(configPath,JSON.stringify(config,null,2)+'\n',{flag:'wx'});result[kind]={config:configPath,sourceSha:v.sources[kind]};
 }
 return result;
}
function collectStatic(root,prefix='',out={}){
 for(const name of readdirSync(root).sort()){const file=join(root,name),p=prefix?prefix+'/'+name:name;const st=lstatSync(file);if(st.isSymbolicLink())fail('BUNDLE_SYMLINK_REFUSED');if(st.isDirectory())collectStatic(file,p,out);else if(st.isFile())out['go/static/'+p]=readFileSync(file);else fail('BUNDLE_FILE_TYPE_INVALID');}return out;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  const [goRuntime,hubRuntime,staticDir,output]=process.argv.slice(2);if(!output)fail('BUNDLE_BUILD_ARGUMENTS_REQUIRED');
  const controllerAbi=process.env.RELEASE_ACTION==='prepare'&&JSON.parse(readFileSync('.github/release-manifest.json','utf8')).bootstrap===true?0:2;
  const b=createBundle({controllerAbi,releaseId:process.env.RELEASE_ID,goSha:process.env.RELEASE_GO_SHA,hubSha:process.env.RELEASE_HUB_SHA,files:{'go/runtime.js':readFileSync(goRuntime),'hub/runtime.js':readFileSync(hubRuntime),...collectStatic(staticDir)}});
  writeFileSync(output,b.bytes);writeFileSync(output+'.sha256',b.sha256+'\n');console.log('RELEASE_BUNDLE_SHA256 '+b.sha256);
 }catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'BUNDLE_BUILD_FAILED');process.exitCode=1;}
}
