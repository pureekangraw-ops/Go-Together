// GO Brain -> Factory District: owner-only, private Service Binding discovery.
// No PANTHEON intermediary, bearer forwarding, task creation or remote execution.
// A configured-looking key is not proof of matching Factory-side credentials.
export async function factoryDirectStatus(env = {}) {
  const key = env.GO_FACTORY_RAIL_SECRET;
  const keyState = typeof key === 'string' && /^[a-f0-9]{64}$/i.test(key)
    ? 'OWNER_KEY_FORMAT_PRESENT_NOT_VERIFIED'
    : 'PENDING_OWNER_REPLACEMENT';
  const base = {
    route: 'GO_BRAIN_TO_FACTORY_DIRECT',
    transport: 'CLOUDFLARE_PRIVATE_SERVICE_BINDING',
    readOnly: true,
    commandReady: false,
    keyState,
  };
  if (!env.FACTORY_DIRECT || typeof env.FACTORY_DIRECT.fetch !== 'function')
    return {...base, ok: false, status: 'SERVICE_BINDING_NOT_CONFIGURED'};
  try {
    const response = await env.FACTORY_DIRECT.fetch(
      new Request('https://factory-district.internal/health', {method: 'GET'})
    );
    if (!response.ok)
      return {...base, ok: false, status: 'FACTORY_HTTP_ERROR', upstreamStatus: response.status};
    const health = await response.json();
    if (!health || health.service !== 'factory-district' || health.stationId !== 'FACTORY-STATION')
      return {...base, ok: false, status: 'FACTORY_IDENTITY_MISMATCH'};
    const machinery = Object.fromEntries(['CODE', 'VISUAL', 'LOGIC'].map(domain => [
      domain, health.machinery?.[domain]?.status === 'READY' ? 'READY' : 'UNKNOWN'
    ]));
    return {
      ...base, ok: true, status: 'CONNECTED',
      station: 'FACTORY-STATION',
      runtime: health.status === 'READY' ? 'READY' : 'UNKNOWN',
      transportStatus: health.transport?.status === 'READY' ? 'READY' : 'UNKNOWN',
      machinery,
      sourceSha: /^[a-f0-9]{40}$/i.test(health.sourceSha || '') ? health.sourceSha : null,
      note: 'READY only means registered machinery, not a successful job or permission to dispatch.',
    };
  } catch {
    return {...base, ok: false, status: 'DIRECT_FACTORY_UNAVAILABLE'};
  }
}
