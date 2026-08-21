'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const schema = require('../../schemas/context-layer/receipt.schema.json');
const {
  SPEC_VERSION,
  assertDigest,
  assertName,
  assertNoSecretFields,
  cloneJson,
  contextError,
  deepFreeze,
  digestValue,
  isPlainObject,
  parseInstant,
  safeAjvErrors,
  toRfc3339,
} = require('./utils');

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function createReceipt(input) {
  if (!isPlainObject(input)) {
    throw contextError('INVALID_RECEIPT_INPUT', 'Receipt input must be an object.', {
      status: 422,
    });
  }
  assertNoSecretFields(input, 'receipt input');
  const bundle = input.bundle;
  if (!isPlainObject(bundle)) {
    throw contextError(
      'INVALID_RECEIPT_CHAIN',
      'A validated scoped context bundle is required to create a receipt.',
      { status: 422 },
    );
  }

  const operation = assertName(input.operation, 'receipt operation');
  const actor = requireIdentifier(input.actor, 'receipt actor');
  const issuer = requireIdentifier(input.issuer, 'receipt issuer');
  const startedAt = toRfc3339(input.startedAt, 'receipt startedAt');
  const completedAt = toRfc3339(input.completedAt, 'receipt completedAt');
  if (parseInstant(completedAt, 'receipt completedAt') < parseInstant(startedAt, 'receipt startedAt')) {
    throw contextError(
      'INVALID_RECEIPT_TIME',
      'Receipt completion cannot precede its start.',
      { status: 422 },
    );
  }

  const outcome = input.outcome === undefined ? 'success' : input.outcome;
  if (!['success', 'failure', 'indeterminate'].includes(outcome)) {
    throw contextError('INVALID_RECEIPT_OUTCOME', 'Receipt outcome is invalid.', {
      status: 422,
    });
  }

  const policySnapshot = assertDigest(
    input.policySnapshotDigest,
    'policySnapshotDigest',
  );
  const inputDigest = input.inputDigest === undefined
    ? digestValue(input.input === undefined
      ? { operation, request_ref: bundle.request_ref, bundle_ref: bundle.id }
      : input.input)
    : assertDigest(input.inputDigest, 'inputDigest');
  const outputDigest = input.outputDigest === undefined
    ? digestValue(input.output === undefined
      ? { operation, outcome, bundle_ref: bundle.id }
      : input.output)
    : assertDigest(input.outputDigest, 'outputDigest');
  const userSummary = input.userSummary === undefined
    ? 'Recorded ' + operation + ' with payload omitted.'
    : input.userSummary;
  if (typeof userSummary !== 'string' || userSummary.length < 1 || userSummary.length > 500) {
    throw contextError(
      'INVALID_RECEIPT_SUMMARY',
      'Receipt userSummary must contain from 1 through 500 characters.',
      { status: 422 },
    );
  }

  return validateReceipt({
    spec_version: SPEC_VERSION,
    type: 'receipt',
    id: input.id || 'urn:cl:receipt:' + crypto.randomUUID(),
    created_at: completedAt,
    issuer: { id: issuer },
    operation,
    actor,
    subject_ref: bundle.subject_alias,
    request_ref: bundle.request_ref,
    decision_ref: bundle.decision_ref,
    bundle_ref: bundle.id,
    started_at: startedAt,
    completed_at: completedAt,
    outcome,
    policy_snapshot: policySnapshot,
    input_digest: inputDigest,
    output_digest: outputDigest,
    user_summary: userSummary,
    payload_included: false,
  });
}

function validateReceipt(receipt) {
  if (!isPlainObject(receipt)) {
    throw contextError('INVALID_RECEIPT', 'Receipt must be a JSON object.', {
      status: 422,
    });
  }
  assertNoSecretFields(receipt, 'receipt');
  const candidate = cloneJson(receipt, 'receipt');
  if (!validateSchema(candidate)) {
    throw contextError(
      'INVALID_RECEIPT',
      'Receipt does not match the payload-minimized phase-0 contract.',
      { status: 422, details: safeAjvErrors(validateSchema.errors) },
    );
  }
  if (
    parseInstant(candidate.completed_at, 'receipt.completed_at')
    < parseInstant(candidate.started_at, 'receipt.started_at')
  ) {
    throw contextError(
      'INVALID_RECEIPT_TIME',
      'Receipt completion cannot precede its start.',
      { status: 422 },
    );
  }
  return deepFreeze(candidate);
}

class InMemoryReceiptStore {
  constructor(options = {}) {
    this.available = options.available !== false;
    this.receipts = [];
    this.receiptsById = new Map();
    this.reservedBundles = new Set();
    this.reservedIdempotency = new Set();
  }

  async preflight() {
    this.assertAvailable();
    return true;
  }

  async append(receipt) {
    this.assertAvailable();
    return this.storeReceipt(validateReceipt(receipt));
  }

  async reserveBundle(bundleId, receipt) {
    this.assertAvailable();
    requireBundleId(bundleId);
    const candidate = receipt === undefined ? null : validateReceipt(receipt);
    if (candidate && candidate.bundle_ref !== bundleId) {
      throw contextError(
        'RECEIPT_BUNDLE_MISMATCH',
        'The reservation receipt references another bundle.',
        { status: 409 },
      );
    }
    if (this.reservedBundles.has(bundleId)) throw replayError();
    if (candidate) this.assertReceiptId(candidate);
    this.reservedBundles.add(bundleId);
    if (candidate) this.storeReceipt(candidate);
    return candidate || true;
  }

  async reserveSingleUse(bundleId, receipt) {
    return this.reserveBundle(bundleId, receipt);
  }

  async reserveIdempotency(scopeDigest) {
    this.assertAvailable();
    const key = assertDigest(scopeDigest, 'idempotency scope');
    if (this.reservedIdempotency.has(key)) throw idempotencyError();
    this.reservedIdempotency.add(key);
    return true;
  }

  hasReservedIdempotency(scopeDigest) {
    return this.reservedIdempotency.has(assertDigest(scopeDigest, 'idempotency scope'));
  }

  hasReservedBundle(bundleId) {
    return this.reservedBundles.has(bundleId);
  }

  list() {
    return this.receipts.slice();
  }

  setAvailable(value) {
    this.available = Boolean(value);
  }

  assertAvailable() {
    if (!this.available) throw unavailableError();
  }

  assertReceiptId(receipt) {
    const existing = this.receiptsById.get(receipt.id);
    if (existing && digestValue(existing) !== digestValue(receipt)) {
      throw contextError(
        'RECEIPT_ID_CONFLICT',
        'A different receipt already uses this identifier.',
        { status: 409 },
      );
    }
  }

  storeReceipt(receipt) {
    this.assertReceiptId(receipt);
    const existing = this.receiptsById.get(receipt.id);
    if (existing) return existing;
    this.receipts.push(receipt);
    this.receiptsById.set(receipt.id, receipt);
    return receipt;
  }
}

class FileReceiptStore {
  constructor(filePath) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw contextError(
        'RECEIPT_STORE_PATH_REQUIRED',
        'FileReceiptStore requires a receipt log path.',
        { status: 500 },
      );
    }
    this.filePath = path.resolve(filePath);
    this.reservationDirectory = this.filePath + '.state/single-use';
    this.idempotencyDirectory = this.filePath + '.state/idempotency';
    this.queue = Promise.resolve();
  }

  async preflight() {
    try {
      await this.enqueue(async () => {
        await this.prepare();
        const handle = await fs.open(this.filePath, 'a', 0o600);
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      });
      return true;
    } catch (error) {
      if (error && error.code === 'RECEIPT_STORE_UNAVAILABLE') throw error;
      throw unavailableError(error);
    }
  }

  async append(receipt) {
    const candidate = validateReceipt(receipt);
    return this.enqueue(async () => {
      try {
        await this.prepare();
        await appendAndSync(this.filePath, candidate);
        return candidate;
      } catch (error) {
        if (error && error.code && error.code.startsWith('RECEIPT_')) throw error;
        throw persistenceError(error);
      }
    });
  }

  async reserveBundle(bundleId, receipt) {
    requireBundleId(bundleId);
    const candidate = receipt === undefined ? null : validateReceipt(receipt);
    if (candidate && candidate.bundle_ref !== bundleId) {
      throw contextError(
        'RECEIPT_BUNDLE_MISMATCH',
        'The reservation receipt references another bundle.',
        { status: 409 },
      );
    }

    return this.enqueue(async () => {
      await this.prepare();
      const markerPath = path.join(
        this.reservationDirectory,
        digestValue(bundleId).slice(7) + '.used',
      );
      let markerHandle;
      try {
        markerHandle = await fs.open(markerPath, 'wx', 0o600);
      } catch (error) {
        if (error && error.code === 'EEXIST') throw replayError();
        throw unavailableError(error);
      }
      try {
        await markerHandle.writeFile(JSON.stringify({
          bundle_digest: digestValue(bundleId),
          receipt_id: candidate ? candidate.id : null,
          reserved_at: new Date().toISOString(),
        }) + '\n', 'utf8');
        await markerHandle.sync();
      } catch (error) {
        throw persistenceError(error);
      } finally {
        await markerHandle.close();
      }
      await syncDirectory(this.reservationDirectory);
      if (candidate) {
        try {
          await appendAndSync(this.filePath, candidate);
        } catch (error) {
          throw persistenceError(error);
        }
      }
      return candidate || true;
    });
  }

  async reserveSingleUse(bundleId, receipt) {
    return this.reserveBundle(bundleId, receipt);
  }

  async reserveIdempotency(scopeDigest) {
    const key = assertDigest(scopeDigest, 'idempotency scope');
    return this.enqueue(async () => {
      await this.prepare();
      const markerPath = path.join(
        this.idempotencyDirectory,
        key.slice(7) + '.used',
      );
      let markerHandle;
      try {
        markerHandle = await fs.open(markerPath, 'wx', 0o600);
      } catch (error) {
        if (error && error.code === 'EEXIST') throw idempotencyError();
        throw unavailableError(error);
      }
      try {
        await markerHandle.writeFile(JSON.stringify({
          scope_digest: key,
          reserved_at: new Date().toISOString(),
        }) + '\n', 'utf8');
        await markerHandle.sync();
      } catch (error) {
        throw persistenceError(error);
      } finally {
        await markerHandle.close();
      }
      await syncDirectory(this.idempotencyDirectory);
      return true;
    });
  }

  async hasReservedIdempotency(scopeDigest) {
    const key = assertDigest(scopeDigest, 'idempotency scope');
    const marker = path.join(this.idempotencyDirectory, key.slice(7) + '.used');
    try {
      await fs.access(marker);
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw unavailableError(error);
    }
  }

  async hasReservedBundle(bundleId) {
    requireBundleId(bundleId);
    const marker = path.join(
      this.reservationDirectory,
      digestValue(bundleId).slice(7) + '.used',
    );
    try {
      await fs.access(marker);
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw unavailableError(error);
    }
  }

  async readAll() {
    try {
      const source = await fs.readFile(this.filePath, 'utf8');
      const receipts = [];
      const seen = new Set();
      for (const line of source.split(/\r?\n/)) {
        if (!line) continue;
        let receipt;
        try {
          receipt = validateReceipt(JSON.parse(line));
        } catch (error) {
          throw contextError(
            'RECEIPT_STORE_CORRUPT',
            'The receipt log contains an invalid record.',
            { status: 500, details: [error.code || 'INVALID_RECORD'] },
          );
        }
        if (!seen.has(receipt.id)) {
          receipts.push(receipt);
          seen.add(receipt.id);
        }
      }
      return receipts;
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      if (error && error.code === 'RECEIPT_STORE_CORRUPT') throw error;
      throw unavailableError(error);
    }
  }

  enqueue(operation) {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async prepare() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      await fs.mkdir(this.reservationDirectory, { recursive: true, mode: 0o700 });
      await fs.mkdir(this.idempotencyDirectory, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw unavailableError(error);
    }
  }
}

async function appendAndSync(filePath, receipt) {
  const handle = await fs.open(filePath, 'a', 0o600);
  try {
    await handle.writeFile(JSON.stringify(receipt) + '\n', 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(filePath));
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!error || !['EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      throw error;
    }
  } finally {
    if (handle) await handle.close();
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 512) {
    throw contextError('INVALID_IDENTIFIER', label + ' must be a stable identifier.', {
      status: 422,
    });
  }
  return value;
}

function requireBundleId(value) {
  if (
    typeof value !== 'string'
    || !/^urn:cl:bundle:[A-Za-z0-9._~-]+$/.test(value)
  ) {
    throw contextError(
      'INVALID_BUNDLE_ID',
      'A Context Layer bundle identifier is required.',
      { status: 422 },
    );
  }
}

function replayError() {
  return contextError(
    'BUNDLE_REPLAYED',
    'The single-use scoped context bundle has already been consumed.',
    { status: 409 },
  );
}

function idempotencyError() {
  return contextError(
    'IDEMPOTENCY_REPLAYED',
    'The idempotency key has already been reserved for this action and caller.',
    { status: 409 },
  );
}

function unavailableError(cause) {
  return contextError(
    'RECEIPT_STORE_UNAVAILABLE',
    'The required receipt service is unavailable.',
    {
      status: 503,
      retryable: true,
      details: cause && cause.code ? [cause.code] : [],
    },
  );
}

function persistenceError(cause) {
  return contextError(
    'RECEIPT_PERSIST_FAILED',
    'The operation receipt could not be durably persisted.',
    {
      status: 503,
      retryable: true,
      indeterminate: true,
      details: cause && cause.code ? [cause.code] : [],
    },
  );
}

module.exports = {
  FileReceiptStore,
  InMemoryReceiptStore,
  createReceipt,
  validateReceipt,
};
