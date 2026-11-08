import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../plugins/go-together-personal-brain/', import.meta.url);
const readJson = async relativePath => JSON.parse(await readFile(new URL(relativePath, root), 'utf8'));
const endpoint = 'https://go-together.pureekangraw.workers.dev/mcp';

test('both plugin manifests declare the same private GO-Together MCP transport', async () => {
  const v1 = await readJson('plugin.json');
  const v2 = await readJson('.codex-plugin/plugin.json');
  assert.equal(v1.name, v2.name);
  assert.equal(v1.version, v2.version);
  assert.equal(v1.mcpServers, './mcp.json');
  assert.equal(v2.mcpServers, './.mcp.json');

  const v1Transport = await readJson('mcp.json');
  const v2Transport = await readJson('.mcp.json');
  for (const transport of [v1Transport, v2Transport]) {
    const server = transport.mcpServers.go_together;
    assert.equal(server.type, 'streamable-http');
    assert.equal(server.url, endpoint);
    const auth = server.extensions['com.openai'].auth;
    assert.equal(auth.type, 'oauth');
    assert.equal(auth.client.mode, 'cimd');
    assert.equal(auth.resource, endpoint);
    assert.deepEqual(auth.defaultScopes, []);
  }
});
