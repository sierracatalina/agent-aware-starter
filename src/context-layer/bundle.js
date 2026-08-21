'use strict';

const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const schema = require('../../schemas/context-layer/scoped-context-bundle.schema.json');
const {
  assertNoSecretFields,
  cloneJson,
  contextError,
  deepFreeze,
  isPlainObject,
  parseInstant,
  safeAjvErrors,
} = require('./utils');

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function validateScopedContextBundle(bundle, options = {}) {
  const candidate = validateShape(bundle);
  const expectedRecipient = requireRecipient(options.expectedRecipient);
  const action = normalizeAction(options.action);
  const clockSkew = normalizeClockSkew(options.maxClockSkewMs);
  const now = options.now === undefined ? Date.now() : parseInstant(options.now, 'now');

  if (candidate.recipient !== expectedRecipient) {
    throw contextError(
      'BUNDLE_RECIPIENT_MISMATCH',
      'The scoped context bundle is addressed to another recipient.',
      { status: 403 },
    );
  }
  if (!candidate.capabilities.includes(action.id)) {
    throw contextError(
      'BUNDLE_ACTION_DENIED',
      'The scoped context bundle does not authorize the requested action.',
      { status: 403 },
    );
  }
  if (action.purpose !== undefined && candidate.purpose !== action.purpose) {
    throw contextError(
      'BUNDLE_PURPOSE_MISMATCH',
      'The scoped context bundle was issued for a different purpose.',
      { status: 403 },
    );
  }
  if (
    action.maxRetentionSeconds !== undefined
    && candidate.restrictions.retention_seconds > action.maxRetentionSeconds
  ) {
    throw contextError(
      'BUNDLE_RETENTION_EXCEEDED',
      'The scoped context bundle exceeds the action retention limit.',
      { status: 403 },
    );
  }

  enforceSelectors(candidate, action.selectors);
  enforceProvenance(candidate);
  enforceReceiptContract(candidate, action);

  const createdAt = parseInstant(candidate.created_at, 'bundle.created_at');
  const issuedAt = parseInstant(candidate.issued_at, 'bundle.issued_at');
  const declaredExpiry = parseInstant(candidate.expires_at, 'bundle.expires_at');
  if (createdAt > issuedAt || declaredExpiry <= issuedAt) {
    throw contextError('BUNDLE_TIME_INVALID', 'The bundle time window is invalid.', {
      status: 422,
    });
  }
  if (issuedAt > now + clockSkew) {
    throw contextError(
      'BUNDLE_NOT_YET_VALID',
      'The scoped context bundle has not been issued yet.',
      { status: 409 },
    );
  }

  const retentionExpiry =
    issuedAt + (candidate.restrictions.retention_seconds * 1000);
  const effectiveExpiresAtMs = Math.min(declaredExpiry, retentionExpiry);
  if (now >= effectiveExpiresAtMs + clockSkew) {
    throw contextError(
      'BUNDLE_EXPIRED',
      'The scoped context bundle is no longer valid.',
      { status: 410 },
    );
  }

  deepFreeze(candidate);
  return Object.freeze({
    valid: true,
    bundle: candidate,
    actionId: action.id,
    expectedRecipient,
    approvedPredicates: Object.freeze([...action.selectors]),
    effectiveExpiresAt: new Date(effectiveExpiresAtMs).toISOString(),
    effectiveExpiresAtMs,
    receiptRequired: Boolean(
      action.receiptRequired || candidate.receipt_contract.required,
    ),
  });
}

function validateShape(bundle) {
  if (!isPlainObject(bundle)) {
    throw contextError(
      'INVALID_SCOPED_CONTEXT_BUNDLE',
      'The scoped context bundle must be a JSON object.',
      { status: 422 },
    );
  }
  assertNoSecretFields(bundle, 'scoped context bundle');
  const candidate = cloneJson(bundle, 'scoped context bundle');
  if (!validateSchema(candidate)) {
    throw contextError(
      'INVALID_SCOPED_CONTEXT_BUNDLE',
      'The scoped context bundle does not match the phase-0 contract.',
      { status: 422, details: safeAjvErrors(validateSchema.errors) },
    );
  }
  return candidate;
}

function requireRecipient(value) {
  if (typeof value !== 'string' || value.length < 3) {
    throw contextError(
      'EXPECTED_RECIPIENT_REQUIRED',
      'An exact expected recipient is required to validate a bundle.',
      { status: 500 },
    );
  }
  return value;
}

function normalizeAction(value) {
  if (!isPlainObject(value) || typeof value.id !== 'string' || value.id.length === 0) {
    throw contextError(
      'ACTION_DESCRIPTOR_REQUIRED',
      'A configured action descriptor with an id is required.',
      { status: 500 },
    );
  }
  if (!isPlainObject(value.context) || !Array.isArray(value.context.selectors)) {
    throw contextError(
      'ACTION_SELECTORS_REQUIRED',
      'The action must declare its allowed context selectors.',
      { status: 500 },
    );
  }
  const selectors = value.context.selectors.map((selector, index) => {
    const predicate = typeof selector === 'string'
      ? selector
      : isPlainObject(selector) ? selector.predicate : null;
    if (typeof predicate !== 'string' || predicate.length === 0) {
      throw contextError(
        'ACTION_SELECTOR_INVALID',
        'action.context.selectors[' + index + '] must name a predicate.',
        { status: 500 },
      );
    }
    return predicate;
  });
  if (new Set(selectors).size !== selectors.length) {
    throw contextError(
      'ACTION_SELECTOR_INVALID',
      'Action context selectors must be unique.',
      { status: 500 },
    );
  }
  if (
    value.context.purpose_match !== undefined
    && value.context.purpose_match !== 'exact'
  ) {
    throw contextError(
      'ACTION_PURPOSE_POLICY_INVALID',
      'Context purpose matching must be exact.',
      { status: 500 },
    );
  }
  const purposes = value.context.purposes;
  if (
    purposes !== undefined
    && (
      !Array.isArray(purposes)
      || purposes.length !== 1
      || typeof purposes[0] !== 'string'
      || purposes[0].length < 3
    )
  ) {
    throw contextError(
      'ACTION_PURPOSE_POLICY_INVALID',
      'Protected actions must declare exactly one purpose.',
      { status: 500 },
    );
  }
  if (
    value.context.purpose !== undefined
    && (typeof value.context.purpose !== 'string' || value.context.purpose.length < 3)
  ) {
    throw contextError(
      'ACTION_PURPOSE_POLICY_INVALID',
      'The action context purpose must be a non-empty exact string.',
      { status: 500 },
    );
  }
  const purpose = purposes === undefined ? value.context.purpose : purposes[0];
  if (
    purposes !== undefined
    && value.context.purpose !== undefined
    && value.context.purpose !== purpose
  ) {
    throw contextError(
      'ACTION_PURPOSE_POLICY_INVALID',
      'Legacy and current action purposes must match exactly.',
      { status: 500 },
    );
  }
  const maximum = value.context.max_retention_seconds;
  if (
    maximum !== undefined
    && (!Number.isInteger(maximum) || maximum < 1 || maximum > 86400)
  ) {
    throw contextError(
      'ACTION_RETENTION_POLICY_INVALID',
      'The action retention limit must be an integer from 1 through 86400.',
      { status: 500 },
    );
  }
  return {
    id: value.id,
    selectors,
    purpose,
    maxRetentionSeconds: maximum,
    receiptRequired: Boolean(value.context.receipt_required),
  };
}

function enforceSelectors(bundle, selectors) {
  const allowed = new Set(selectors);
  const overbroad = bundle.context
    .map((claim) => claim.predicate)
    .filter((predicate) => !allowed.has(predicate));
  if (overbroad.length > 0) {
    throw contextError(
      'BUNDLE_CONTEXT_OVERBROAD',
      'The scoped context bundle contains predicates outside the action scope.',
      {
        status: 403,
        details: [...new Set(overbroad)].map((predicate) => ({ predicate })),
      },
    );
  }
}

function enforceProvenance(bundle) {
  for (const [claimIndex, claim] of bundle.context.entries()) {
    for (const handle of claim.provenance_handles) {
      if (!Object.hasOwn(bundle.provenance, handle)) {
        throw contextError(
          'BUNDLE_PROVENANCE_MISSING',
          'A disclosed claim references missing provenance.',
          {
            status: 422,
            details: [{ claim_index: claimIndex, predicate: claim.predicate, handle }],
          },
        );
      }
    }
  }
}

function enforceReceiptContract(bundle, action) {
  const allowed = new Set(['bundle.consume', ...bundle.capabilities]);
  const invalid = bundle.receipt_contract.required_operations
    .filter((operation) => !allowed.has(operation));
  if (invalid.length > 0) {
    throw contextError(
      'BUNDLE_RECEIPT_CONTRACT_INVALID',
      'The receipt contract names an operation the bundle does not authorize.',
      { status: 422, details: invalid.map((operation) => ({ operation })) },
    );
  }
  if (
    (bundle.receipt_contract.required || action.receiptRequired)
    && !bundle.receipt_contract.required_operations.includes(action.id)
  ) {
    throw contextError(
      'BUNDLE_RECEIPT_CONTRACT_INCOMPLETE',
      'The receipt contract does not cover the requested action.',
      { status: 422 },
    );
  }
}

function normalizeClockSkew(value) {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw contextError(
      'INVALID_CLOCK_SKEW',
      'maxClockSkewMs must be a non-negative integer.',
      { status: 500 },
    );
  }
  return value;
}

module.exports = { validateScopedContextBundle };
