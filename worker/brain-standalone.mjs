// GO-Together: Cloudflare Access is the sole OAuth authority for this MCP.
// Do not publish a second OAuth issuer on the Worker origin.
import brainWorker from './index.js';

const ORIGIN = 'https://go-together.pureekangraw.workers.dev';
const ACCESS_ISSUER = 'https://pureekangraw.cloudflareaccess.com';
const ALLOWED = new Set([
  'brain_card', 'brain_search', 'brain_keyword_finder', 'brain_association_status',
  'brain_association_process', 'brain_retrieve', 'brain_list', 'brain_save',
  'brain_edit', 'brain_set_status', 'brain_history', 'brain_summarize',
  'brain_reference_check', 'brain_reference_audit', 'brain_context',
]);
const json = (value, status = 200, headers = {}) => new Response(
  JSON.stringify(value),
  { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } },
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // RFC 9728 public resource metadata must agree with Access's 401 challenge.
    if (request.method === 'GET' &&
        (path === '/.well-known/oauth-protected-resource/mcp' ||
         path === '/.well-known/oauth-protected-resource')) {
      return json({
        resource: ORIGIN + '/mcp',
        authorization_servers: [ACCESS_ISSUER],
        bearer_methods_supported: ['header'],
      });
    }

    // The legacy passcode/CIMD endpoints conflict with Access Managed OAuth.
    if (path.startsWith('/oauth/') ||
        path.startsWith('/.well-known/oauth-authorization-server')) {
      return json({ error: 'not_found' }, 404);
    }

    if (path === '/' && request.method === 'GET') {
      return new Response('GO-Together Brain MCP: Cloudflare Access OAuth at /mcp.', {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (path === '/api/health' && request.method === 'GET') {
      return brainWorker.fetch(request, env, ctx);
    }
    // No legacy owner APIs, Factory, Hub, or other tools in this standalone Brain.
    if (path !== '/mcp' || request.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }

    let rpcRequest = null;
    try { rpcRequest = await request.clone().json(); } catch { /* delegate parsing to MCP */ }
    if (rpcRequest?.method === 'tools/call' && !ALLOWED.has(rpcRequest.params?.name)) {
      return json({ jsonrpc: '2.0', id: rpcRequest.id ?? null, error: { code: -32601, message: 'unknown_tool' } });
    }

    // BRAIN_AUTH_MODE=ACCESS makes the existing handler verify Cloudflare
    // Access's signed JWT and exact owner identity for every memory tool call.
    // No passcode secrets are required or loaded.
    const response = await brainWorker.fetch(request, env, ctx);
    if (rpcRequest?.method !== 'tools/list' || !response.ok) return response;
    const payload = await response.json();
    if (Array.isArray(payload?.result?.tools)) {
      payload.result.tools = payload.result.tools.filter(tool => ALLOWED.has(tool.name));
    }
    return json(payload, response.status);
  },
};
