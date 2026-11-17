import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase, seed } from './brain-test-db.mjs';
import { processAssociation } from '../worker/brain-associations.mjs';

const evidence = { field: 'content', quote: 'Beaver/บีเวอร์' };
function output(relations = []) {
  return {
    intents: [{ label: 'role agreement', evidence }],
    entities: [{ label: 'Beaver', evidence, aliases: [{ label: 'บีเวอร์', evidence }] }],
    keywords: [{ label: 'Beaver', evidence }],
    relations,
  };
}
const okResponse = (data) => Response.json({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
  usage: { input_tokens: 100, output_tokens: 60 },
});

function agyEnv(DB, overrides = {}) {
  return {
    DB,
    BRAIN_ASSOCIATIONS_ENABLED: 'true',
    BRAIN_OPERATOR: 'agy',
    BRAIN_OPERATOR_URL: 'http://127.0.0.1:8788/v1/responses',
    BRAIN_OPERATOR_TOKEN: 'agy-brain-secret-token-1234',
    ...overrides,
  };
}

test('AGY Operator: processAssociation routes to local AGY bridge without OpenAI key', async (t) => {
  const s = testDatabase();
  t.after(s.close);
  const id = seed(s.sql);
  const calls = [];
  const requester = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return okResponse(output());
  };

  const result = await processAssociation(agyEnv(s.DB), { id, expected_revision: 1 }, { requester });
  assert.equal(result.state, 'ready');
  assert.equal(result.model, 'agy-google-ai-pro');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8788/v1/responses');
  assert.equal(calls[0].body.model, 'agy-google-ai-pro');
  assert.equal(calls[0].headers.Authorization, 'Bearer agy-brain-secret-token-1234');
});

test('AGY Circuit Breaker: blocks api.openai.com under AGY operator', async (t) => {
  const s = testDatabase();
  t.after(s.close);
  const id = seed(s.sql);
  let calls = 0;
  const requester = async () => { calls++; return okResponse(output()); };

  const result = await processAssociation(
    agyEnv(s.DB, { BRAIN_OPERATOR_URL: 'https://api.openai.com/v1/responses' }),
    { id, expected_revision: 1 },
    { requester }
  );
  assert.equal(result.state, 'failed');
  assert.equal(result.last_error, 'zero_paid_api_violation');
  assert.equal(calls, 0);
});

test('Operator Authentication: rejects missing or short BRAIN_OPERATOR_TOKEN', async (t) => {
  const s = testDatabase();
  t.after(s.close);
  const id1 = seed(s.sql);
  const id2 = seed(s.sql);
  let calls = 0;
  const requester = async () => { calls++; return okResponse(output()); };

  const resEmpty = await processAssociation(
    agyEnv(s.DB, { BRAIN_OPERATOR_TOKEN: '' }),
    { id: id1, expected_revision: 1 },
    { requester }
  );
  assert.equal(resEmpty.state, 'failed');
  assert.equal(resEmpty.last_error, 'operator_token_required');

  const resShort = await processAssociation(
    agyEnv(s.DB, { BRAIN_OPERATOR_TOKEN: 'short' }),
    { id: id2, expected_revision: 1 },
    { requester }
  );
  assert.equal(resShort.state, 'failed');
  assert.equal(resShort.last_error, 'operator_token_required');
  assert.equal(calls, 0);
});

test('Exfiltration Prevention: rejects non-loopback public operator URL', async (t) => {
  const s = testDatabase();
  t.after(s.close);
  const id = seed(s.sql);
  let calls = 0;
  const requester = async () => { calls++; return okResponse(output()); };

  const result = await processAssociation(
    agyEnv(s.DB, { BRAIN_OPERATOR_URL: 'https://127.0.0.1.attacker.com/v1/responses' }),
    { id, expected_revision: 1 },
    { requester }
  );
  assert.equal(result.state, 'failed');
  assert.equal(result.last_error, 'operator_url_not_permitted');
  assert.equal(calls, 0);
});

test('Zero Paid API Enforcement: ZERO_PAID_API="true" blocks paid OpenAI attempts', async (t) => {
  const s = testDatabase();
  t.after(s.close);
  const id = seed(s.sql);
  let calls = 0;
  let openAiKeyReads = 0;
  const requester = async () => { calls++; return okResponse(output()); };

  const env = {
    DB: s.DB,
    BRAIN_ASSOCIATIONS_ENABLED: 'true',
    ZERO_PAID_API: 'true',
    BRAIN_ASSOCIATION_API_KEY: { get: async () => { openAiKeyReads++; return 'sk-should-never-be-read'; } },
  };
  const result = await processAssociation(env, { id, expected_revision: 1 }, { requester });
  assert.equal(result.state, 'failed');
  assert.equal(result.last_error, 'zero_paid_api_enforced');
  assert.equal(openAiKeyReads, 0);
  assert.equal(calls, 0);
});

test('Fail-Closed Isolation: AGY failure never falls back to OpenAI', async (t) => {
  const s = testDatabase();
  t.after(s.close);
  const id = seed(s.sql);
  let openAiKeyReads = 0;
  const requester = async () => new Response('down', { status: 503 });

  const env = agyEnv(s.DB, {
    BRAIN_ASSOCIATION_API_KEY: { get: async () => { openAiKeyReads++; return 'sk-should-never-be-read'; } },
  });
  const result = await processAssociation(env, { id, expected_revision: 1 }, { requester });
  assert.equal(result.state, 'failed');
  assert.equal(result.last_error, 'agy_operator_failed');
  assert.equal(openAiKeyReads, 0);
});
