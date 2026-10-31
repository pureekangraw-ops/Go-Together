// GO adapter for Factory PR #67's repository-delivery receipt protocol.
// Uses the existing GO HMAC signer and FACTORY_DIRECT service binding only.
// Receipt recording is owner-approved; reads are bounded and SHA-256 verified.
import { goRailSecretConfigured, signedFactoryRequest } from './factory-direct.mjs';

const RECEIPT = /^receipt-code-[a-f0-9]{32}$/;
const ARTIFACT = /^[a-f0-9]{32}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_REQUEST_BYTES = 2_000_000;
const MAX_RESPONSE_BYTES = 256_000;
const MAX_ARTIFACT_BYTES = 65_536;
const ENVELOPE_KEYS = ['messageId', 'requestId', 'work'];
const WORK_KEYS = ['workId', 'checkpointId'];
const DELIVERY_FIELDS = ['commit', 'delivery', 'expected', 'factoryEnvelope', 'pullRequest', 'readbackFiles', 'run'];
const fail = (status, extra = {}) => ({ ok: false, status, executed: false, ...extra });
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const exactKeys = (x, keys) => object(x) && Object.keys(x).sort().join('|') === [...keys].sort().join('|');
const nonempty = (x, limit = 512) => typeof x === 'string' && x.trim().length > 0 && x.length <= limit;

function validEnvelope(envelope) {
  return exactKeys(envelope, ENVELOPE_KEYS)
    && nonempty(envelope.messageId, 256)
    && /^[A-Za-z0-9._:-]{1,256}$/.test(envelope.messageId)
    && nonempty(envelope.requestId, 256)
    && /^[A-Za-z0-9._:-]{1,256}$/.test(envelope.requestId)
    && exactKeys(envelope.work, WORK_KEYS)
    && nonempty(envelope.work.workId, 256)
    && /^[A-Za-z0-9._:-]{1,256}$/.test(envelope.work.workId)
    && nonempty(envelope.work.checkpointId, 256)
    && /^[A-Za-z0-9._:-]{1,256}$/.test(envelope.work.checkpointId);
}

async function readJsonBounded(response, limit = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit || !response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function signedJson(env, method, path, payload, maxBytes = MAX_RESPONSE_BYTES) {
  if (!goRailSecretConfigured(env?.GO_FACTORY_RAIL_SECRET)
    || typeof env?.FACTORY_DIRECT?.fetch !== 'function') {
    return { ok: false, httpStatus: 0, data: null };
  }
  const response = await signedFactoryRequest(env, method, path, payload);
  return {
    ok: response.ok,
    httpStatus: response.status,
    data: await readJsonBounded(response, maxBytes),
  };
}

function validAck(data, envelope) {
  if (!object(data) || data.schema !== 'FACTORY_CODE_DELIVERY_ACK_V1'
    || data.status !== 'CODE_DELIVERY_RECORDED' || data.accepted !== true
    || data.executed !== false || data.factoryReceiptStatus !== 'ISSUED'
    || !RECEIPT.test(data.receiptId || '')
    || data.workId !== envelope.work.workId
    || data.checkpointId !== envelope.work.checkpointId
    || data.receipt?.accepted !== true || data.receipt?.receiptId !== data.receiptId
    || data.receipt?.workId !== envelope.work.workId
    || data.receipt?.checkpointId !== envelope.work.checkpointId
    || data.readback?.receiptId !== data.receiptId
    || data.readback?.workId !== envelope.work.workId
    || data.readback?.checkpointId !== envelope.work.checkpointId
    || data.readback?.verified !== true
    || !nonempty(data.readback?.evidenceRef, 2000)
    || data.evidenceRef !== data.readback.evidenceRef
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(data.delivery?.repository || '')
    || !/^[a-f0-9]{40}$/.test(data.delivery?.commitSha || '')
    || data.openableOutputUrl !== `https://github.com/${data.delivery.repository}/tree/${data.delivery.commitSha}`
    || data.delivery.openableOutputUrl !== data.openableOutputUrl
    || !Array.isArray(data.delivery?.artifacts)
    || data.delivery.artifacts.length < 1 || data.delivery.artifacts.length > 16) return false;
  let total = 0;
  for (const artifact of data.delivery.artifacts) {
    if (!object(artifact) || !ARTIFACT.test(artifact.artifactId || '')
      || artifact.receiptId !== data.receiptId
      || artifact.workId !== envelope.work.workId
      || artifact.checkpointId !== envelope.work.checkpointId
      || !nonempty(artifact.filename, 255) || /[\\/\u0000-\u001f\u007f]/.test(artifact.filename)
      || !nonempty(artifact.mediaType, 128)
      || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0
      || artifact.byteLength > MAX_ARTIFACT_BYTES || !SHA256.test(artifact.sha256 || '')
      || !nonempty(artifact.readbackRef, 2048)) return false;
    let path;
    try { path = new URL(artifact.readbackRef); } catch { return false; }
    if (path.protocol !== 'https:' || path.origin !== 'https://factory-district.internal'
      || path.pathname !== `/station/code-delivery/artifacts/${data.receiptId}/${artifact.artifactId}`
      || path.search || path.hash) return false;
    total += artifact.byteLength;
    if (total > 262_144) return false;
  }
  return true;
}

/** POST /station/code-delivery. No job dispatch or machinery execution. */
export async function factoryCodeDeliveryRecord(env, input = {}) {
  if (input?.approved !== true) return fail('OWNER_APPROVAL_REQUIRED');
  const { approved: _approved, ...payload } = input;
  if (!exactKeys(payload, DELIVERY_FIELDS) || !validEnvelope(payload.factoryEnvelope))
    return fail('FACTORY_CODE_DELIVERY_INPUT_INVALID');
  let body;
  try { body = JSON.stringify(payload); } catch { return fail('FACTORY_CODE_DELIVERY_INPUT_INVALID'); }
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES)
    return fail('FACTORY_CODE_DELIVERY_REQUEST_TOO_LARGE');
  try {
    const response = await signedJson(env, 'POST', '/station/code-delivery', payload);
    if (!response.ok || ![200, 201].includes(response.httpStatus)
      || !validAck(response.data, payload.factoryEnvelope)) {
      const reason = response.data?.reason;
      return fail('FACTORY_CODE_DELIVERY_ACK_UNVERIFIED', {
        httpStatus: response.httpStatus || null,
        reason: typeof reason === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(reason) ? reason : null,
      });
    }
    const ack = response.data;
    return {
      ok: true,
      status: 'FACTORY_CODE_DELIVERY_RECEIPT_ISSUED',
      accepted: true,
      receiptId: ack.receiptId,
      workId: ack.workId,
      checkpointId: ack.checkpointId,
      evidenceRef: ack.evidenceRef,
      readback: ack.readback,
      openableOutputUrl: ack.openableOutputUrl,
      openableOutputUrlKind: 'GITHUB_COMMIT_TREE_NOT_RENDERED',
      artifacts: ack.delivery.artifacts,
      factoryReceiptStatus: 'ISSUED',
      executed: false,
      artifactBytesVerified: false,
      deliveredToWork: false,
    };
  } catch {
    return fail('FACTORY_CODE_DELIVERY_TRANSPORT_UNCERTAIN');
  }
}

/** GET /station/readback/{receiptId}; correlate to caller's Work/checkpoint. */
export async function factoryCodeDeliveryReadback(env, { receiptId, workId, checkpointId } = {}) {
  if (!RECEIPT.test(receiptId || '') || !nonempty(workId, 256) || !nonempty(checkpointId, 256))
    return fail('FACTORY_CODE_DELIVERY_READBACK_INPUT_INVALID');
  try {
    const result = await signedJson(env, 'GET', `/station/readback/${encodeURIComponent(receiptId)}`);
    const x = result.data;
    if (!result.ok || x?.receiptId !== receiptId || x?.workId !== workId
      || x?.checkpointId !== checkpointId || x?.verified !== true
      || !nonempty(x?.evidenceRef, 2000)) {
      return fail('FACTORY_CODE_DELIVERY_READBACK_UNVERIFIED', {
        httpStatus: result.httpStatus || null,
      });
    }
    return {
      ok: true,
      status: 'FACTORY_CODE_DELIVERY_READBACK_VERIFIED',
      receiptId, workId, checkpointId,
      verified: true,
      evidenceRef: x.evidenceRef,
      readOnly: true,
      executed: false,
    };
  } catch {
    return fail('FACTORY_CODE_DELIVERY_READBACK_UNAVAILABLE');
  }
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch { return null; }
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function validReadbackRef(artifact) {
  try {
    const url = new URL(artifact.readbackRef);
    return url.protocol === 'https:' && url.origin === 'https://factory-district.internal'
      && url.pathname === `/station/code-delivery/artifacts/${artifact.receiptId}/${artifact.artifactId}`
      && !url.search && !url.hash;
  } catch { return false; }
}

/** GET the Factory-authenticated bounded artifact, after exact readback. */
export async function factoryCodeDeliveryArtifact(env, { artifact } = {}) {
  if (!object(artifact) || !exactKeys(artifact, [
    'artifactId', 'filename', 'mediaType', 'byteLength', 'sha256',
    'receiptId', 'workId', 'checkpointId', 'readbackRef',
  ]) || !ARTIFACT.test(artifact.artifactId || '') || !RECEIPT.test(artifact.receiptId || '')
    || !nonempty(artifact.workId, 256) || !nonempty(artifact.checkpointId, 256)
    || !nonempty(artifact.filename, 255) || /[\\/\u0000-\u001f\u007f]/.test(artifact.filename)
    || !nonempty(artifact.mediaType, 128)
    || !validReadbackRef(artifact)
    || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0
    || artifact.byteLength > MAX_ARTIFACT_BYTES || !SHA256.test(artifact.sha256 || ''))
    return fail('FACTORY_CODE_DELIVERY_ARTIFACT_INPUT_INVALID');

  const readback = await factoryCodeDeliveryReadback(env, {
    receiptId: artifact.receiptId,
    workId: artifact.workId,
    checkpointId: artifact.checkpointId,
  });
  if (!readback.ok) return { ...readback, status: 'FACTORY_CODE_DELIVERY_ARTIFACT_READBACK_REQUIRED' };

  try {
    const path = `/station/code-delivery/artifacts/${encodeURIComponent(artifact.receiptId)}/${artifact.artifactId}`;
    const response = await signedJson(env, 'GET', path, undefined, 160_000);
    const x = response.data;
    if (!response.ok || x?.receiptId !== artifact.receiptId
      || x?.workId !== artifact.workId || x?.checkpointId !== artifact.checkpointId
      || x?.verified !== true || x?.evidenceRef !== readback.evidenceRef
      || x?.filename !== artifact.filename || x?.mediaType !== artifact.mediaType
      || x?.byteLength !== artifact.byteLength || x?.sha256 !== artifact.sha256) {
      return fail('FACTORY_CODE_DELIVERY_ARTIFACT_METADATA_MISMATCH', {
        httpStatus: response.httpStatus || null,
        receiptId: artifact.receiptId, workId: artifact.workId, checkpointId: artifact.checkpointId,
      });
    }
    const bytes = decodeBase64(x.contentBase64);
    if (!bytes || bytes.byteLength !== x.byteLength || await sha256(bytes) !== x.sha256)
      return fail('FACTORY_CODE_DELIVERY_ARTIFACT_HASH_MISMATCH', {
        receiptId: artifact.receiptId, workId: artifact.workId, checkpointId: artifact.checkpointId,
      });
    return {
      ok: true,
      status: 'FACTORY_CODE_DELIVERY_ARTIFACT_VERIFIED',
      receiptId: x.receiptId,
      workId: x.workId,
      checkpointId: x.checkpointId,
      evidenceRef: x.evidenceRef,
      filename: x.filename,
      mediaType: x.mediaType,
      byteLength: x.byteLength,
      sha256: x.sha256,
      contentBase64: x.contentBase64,
      verified: true,
      readOnly: true,
      executed: false,
      artifactBytesVerified: true,
      deliveredToWork: false,
    };
  } catch {
    return fail('FACTORY_CODE_DELIVERY_ARTIFACT_UNAVAILABLE', {
      receiptId: artifact.receiptId, workId: artifact.workId, checkpointId: artifact.checkpointId,
    });
  }
}
