import test from 'node:test';import assert from 'node:assert/strict';
const id='11111111-1111-4111-8111-111111111111',version='22222222-2222-4222-8222-222222222222';
const load=()=>import('../worker/release-ci.mjs');
test('GO CI reader refuses unsigned tokens without reading owner data',async()=>{let reads=0;const {goCiAcceptance}=await load();await assert.rejects(()=>goCiAcceptance({authorization:'Bearer aaa.bbb.ccc',body:{requestId:id,goVersion:version,phase:'go'}},{},{readDashboard:async()=>reads++}),/RELEASE_CI_UNAUTHORIZED/);assert.equal(reads,0);});
test('signed production-job OIDC can verify GO before Hub controller is installed',async()=>{
 const {goCiAcceptance}=await load();const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='test';
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
 const claims={iss:'https://token.actions.githubusercontent.com',sub:'repo:pureekangraw-ops/Go-Together:environment:go-production',aud:'go-release:'+id,repository:'pureekangraw-ops/Go-Together',repository_id:'1411826899',ref:'refs/heads/main',event_name:'workflow_dispatch',workflow_ref:'pureekangraw-ops/Go-Together/.github/workflows/go-manual-assets-deploy.yml@refs/heads/main',run_id:'42',run_attempt:'1',iat:now,exp:now+120};
 const unsigned=enc({alg:'RS256',kid:'test'})+'.'+enc(claims);const signature=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(unsigned))).toString('base64url');const authorization='Bearer '+unsigned+'.'+signature;
 const deps={fetcher:async url=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');return Response.json({keys:[jwk]});},readDashboard:async()=>({version:{id:version},factory:{approvals:[{id:'187e2e08-52f6-4cf6-afec-5baa663446d1',status:'PENDING'}]}})};
 const r=await goCiAcceptance({authorization,body:{requestId:id,goVersion:version,phase:'go'}},{},deps);assert.equal(r.goReadback,'VERIFIED');assert.equal(r.privateRpc,'NOT_RUN');
 await assert.rejects(()=>goCiAcceptance({authorization,body:{requestId:id,goVersion:version,phase:'final'}},{},deps),/RELEASE_CI_NOT_INSTALLED/);
 await assert.rejects(()=>goCiAcceptance({authorization,body:{requestId:'33333333-3333-4333-8333-333333333333',goVersion:version,phase:'go'}},{},deps),/RELEASE_CI_UNAUTHORIZED/);
});
test('staging OIDC is limited to the dedicated PR branch and workflow',async()=>{
 const {goCiAcceptance}=await load();const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='test-staging';
 const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
 const claims={iss:'https://token.actions.githubusercontent.com',sub:'repo:pureekangraw-ops/Go-Together:ref:refs/heads/fix/recovery-guard-tests-20261030',aud:'go-release-staging:'+id,repository:'pureekangraw-ops/Go-Together',repository_id:'1411826899',ref:'refs/heads/fix/recovery-guard-tests-20261030',event_name:'push',workflow_ref:'pureekangraw-ops/Go-Together/.github/workflows/recovery-staging-acceptance.yml@refs/heads/fix/recovery-guard-tests-20261030',run_id:'43',run_attempt:'1',iat:now,exp:now+120};
 const token=async p=>{const unsigned=enc({alg:'RS256',kid:'test-staging'})+'.'+enc(p);const signature=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(unsigned))).toString('base64url');return 'Bearer '+unsigned+'.'+signature;};
 const deps={fetcher:async url=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');return Response.json({keys:[jwk]});},readDashboard:async()=>({version:{id:version},factory:{approvals:[{id:'187e2e08-52f6-4cf6-afec-5baa663446d1',status:'PENDING'}]}})};
 const authorization=await token(claims);const r=await goCiAcceptance({authorization,body:{requestId:id,goVersion:version,phase:'go'}},{RELEASE_CI_MODE:'staging'},deps);assert.equal(r.goReadback,'VERIFIED');
 await assert.rejects(()=>goCiAcceptance({authorization,body:{requestId:id,goVersion:version,phase:'go'}},{},deps),/RELEASE_CI_UNAUTHORIZED/);
 await assert.rejects(async()=>goCiAcceptance({authorization:await token({...claims,ref:'refs/heads/main'}),body:{requestId:id,goVersion:version,phase:'go'}},{RELEASE_CI_MODE:'staging'},deps),/RELEASE_CI_UNAUTHORIZED/);
});
