import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/brain-standalone.mjs';

const ROOT = 'https://go-together.pureekangraw.workers.dev';
const ISSUER = 'https://pureekangraw.cloudflareaccess.com';
const env = {
  BRAIN_AUTH_MODE: 'ACCESS',
  ACCESS_AUD: 'test-audience',
  ACCESS_TEAM_DOMAIN: 'pureekangraw.cloudflareaccess.com',
  OWNER_EMAIL: 'owner@example.com',
  DB: {prepare: () => ({
    first: async () => ({healthy: 1}),
    bind: () => ({
      first: async () => ({healthy: 1}),
      all: async () => ({results: []}),
    }),
  })},
};
const ownerCtx = {access: {aud: env.ACCESS_AUD, getIdentity: async () => ({email: env.OWNER_EMAIL})}};
const rpc = (method, params = {}, ctx = {}) => worker.fetch(new Request(ROOT + '/mcp', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({jsonrpc: '2.0', id: 123, method, params}),
}), env, ctx);

test('Cloudflare Access is the only OAuth issuer declared by Brain', async () => {
  for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    const r = await worker.fetch(new Request(ROOT + path), env, {});
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.resource, ROOT + '/mcp');
    assert.deepEqual(data.authorization_servers, [ISSUER]);
  }
});

test('native legacy OAuth routes are absent, not silently advertised', async () => {
  for (const path of ['/.well-known/oauth-authorization-server', '/oauth/authorize', '/oauth/token']) {
    const r = await worker.fetch(new Request(ROOT + path), env, {});
    assert.equal(r.status, 404, path);
  }
});

test('only Brain tools are visible in MCP catalog', async () => {
  const r = await rpc('tools/list');
  assert.equal(r.status, 200);
  const names = (await r.json()).result.tools.map(x => x.name);
  assert.ok(names.includes('brain_list'));
  assert.ok(names.every(x => x.startsWith('brain_')));
});

test('unauthorized memory reads are blocked, but Access owner may read', async () => {
  const rejected = await rpc('tools/call', {name:'brain_list',arguments:{}});
  assert.equal(rejected.status, 401);
  const accepted = await rpc('tools/call', {name:'brain_list',arguments:{}}, ownerCtx);
  assert.equal(accepted.status, 200);
  const result = await accepted.json();
  assert.equal(result.result.isError, undefined);
  assert.deepEqual(JSON.parse(result.result.content[0].text), {items: []});
});

test('unbound Factory tool remains inaccessible', async () => {
  const r = await rpc('tools/call', {name:'factory_direct_status',arguments:{}}, ownerCtx);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).error.code, -32601);
});

test('all non-Brain APIs remain unavailable', async () => {
  for (const path of ['/api/memories','/api/factory-approvals','/hub-mcp/factory']) {
    const r = await worker.fetch(new Request(ROOT + path), env, ownerCtx);
    assert.equal(r.status, 404, path);
  }
});
