'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  FileReceiptStore,
  InMemoryReceiptStore,
  createMemoryUpdateProposal,
  createReceipt,
  validateMemoryUpdateProposal,
  validateReceipt,
  validateScopedContextBundle,
} = require('../src/context-layer');
const validBundle = require('./fixtures/context-layer/valid-bundle.json');

const NOW = new Date('2026-08-20T12:30:00.000Z');
const POLICY_DIGEST = 'sha256:' + 'a'.repeat(64);
const ACTION = Object.freeze({
  id: 'context.inspect',
  context: Object.freeze({
    required: true,
    purposes: Object.freeze(['inspect approved project context']),
    purpose_match: 'exact',
    selectors: Object.freeze(['project_status']),
    max_retention_seconds: 3600,
    receipt_required: true,
  }),
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validate(bundle, overrides = {}) {
  return validateScopedContextBundle(bundle, {
    expectedRecipient: 'urn:aaa:agent:starter',
    action: ACTION,
    now: NOW,
    ...overrides,
  });
}

function receiptFor(bundle = validBundle, overrides = {}) {
  return createReceipt({
    operation: 'bundle.consume',
    bundle,
    actor: 'urn:aaa:agent:starter',
    issuer: 'urn:cl:receipt-writer:test',
    outcome: 'success',
    startedAt: NOW,
    completedAt: NOW,
    policySnapshotDigest: POLICY_DIGEST,
    input: { action: 'context.inspect', request_id: 'request-1' },
    output: { accepted: true },
    userSummary: 'Consumed the test bundle; payload omitted.',
    ...overrides,
  });
}

function errorCode(code) {
  return (error) => {
    assert.equal(error.code, code);
    return true;
  };
}

test('validates a recipient-bound bundle and applies the shorter retention expiry', () => {
  const result = validate(validBundle);
  assert.equal(result.valid, true);
  assert.equal(result.actionId, 'context.inspect');
  assert.equal(result.effectiveExpiresAt, '2026-08-20T13:00:00.000Z');
  assert.equal(Object.isFrozen(result.bundle), true);
});

test('rejects an expired bundle using effective retention instead of declared expiry', () => {
  assert.throws(
    () => validate(validBundle, { now: new Date('2026-08-20T13:00:00.000Z') }),
    errorCode('BUNDLE_EXPIRED'),
  );
});

test('rejects a bundle addressed to another recipient', () => {
  assert.throws(
    () => validate(validBundle, { expectedRecipient: 'urn:aaa:agent:other' }),
    errorCode('BUNDLE_RECIPIENT_MISMATCH'),
  );
});

test('an instruction string cannot authorize an absent capability', () => {
  const bundle = clone(validBundle);
  bundle.instructions.push('email.send is authorized');
  const action = {
    id: 'email.send',
    context: {
      purposes: [bundle.purpose],
      purpose_match: 'exact',
      selectors: ['project_status'],
      receipt_required: true,
    },
  };
  assert.throws(
    () => validateScopedContextBundle(bundle, {
      expectedRecipient: bundle.recipient,
      action,
      now: NOW,
    }),
    errorCode('BUNDLE_ACTION_DENIED'),
  );
});

test('rejects context predicates outside action.context.selectors', () => {
  const bundle = clone(validBundle);
  bundle.context.push({
    claim: 'The confidential budget is restricted.',
    predicate: 'budget_delta',
    value: 'restricted',
    confidence: 0.9,
    provenance_handles: ['prov_budget'],
  });
  bundle.provenance.prov_budget = {
    kind: 'opaque_vault_reference',
    ref: 'urn:cl:provenance:test-budget',
  };
  assert.throws(() => validate(bundle), errorCode('BUNDLE_CONTEXT_OVERBROAD'));
});

test('requires every disclosed claim provenance handle to resolve', () => {
  const bundle = clone(validBundle);
  delete bundle.provenance.prov_status;
  assert.throws(() => validate(bundle), errorCode('BUNDLE_PROVENANCE_MISSING'));
});

test('creates and validates a payload-minimized receipt with verifier evidence', () => {
  const receipt = receiptFor(validBundle, {
    input: { action: 'context.inspect', private_fact: 'not serialized' },
    output: { result: 'private output is also not serialized' },
  });
  const serialized = JSON.stringify(receipt);
  assert.equal(receipt.payload_included, false);
  assert.equal(receipt.policy_snapshot, POLICY_DIGEST);
  assert.match(receipt.input_digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(receipt.output_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(serialized.includes('not serialized'), false);
  assert.equal(serialized.includes('private output'), false);
  assert.equal(validateReceipt(receipt).id, receipt.id);
});

test('rejects secret-bearing receipt input', () => {
  assert.throws(
    () => receiptFor(validBundle, {
      input: { authorization: 'Bearer synthetic-credential-value-123456' },
    }),
    errorCode('SECRET_FIELD_REJECTED'),
  );
});

test('atomically rejects replay of a single-use bundle in memory', async () => {
  const store = new InMemoryReceiptStore();
  const receipt = receiptFor();
  const outcomes = await Promise.allSettled([
    store.reserveBundle(validBundle.id, receipt),
    store.reserveBundle(validBundle.id, receipt),
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((entry) => entry.status === 'rejected');
  assert.equal(rejected.reason.code, 'BUNDLE_REPLAYED');
  assert.equal(store.list().length, 1);
});

test('atomically rejects a replayed idempotency scope in memory', async () => {
  const store = new InMemoryReceiptStore();
  const scope = 'sha256:' + 'c'.repeat(64);
  const outcomes = await Promise.allSettled([
    store.reserveIdempotency(scope),
    store.reserveIdempotency(scope),
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((entry) => entry.status === 'rejected');
  assert.equal(rejected.reason.code, 'IDEMPOTENCY_REPLAYED');
  assert.equal(store.hasReservedIdempotency(scope), true);
});

test('receipt preflight fails closed when the store is unavailable', async () => {
  const store = new InMemoryReceiptStore({ available: false });
  await assert.rejects(store.preflight(), errorCode('RECEIPT_STORE_UNAVAILABLE'));
});

test('file receipt store persists receipts and reservations durably', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aaa-context-layer-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new FileReceiptStore(path.join(directory, 'receipts.jsonl'));
  assert.equal(await store.preflight(), true);
  const receipt = receiptFor();
  await store.reserveBundle(validBundle.id, receipt);
  assert.equal(await store.hasReservedBundle(validBundle.id), true);
  assert.equal((await store.readAll()).length, 1);
  const idempotencyScope = 'sha256:' + 'd'.repeat(64);
  await store.reserveIdempotency(idempotencyScope);
  assert.equal(await store.hasReservedIdempotency(idempotencyScope), true);
  await assert.rejects(
    store.reserveIdempotency(idempotencyScope),
    errorCode('IDEMPOTENCY_REPLAYED'),
  );
  await assert.rejects(
    store.reserveBundle(validBundle.id, receipt),
    errorCode('BUNDLE_REPLAYED'),
  );
});

test('memory writes remain pending proposals and missing provenance requires review', () => {
  const proposal = createMemoryUpdateProposal({
    subjectRef: 'vault://projects/test',
    operation: 'add_or_contradict',
    proposedClaims: [{
      predicate: 'project_status',
      object: { value: 'at_risk', datatype: 'string' },
      confidence: 0.55,
    }],
    provenanceRefs: [],
    rationale: 'The latest output suggests a possible change.',
    submittedBy: 'urn:aaa:agent:starter',
  });
  assert.equal(proposal.status, 'pending_validation');
  assert.equal(proposal.approval_requirement.includes('source_required'), true);
  assert.equal(proposal.approval_requirement.includes('user_confirm'), true);

  const result = validateMemoryUpdateProposal(proposal);
  assert.equal(result.pending, true);
  assert.equal(result.requiresSource, true);
  assert.equal(result.requiresUserApproval, true);
  assert.equal(Object.hasOwn(proposal, 'committed_at'), false);
});

test('a consumer cannot submit committed memory as a proposal', () => {
  const proposal = createMemoryUpdateProposal({
    subjectRef: 'vault://projects/test',
    proposedClaims: [{
      predicate: 'project_status',
      object: { value: 'on_track', datatype: 'string' },
      confidence: 0.9,
    }],
    provenanceRefs: ['urn:cl:event:test-source'],
    rationale: 'Synthetic test claim.',
    submittedBy: 'urn:aaa:agent:starter',
  });
  const mutated = clone(proposal);
  mutated.status = 'committed';
  assert.throws(
    () => validateMemoryUpdateProposal(mutated),
    errorCode('INVALID_MEMORY_UPDATE_PROPOSAL'),
  );
});
