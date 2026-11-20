import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertDeploymentTarget} from '../scripts/deployment-preflight.mjs';
const config=JSON.parse(readFileSync(new URL('../wrangler.brain.jsonc',import.meta.url),'utf8'));
test('only canonical standalone Brain deployment is accepted',()=>{
 assert.equal(assertDeploymentTarget('brain',config),true);
 for(const mutate of [c=>c.name='other',c=>c.main='worker/hub-entry.mjs',c=>c.vars.BRAIN_AUTH_MODE='DIRECT',c=>c.d1_databases[0].database_id='other',c=>c.services=[{binding:'X',service:'legacy'}],c=>c.d1_databases.push(c.d1_databases[0])]){
  const bad=structuredClone(config);mutate(bad);assert.throws(()=>assertDeploymentTarget('brain',bad));
 }
 assert.throws(()=>assertDeploymentTarget('hub',config),/LEGACY_HUB_DEPLOYMENT_DISABLED/);
});
test('Wrangler always runs preflight for both canonical and retired configuration',()=>{
 for(const [path,mode] of [['wrangler.jsonc','hub'],['wrangler.brain.jsonc','brain']]){
  const c=JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
  assert.equal(c.build?.command,'node scripts/deployment-preflight.mjs '+mode);
 }
});
