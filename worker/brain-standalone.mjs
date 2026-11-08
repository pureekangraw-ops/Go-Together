// Standalone GO-Together Personal Brain MCP.
// A single Worker + D1; no Factory, Hub, or Observatory bindings are needed.
// Keep the authenticated brain methods in the existing worker implementation.
import brainWorker from './index.js';

const ALLOWED = new Set([
  'brain_search', 'brain_retrieve', 'brain_list', 'brain_save',
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
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(
        'GO-Together Personal Brain MCP. Health: /api/health. OAuth-protected endpoint: /mcp.',
        { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } },
      );
    }
    // The standalone deployment has no owner-protected dashboard/Access application.
    // Do not expose legacy Factory routes or memory REST APIs without owner auth.
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') {
      return json({ error: 'route_not_available_on_brain_only_worker' }, 404);
    }
    if (url.pathname === '/mcp' && request.method === 'POST') {
      let rpcRequest = null;
      try { rpcRequest = await request.clone().json(); } catch { /* original handler will validate */ }
      if (rpcRequest?.method === 'tools/call' && !ALLOWED.has(rpcRequest.params?.name)) {
        return json({ jsonrpc: '2.0', id: rpcRequest.id ?? null, error: { code: -32601, message: 'unknown_tool' } }, 200);
      }
      const response = await brainWorker.fetch(request, env, ctx);
      if (rpcRequest?.method !== 'tools/list' || !response.ok) return response;
      const payload = await response.json();
      if (Array.isArray(payload?.result?.tools)) {
        payload.result.tools = payload.result.tools.filter(tool => ALLOWED.has(tool.name));
      }
      return json(payload, response.status);
    }
    // OAuth endpoints stay in the original owner-only Direct CIMD implementation.
    if (url.pathname.startsWith('/oauth/') || url.pathname.startsWith('/.well-known/oauth-')) {
      return brainWorker.fetch(request, env, ctx);
    }
    return json({ error: 'not_found' }, 404);
  },
};
