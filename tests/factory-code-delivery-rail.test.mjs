import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { factoryCodeDeliveryRecord, factoryCodeDeliveryReadback, factoryCodeDeliveryArtifact } from '../worker/factory-code-delivery-rail.mjs';
import { readFileSync } from 'node:fs';

const SECRET = 'unit-test-only-secret-value-32-bytes';
const workId = 'WORK-2026-10-31-01';
const checkpointId = 'CP-WORK-2026-10-31-01';
const receiptId = 'receipt-code-' + 'a'.repeat(32);
const artifactId = 'b'.repeat(32);
const bytes = Buffer.from('<!doctype html><title>Factory output</title>');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const envelope = { messageId: 'msg-001', requestId: 'req-001', work: { workId, checkpointId } };
const artifact = {
  artifactId, filename: 'index.html', mediaType: 'text/html; charset=utf-8',
  byteLength: bytes.length, sha256, receiptId, workId, checkpointId,
  readbackRef: `https://factory-district.internal/station/code-delivery/artifacts/${receiptId}/${artifactId}`,
};
function signedEnv(responses) {
  const calls = [];
  const env = {
    GO_FACTORY_RAIL_SECRET: SECRET,
    FACTORY_DIRECT: { fetch: async (request) => {
      calls.push(request);
      const value = responses.shift();
      return new Response(JSON.stringify(value.body), { status: value.status || 200, headers: { 'content-type': 'application/json' } });
    } },
  };
  return { env, calls };
}
function assertHmac(request, body = '') {
  const ts = request.headers.get('x-metropolis-factory-timestamp');
  const signature = request.headers.get('x-metropolis-factory-signature');
  assert.equal(request.headers.get('x-factory-client'), 'GO');
  assert.equal(request.headers.get('x-metropolis-factory-protocol'), 'METROPOLIS_FACTORY_STATION_V2');
  assert.match(ts || '', /^\d+$/);
  assert.equal(signature, createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex'));
}
function ack() {
  const readback = { receiptId, workId, checkpointId, verified: true, evidenceRef: 'https://github.com/pureekangraw-ops/Factory-District/actions/runs/12345' };
  return {
    schema: 'FACTORY_CODE_DELIVERY_ACK_V1', status: 'CODE_DELIVERY_RECORDED',
    accepted: true, receiptId, workId, checkpointId, executed: false,
    factoryReceiptStatus: 'ISSUED', receipt: { accepted: true, receiptId, workId, checkpointId },
    readback, evidenceRef: readback.evidenceRef,
    openableOutputUrl: 'https://github.com/pureekangraw-ops/Factory-District/tree/' + 'c'.repeat(40),
    delivery: { repository: 'pureekangraw-ops/Factory-District', commitSha: 'c'.repeat(40),
      openableOutputUrl: 'https://github.com/pureekangraw-ops/Factory-District/tree/' + 'c'.repeat(40), artifacts: [artifact] },
  };
}
test('receipt POST requires explicit approval and preserves exact envelope payload', async () => {
  const blocked = signedEnv([]);
  const payload = { commit: {}, delivery: {}, expected: {}, factoryEnvelope: envelope, pullRequest: {}, readbackFiles: [{ path: 'index.html' }], run: {}, approved: false };
  const denied = await factoryCodeDeliveryRecord(blocked.env, payload);
  assert.equal(denied.status, 'OWNER_APPROVAL_REQUIRED');
  assert.equal(blocked.calls.length, 0);

  const f = signedEnv([{ status: 201, body: ack() }]);
  const input = { ...payload, approved: true };
  const out = await factoryCodeDeliveryRecord(f.env, input);
  assert.equal(out.ok, true);
  assert.equal(out.accepted, true);
  assert.equal(out.factoryReceiptStatus, 'ISSUED');
  assert.equal(out.executed, false);
  assert.equal(out.artifactBytesVerified, false);
  assert.equal(out.deliveredToWork, false);
  assert.equal(f.calls.length, 1);
  const req = f.calls[0];
  assert.equal(req.method, 'POST');
  assert.equal(new URL(req.url).pathname, '/station/code-delivery');
  const bodyText = await req.text();
  const body = JSON.parse(bodyText);
  assert.deepEqual(Object.keys(body).sort(), ['commit','delivery','expected','factoryEnvelope','pullRequest','readbackFiles','run'].sort());
  assert.deepEqual(body.factoryEnvelope, envelope);
  assertHmac(req, bodyText);
});
test('receipt ACK with mismatched checkpoint is rejected', async () => {
  const invalid = ack(); invalid.checkpointId = 'wrong-checkpoint';
  const f = signedEnv([{ status: 201, body: invalid }]);
  const out = await factoryCodeDeliveryRecord(f.env, {
    commit: {}, delivery: {}, expected: {}, factoryEnvelope: envelope,
    pullRequest: {}, readbackFiles: [{ path: 'index.html' }], run: {}, approved: true,
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, 'FACTORY_CODE_DELIVERY_ACK_UNVERIFIED');
});
test('readback uses signed GET and exact Work/checkpoint correlation', async () => {
  const f = signedEnv([{ body: { receiptId, workId, checkpointId, verified: true, evidenceRef: 'https://github.com/actions/runs/12345' } }]);
  const out = await factoryCodeDeliveryReadback(f.env, { receiptId, workId, checkpointId });
  assert.equal(out.ok, true);
  assert.equal(out.readOnly, true);
  assert.equal(out.executed, false);
  assert.equal(f.calls[0].method, 'GET');
  assert.equal(new URL(f.calls[0].url).pathname, `/station/readback/${receiptId}`);
  assertHmac(f.calls[0]);
});
test('artifact readback verifies readback identity, metadata and bytes before returning content', async () => {
  const evidenceRef = 'https://github.com/actions/runs/12345';
  const f = signedEnv([
    { body: { receiptId, workId, checkpointId, verified: true, evidenceRef } },
    { body: { receiptId, workId, checkpointId, verified: true, evidenceRef,
      filename: artifact.filename, mediaType: artifact.mediaType, byteLength: artifact.byteLength,
      sha256, contentBase64: bytes.toString('base64') } },
  ]);
  const out = await factoryCodeDeliveryArtifact(f.env, { artifact });
  assert.equal(out.ok, true);
  assert.equal(out.verified, true);
  assert.equal(out.artifactBytesVerified, true);
  assert.equal(out.deliveredToWork, false);
  assert.equal(out.filename, 'index.html');
  assert.equal(Buffer.from(out.contentBase64, 'base64').toString(), bytes.toString());
  assert.equal(f.calls.length, 2);
  assert.equal(new URL(f.calls[0].url).pathname, `/station/readback/${receiptId}`);
  assert.equal(new URL(f.calls[1].url).pathname, `/station/code-delivery/artifacts/${receiptId}/${artifactId}`);
  f.calls.forEach((request) => assertHmac(request));
});
test('artifact bytes with wrong digest are never returned as verified', async () => {
  const evidenceRef = 'https://github.com/actions/runs/12345';
  const f = signedEnv([
    { body: { receiptId, workId, checkpointId, verified: true, evidenceRef } },
    { body: { receiptId, workId, checkpointId, verified: true, evidenceRef,
      filename: artifact.filename, mediaType: artifact.mediaType, byteLength: artifact.byteLength,
      sha256, contentBase64: Buffer.from('tampered').toString('base64') } },
  ]);
  const out = await factoryCodeDeliveryArtifact(f.env, { artifact });
  assert.equal(out.ok, false);
  assert.equal(out.status, 'FACTORY_CODE_DELIVERY_ARTIFACT_HASH_MISMATCH');
  assert.equal(out.contentBase64, undefined);
});
test('AppTools registers the wrappers under the existing factory_direct_ group', () => {
  const index = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
  const hubClient = readFileSync(new URL('../worker/hub-client.mjs', import.meta.url), 'utf8');
  for (const name of ['factory_direct_code_delivery_record','factory_direct_code_delivery_readback','factory_direct_code_delivery_artifact'])
    assert.ok(index.includes(`name:'${name}'`), `${name} tool definition missing`);
  assert.match(hubClient, /name\.startsWith\('factory_direct_'\)/);
  assert.match(index, /source=tools\.filter\(t=>hubGroup\(t\.name\)===group\)/);
  assert.match(index, /if\(a\.approved!==true\)throw new Bad\(403,'explicit_owner_approval_required'\);[\s\S]*?return factoryCodeDeliveryRecord\(env,a\)/);
  assert.match(index, /factoryCodeDeliveryReadback\(env,a\)/);
  assert.match(index, /factoryCodeDeliveryArtifact\(env,a\)/);
});
