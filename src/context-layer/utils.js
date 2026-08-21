'use strict';

const crypto = require('node:crypto');
const { AgentAwareError } = require('../errors');

const SPEC_VERSION = 'context-layer/0.1-draft';
const NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SECRET_FIELD_NAMES = new Set([
  'accesstoken',
  'apikey',
  'authorization',
  'clientsecret',
  'cookie',
  'credential',
  'credentials',
  'password',
  'privatekey',
  'rawpayload',
  'rawsourcepayload',
  'refreshtoken',
  'secret',
  'sessiontoken',
  'token',
]);

function contextError(code, message, options = {}) {
  return new AgentAwareError(code, message, options);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function findSecretFields(value) {
  const matches = [];
  const seen = new WeakSet();

  function visit(current, path) {
    if (typeof current === 'string') {
      if (looksLikeCredential(current)) matches.push(path + ' (credential-like value)');
      return;
    }
    if (!current || typeof current !== 'object') return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, path + '[' + index + ']'));
      return;
    }

    for (const key of Object.keys(current)) {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (SECRET_FIELD_NAMES.has(normalized)) matches.push(path + '.' + key);
      visit(current[key], path + '.' + key);
    }
  }

  visit(value, '$');
  return matches;
}

function looksLikeCredential(value) {
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(value)) return true;
  if (/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i.test(value)) return true;
  if (/\b(?:sk|rk|pk)_(?:live|prod)_[A-Za-z0-9_-]{12,}\b/.test(value)) return true;
  return false;
}

function assertNoSecretFields(value, label = 'input') {
  const matches = findSecretFields(value);
  if (matches.length > 0) {
    throw contextError(
      'SECRET_FIELD_REJECTED',
      label + ' contains forbidden secret-bearing fields.',
      { status: 422, details: matches },
    );
  }
}

function stableStringify(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw contextError('NON_JSON_VALUE', 'Values used for a digest must be finite JSON values.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw contextError('CYCLIC_VALUE', 'Cyclic values cannot be digested.');
    seen.add(value);
    const result = '[' + value.map((entry) => stableStringify(entry, seen)).join(',') + ']';
    seen.delete(value);
    return result;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) throw contextError('CYCLIC_VALUE', 'Cyclic values cannot be digested.');
    seen.add(value);
    const entries = Object.keys(value).sort().map((key) => {
      const entry = value[key];
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') {
        throw contextError('NON_JSON_VALUE', 'Values used for a digest must be JSON serializable.');
      }
      return JSON.stringify(key) + ':' + stableStringify(entry, seen);
    });
    seen.delete(value);
    return '{' + entries.join(',') + '}';
  }
  throw contextError('NON_JSON_VALUE', 'Values used for a digest must be JSON serializable.');
}

function digestValue(value) {
  return 'sha256:' + crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function cloneJson(value, label = 'value') {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw contextError('INVALID_JSON_VALUE', label + ' must be a JSON value.', { status: 422 });
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return value;
}

function parseInstant(value, label) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw contextError('INVALID_TIMESTAMP', label + ' must be an RFC 3339 date-time.', {
      status: 422,
    });
  }
  return milliseconds;
}

function toRfc3339(value, label) {
  const milliseconds = value === undefined ? Date.now() : parseInstant(value, label);
  return new Date(milliseconds).toISOString();
}

function assertName(value, label) {
  if (typeof value !== 'string' || !NAME_PATTERN.test(value)) {
    throw contextError('INVALID_NAME', label + ' must be a stable lower-case name.', {
      status: 422,
    });
  }
  return value;
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw contextError('INVALID_DIGEST', label + ' must be a lowercase SHA-256 digest.', {
      status: 422,
    });
  }
  return value;
}

function safeAjvErrors(errors) {
  return (errors || []).slice(0, 12).map((entry) => ({
    path: entry.instancePath || '/',
    keyword: entry.keyword,
    message: entry.message,
  }));
}

module.exports = {
  DIGEST_PATTERN,
  NAME_PATTERN,
  SPEC_VERSION,
  assertDigest,
  assertName,
  assertNoSecretFields,
  cloneJson,
  contextError,
  deepFreeze,
  digestValue,
  findSecretFields,
  isPlainObject,
  parseInstant,
  safeAjvErrors,
  stableStringify,
  toRfc3339,
};
