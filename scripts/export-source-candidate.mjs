// Export a credential-free build. Never deploys, authorizes or changes bindings.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,copyFile} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceSha=git('rev-parse','HEAD'),sourceTree=git('rev-parse','HEAD^{tree}');
if(git('status','--porcelain','--untracked-files=no'))throw Error('SOURCE_TREE_DIRTY');
if(git('ls-files','--others','--exclude-standard','--','worker','static','scripts','wrangler.jsonc'))throw Error('UNTRACKED_BUILD_INPUT');
const rawDir=resolve(process.argv[2]||'dist/raw');
const out=resolve(process.argv[3]||'dist/current-source-candidate');
if(!process.env.GO_BUILD_TOOLCHAIN)throw Error('BUILD_TOOLCHAIN_REQUIRED');
if(out===process.cwd()||out===rawDir)throw Error('UNSAFE_OUTPUT_DIRECTORY');
await mkdir(out,{recursive:true});
if((await readdir(out)).length)throw Error('CANDIDATE_OUTPUT_NOT_EMPTY');
const raw=await readFile(join(rawDir,'hub-entry.js'),'utf8');
if(raw.split('__SOURCE_SHA__').length!==2)throw Error('SOURCE_STAMP_COUNT_INVALID');
const module=raw.replace('__SOURCE_SHA__',sourceSha).replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/,'\n');
await writeFile(join(out,'hub-entry.js'),module);
const config=await readFile('wrangler.jsonc','utf8');
const matches=config.match(/"main"\s*:\s*"worker\/hub-entry\.mjs"/g);
if(matches?.length!==1)throw Error('BUILD_ENTRY_CONFIG_INVALID');
const portable=config.replace(matches[0],'"main": "./hub-entry.js"');
await writeFile(join(out,'wrangler.jsonc'),portable);
const paths=git('ls-files','--','worker','static','scripts','wrangler.jsonc').split('\n').filter(Boolean);
const inputs={};
for(const path of paths){
 inputs[path]=digest(await readFile(path));
 if(path.startsWith('static/')){await mkdir(dirname(join(out,path)),{recursive:true});await copyFile(path,join(out,path));}
}
let toolchain;
if(process.env.GO_BUILD_TOOLCHAIN){
 const tools=resolve(process.env.GO_BUILD_TOOLCHAIN);
 const version=JSON.parse(await readFile(join(tools,'node_modules/wrangler/package.json'),'utf8')).version;
 if(version!=='4.152.0')throw Error('WRANGLER_VERSION_UNREVIEWED');
 await mkdir(join(out,'toolchain'),{recursive:true});
 const lock=await readFile(join(tools,'package-lock.json'));
 await writeFile(join(out,'toolchain/package-lock.json'),lock);
 await copyFile(join(tools,'package.json'),join(out,'toolchain/package.json'));
 toolchain={wrangler:version,node:process.version,lockSha256:digest(lock)};
}
const manifest={schema:'go.source-candidate.v1',sourceSha,sourceTree,
 buildInputBundleSha256:digest(raw),moduleSha256:digest(module),moduleBytes:Buffer.byteLength(module),
 producerConfigSha256:digest(config),portableConfigSha256:digest(portable),sourceFilesSha256:inputs,
 transforms:['stamp one source health placeholder','omit stale source-map comment','portable entry path only'],
 toolchain,productionApproved:false,productionVerified:false,activationPerformed:false};
await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(join(out,'README.md'),`# GO source candidate\n\nExact producer: ${sourceSha}\n\nThis package contains the dry-run module, exact tracked static assets, portable source configuration, toolchain lock and hashes. Only the module entry path is changed in configuration. No grants, credentials, bindings or production authorization were installed. Source health is stamped with the exact producer. Build provenance is not hosted acceptance.\n`);
async function files(dir){const all=[];for(const item of await readdir(dir,{withFileTypes:true})){const path=join(dir,item.name);all.push(...(item.isDirectory()?await files(path):[path]));}return all;}
const sums=[];
for(const path of (await files(out)).sort())sums.push(`${digest(await readFile(path))}  ${relative(out,path)}`);
await writeFile(join(out,'SHA256SUMS.txt'),sums.join('\n')+'\n');
console.log(JSON.stringify({sourceSha,sourceTree,out,moduleSha256:manifest.moduleSha256,moduleBytes:manifest.moduleBytes}));
