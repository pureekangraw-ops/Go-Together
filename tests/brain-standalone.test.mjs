import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/brain-standalone.mjs';

const ROOT = 'https://go-together.pureekangraw.workers.dev';
const env = {
  BRAIN_AUTH_MODE: 'DIRECT',
  OWNER_EMAIL: 'owner@example.com',
  DB: { prepare: () => ({ first: async () => ({ healthy: 1 }) }) },
};
const rpc = (method, params = {}) => worker.fetch(new Request(ROOT + '/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 123, method, params }),
}), env, {});

test('standalone GO Brain health uses its bound D1', async () => {
  const result = await worker.fetch(new Request(ROOT + '/api/health'), env, {});
  assert.equal(result.status, 200);
  assert.equal((await result.json()).storage, 'Cloudflare D1');
});

test('standalone GO Brain does not expose unrelated REST APIs', async () => {
  for (const path of ['/api/memories', '/api/factory-approvals', '/hub-mcp/factory']) {
    const result = await worker.fetch(new Request(ROOT + path), env, {});
    assert.equal(result.status, 404, path);
  }
});

test('MCP lists only GO Brain tools rather than unbound Factory/Hub tools', async () => {
  const result = await rpc('tools/list');
  assert.equal(result.status, 200);
  const tools = (await result.json()).result.tools;
  assert.ok(tools.some(tool => tool.name === 'brain_list'));
  assert.ok(tools.some(tool => tool.name === 'brain_save'));
  assert.ok(tools.every(tool => tool.name.startsWith('brain_')));
});

test('unbound Factory tools cannot be invoked by RPC', async () => {
  const result = await rpc('tools/call', {name:'factory_direct_status',arguments:{}});
  assert.equal(result.status, 200);
  assert.equal((await result.json()).error.code, -32601);
});

test('unauthenticated GO Brain memory tool call stays private', async () => {
  const result = await rpc('tools/call', {name:'brain_list',arguments:{}});
  assert.equal(result.status, 401);
});
