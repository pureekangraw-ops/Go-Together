import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

export function assertCurrentRouting(config) {
  assert.equal(config.name, 'go-together', 'wrong Worker target');
  assert.equal(config.main, 'worker/hub-entry.mjs', 'Hub entrypoint required');
  const expected = new Map([
    ['FACTORY_DIRECT', ['factory-district', '']],
    ['OBSERVATORY_GO', ['observatory-shared-browser', 'ObservatoryGoBridge']],
    ['GOVIEW_GO', ['goview-package-bridge', 'GoviewGoBridge']],
    ['HUB_V2', ['ygg-connection-hub-v2', 'HubBridge']]
  ]);
  assert.equal(config.services?.length, expected.size, 'unexpected or duplicate service binding');
  const seen = new Set();
  for (const binding of config.services) {
    assert.ok(!seen.has(binding.binding), 'duplicate binding name');
    seen.add(binding.binding);
    assert.deepEqual([binding.service, binding.entrypoint || ''], expected.get(binding.binding), 'retired or wrong service destination');
  }
  return true;
}

const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
assertCurrentRouting(config);
console.log('GO current routing verified: Hub V2 and three application rails.');
