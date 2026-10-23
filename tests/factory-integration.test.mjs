import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createFactoryReport } from '../portable-factory-report.mjs';
import { createFactoryReportIntegration } from '../portable-factory-report-integration.mjs';
const id = 'task_' + 'a'.repeat(32); // Synthetic offline fixture only.
const now = Date.parse('2026-10-23T09:00:00.000Z');
const schemes = {
  codex_apps: ['mcp__codex_apps__go_brain_pantheon_factory', 'mcp__codex_apps__go_brain_pantheon_tasks'],
  go_brain: ['mcp__GO_Brain__pantheon_factory', 'mcp__GO_Brain__pantheon_tasks']
};
for (const [host, [factory, tasks]] of Object.entries(schemes)) {
  test(host + ': dry-run then two deliberate invocations use only selected local capabilities', async () => {
    const calls = [];
    const connectors = {
      [factory]: async args => {
        calls.push([factory, args]);
        return args.task_id ? {job: {task_id:id,status:'QUEUED',task_status:'QUEUED',updated_at:new Date(now).toISOString()}} :
          {factory:{connection:'CONNECTED',machinery:{}}};
      },
      [tasks]: async args => {calls.push([tasks,args]);return {task:{task_id:id,status:'QUEUED'}};}
    };
    const otherHost = host === 'codex_apps' ? 'go_brain' : 'codex_apps';
    for (const name of schemes[otherHost]) connectors[name] = () => assert.fail('Cross-host fallback');
    const integration = createFactoryReportIntegration({reporterFactory:createFactoryReport,host,connectors,clock:()=>now});
    assert.equal(integration.contract,'factory-status-report/v1');assert.equal(integration.registeredTool,false);
    assert.equal((await integration.report({taskIds:[id]})).status,'DRY_RUN');assert.equal(calls.length,0);
    for (let i=0;i<2;i++) assert.equal((await integration.report({taskIds:[id],execute:true})).status,'REPORT_READ_COMPLETED');
    assert.deepEqual(calls,[[factory,{}],[tasks,{task_id:id}],[factory,{task_id:id}],[factory,{}],[tasks,{task_id:id}],[factory,{task_id:id}]]);
  });
  test(host + ': missing capability fails closed even if alternate names exist', () => {
    let calls=0;const connectors=Object.fromEntries(Object.values(schemes).flat().map(name=>[name,()=>calls++]));
    delete connectors[tasks];
    assert.throws(()=>createFactoryReportIntegration({reporterFactory:createFactoryReport,host,connectors}),/CONNECTOR_UNAVAILABLE/);
    assert.equal(calls,0);
  });
  test(host + ': host auth refusal stops invocation; alternate aliases never called', async () => {
    let calls=0;const connectors=Object.fromEntries(Object.values(schemes).flat().map(name=>[name,()=>assert.fail('Alternate or later read')]));
    connectors[factory]=async()=>{calls++;throw Object.assign(new Error('offline denial'),{statusCode:403});};
    const integration=createFactoryReportIntegration({reporterFactory:createFactoryReport,host,connectors,clock:()=>now});
    const result=await integration.report({taskIds:[id],execute:true});
    assert.equal(calls,1);assert.equal(result.evidence[0].status,'AUTH_REFUSED');assert.ok(result.evidence.slice(1).every(e=>!e.attempted));
  });
}
test('unknown host and inherited capability cannot select an implicit fallback',()=>{
  assert.throws(()=>createFactoryReportIntegration({reporterFactory:createFactoryReport,host:'auto',connectors:{}}),/INVALID_INTEGRATION/);
  const connectors=Object.create(Object.fromEntries(schemes.go_brain.map(name=>[name,()=>assert.fail('Inherited call')])));
  assert.throws(()=>createFactoryReportIntegration({reporterFactory:createFactoryReport,host:'go_brain',connectors}),/CONNECTOR_UNAVAILABLE/);
});
test('live-verified reporter source remains byte exact',()=>{
  const module=readFileSync(new URL('../portable-factory-report.mjs',import.meta.url),'utf8');
  const source=module.replace(/\n\nexport \{ createFactoryReport \};\n$/,'');
  assert.equal(Buffer.byteLength(source),13546);
  assert.equal(createHash('sha256').update(source).digest('hex'),'68210ffa4dfcbd41b64740573c8a64476065257e40449decaf0b75691c13b8af');
});
