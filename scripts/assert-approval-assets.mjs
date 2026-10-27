// Fail closed if the manual deploy would publish a stale dashboard or wrong Worker target.
// This is a source/preflight check, not proof of a live owner-authenticated session.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const config = JSON.parse(read('wrangler.jsonc'));
const html = read('static/index.html');
const sw = read('static/service-worker.js');
const manifest = JSON.parse(read('static/manifest.webmanifest'));

assert.equal(config.name, 'go-together', 'wrong Worker target');
assert.equal(config.main, 'worker/hub-entry.mjs', 'wrong Worker entrypoint');
assert.equal(config.assets?.directory, './static', 'wrong assets directory');
assert.equal(config.assets?.binding, 'ASSETS', 'assets binding missing or changed');
assert.deepEqual(config.assets?.run_worker_first, [
  '/api/*', '/mcp', '/.well-known/*', '/auth/*', '/oauth/*'
], 'API/auth routing changed');
assert.equal(config.d1_databases?.length, 1, 'unexpected D1 binding count');
assert.equal(config.d1_databases[0].binding, 'DB', 'wrong D1 binding');
assert.equal(config.d1_databases[0].database_name, 'go-together', 'wrong D1 target');
assert.equal(config.d1_databases[0].database_id,
  'b236c05f-e07f-498b-a9d5-ccefe8be5f22', 'D1 database ID changed');
assert.equal(config.services?.length, 4, 'service bindings changed');

for (const marker of [
  'id="factory-approvals"',
  'id="approval-refresh"',
  'id="approval-list"',
  'id="pending-approval-badge"',
  'id="approvals-jump"',
  '/api/factory-approvals',
  'payloadSha256',
  'refreshApprovals()',
  'Approve &amp; run'
]) {
  assert.ok(html.includes(marker), 'approval dashboard missing: ' + marker);
}
assert.ok(html.includes('navigator.serviceWorker.register('), 'PWA registration missing');
assert.ok(sw.includes('event.respondWith(fetch(request))'), 'network-only PWA fetch required');
assert.ok(!sw.includes('caches.open('), 'PWA must not cache owner data');
assert.equal(manifest.start_url, '/', 'PWA start URL changed');
assert.equal(manifest.display, 'standalone', 'PWA display mode changed');

console.log('GO production assets preflight PASS: owner approvals, PWA, static assets and core bindings.');
