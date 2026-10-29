import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export function assertCurrentRouting(config, runtimeBindings) {
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
  // Validate the actual upload/version API shape too: checking wrangler alone
  // cannot detect a release that drops named entrypoints while copying bindings.
  if (runtimeBindings !== undefined) {
    assert.ok(Array.isArray(runtimeBindings), 'runtime bindings array required');
    const services = runtimeBindings.filter(b => b.type === 'service');
    assert.equal(services.length, expected.size, 'unexpected runtime service bindings');
    const names = new Set();
    for (const binding of services) {
      assert.ok(!names.has(binding.name), 'duplicate runtime service binding');
      names.add(binding.name);
      assert.deepEqual([binding.service, binding.entrypoint || ''], expected.get(binding.name),
        'runtime service destination/entrypoint mismatch: ' + binding.name);
    }
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  // Optional file is {bindings:[...]} from upload metadata or version.resources.
  const runtime = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : undefined;
  assertCurrentRouting(config, runtime === undefined ? undefined : runtime.bindings);
  if (runtime !== undefined) assert.ok(Array.isArray(runtime.bindings), 'runtime bindings array required');
  console.log('GO current routing verified: Hub V2 and three application rails.');
}
