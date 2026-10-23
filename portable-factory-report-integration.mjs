// factory-status-report/v1: explicit host-local connector injection only.
// Capability keys prove callable functions, not host registration or authorization.
export function createFactoryReportIntegration({ reporterFactory, host, connectors, clock } = {}) {
  const schemes = {
    codex_apps: ['mcp__codex_apps__go_brain_pantheon_factory', 'mcp__codex_apps__go_brain_pantheon_tasks'],
    go_brain: ['mcp__GO_Brain__pantheon_factory', 'mcp__GO_Brain__pantheon_tasks']
  };
  if (!Object.hasOwn(schemes, host) || typeof reporterFactory !== 'function' ||
      !connectors || typeof connectors !== 'object' || Array.isArray(connectors) ||
      (clock !== undefined && typeof clock !== 'function')) {
    throw new Error('INVALID_INTEGRATION');
  }
  const names = schemes[host];
  if (names.some(name => !Object.hasOwn(connectors, name) || typeof connectors[name] !== 'function')) {
    throw new Error('CONNECTOR_UNAVAILABLE');
  }
  // These fixed keys are internal reporter labels. No capability lookup/fallback occurs.
  const injected = {
    mcp__codex_apps__go_brain_pantheon_factory: args => connectors[names[0]](args),
    mcp__codex_apps__go_brain_pantheon_tasks: args => connectors[names[1]](args)
  };
  const reporter = reporterFactory(injected, clock);
  return Object.freeze({
    contract: 'factory-status-report/v1',
    host,
    requiredCapabilities: Object.freeze([...names]),
    registeredTool: false,
    report: options => reporter.report(options)
  });
}
