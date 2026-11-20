// Canonical target verified from Cloudflare metadata on 2026-11-20.
// No provider writes or secret reads. Legacy Hub deployments need a new reviewed target.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
export function assertDeploymentTarget(mode,config){
 if(mode!=='brain')throw Error('LEGACY_HUB_DEPLOYMENT_DISABLED');
 assert.equal(config.name,'go-together','WORKER_TARGET_MISMATCH');
 assert.equal(config.main,'worker/brain-standalone.mjs','ENTRYPOINT_MISMATCH');
 assert.equal(config.vars?.BRAIN_AUTH_MODE,'ACCESS','AUTH_MODE_MISMATCH');
 assert.equal(config.d1_databases?.length,1,'DATABASE_BINDING_MISMATCH');
 assert.equal(config.d1_databases[0].binding,'DB','DATABASE_BINDING_MISMATCH');
 assert.equal(config.d1_databases[0].database_id,'6f68d68b-df46-4c44-8c65-7491a1a2f17b','DATABASE_TARGET_MISMATCH');
 assert.equal(config.services?.length??0,0,'LEGACY_SERVICE_BINDINGS_REFUSED');
 return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const mode=process.argv[2];
 if(mode!=='brain')throw Error('LEGACY_HUB_DEPLOYMENT_DISABLED: use wrangler.brain.jsonc for the current Brain service');
 assertDeploymentTarget(mode,JSON.parse(readFileSync(new URL('../wrangler.brain.jsonc',import.meta.url),'utf8')));
 console.log('Canonical Brain target, ACCESS auth and D1 verified.');
}
