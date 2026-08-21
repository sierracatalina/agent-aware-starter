'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  InMemoryReceiptStore,
  createActionGateway,
  createApp,
  createDevelopmentBundleVerifier,
  loadConfig,
} = require('../src');
const validBundle = require('./fixtures/context-layer/valid-bundle.json');

const NOW = new Date('2026-08-20T12:02:00.000Z');
const POLICY_DIGEST = 'sha256:' + 'b'.repeat(64);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function testConfig() {
  return loadConfig({
    env: {},
    publicOrigin: 'http://127.0.0.1',
  });
}

function bundleFor(config, overrides = {}) {
  const bundle = clone(validBundle);
  bundle.id = overrides.id || 'urn:cl:bundle:http-test';
  bundle.recipient = config.agent.recipient;
  bundle.purpose = config.actions.find((action) => action.id === 'context.inspect').context.purposes[0];
  bundle.created_at = '2026-08-20T12:00:00.000Z';
  bundle.issued_at = '2026-08-20T12:00:00.000Z';
  bundle.expires_at = '2026-08-20T12:10:00.000Z';
  bundle.context = [{
    claim: 'The approved project summary is on track.',
    predicate: 'project.summary',
    value: 'approved-private-value',
    confidence: 0.96,
    provenance_handles: ['prov_status'],
  }];
  bundle.provenance = {
    prov_status: {
      kind: 'opaque_vault_reference',
      ref: 'urn:cl:provenance:http-test',
    },
  };
  bundle.restrictions.retention_seconds = 300;
  Object.assign(bundle, overrides.bundle || {});
  return bundle;
}

function authenticator() {
  return Promise.resolve({
    principal: 'urn:aaa:client:test',
    authenticated_by: 'test',
    client_instance: 'urn:aaa:client-instance:test',
  });
}

function verified(overrides = {}) {
  return {
    verified: true,
    requesterBound: true,
    singleUse: true,
    approvalBound: true,
    policySnapshotDigest: POLICY_DIGEST,
    ...overrides,
  };
}

async function start(t, options = {}) {
  const logs = [];
  const config = options.config || testConfig();
  const app = createApp({
    config,
    now: () => new Date(NOW),
    logger: {
      info(entry) {
        logs.push(entry);
      },
      error(entry) {
        logs.push(entry);
      },
    },
    ...options,
  });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  t.after(() => new Promise((resolve) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
  }));
  return {
    baseUrl: 'http://127.0.0.1:' + server.address().port,
    config,
    logs,
  };
}

async function postAction(baseUrl, actionId, body, headers = {}) {
  return fetch(baseUrl + '/api/v1/agent-actions/' + actionId, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('serves canonical discovery with strong validators and deprecated aliases', async (t) => {
  const { baseUrl } = await start(t);
  const response = await fetch(baseUrl + '/agents.json');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('permissions-policy'), /camera=\(\)/);
  const etag = response.headers.get('etag');
  assert.match(etag, /^"[A-Za-z0-9_-]+"$/);

  const cached = await fetch(baseUrl + '/agents.json', {
    headers: { 'if-none-match': etag },
  });
  assert.equal(cached.status, 304);

  const alias = await fetch(baseUrl + '/.well-known/agents.json');
  assert.equal(alias.status, 200);
  assert.equal(alias.headers.get('deprecation'), 'true');
  assert.equal(alias.headers.get('link'), '</agents.json>; rel="canonical"');

  const absentA2A = await fetch(baseUrl + '/.well-known/agent-card.json');
  assert.equal(absentA2A.status, 404);
  const error = await absentA2A.json();
  assert.equal(error.code, 'NOT_FOUND');
  assert.equal(Object.hasOwn(error, 'stack'), false);
});

test('executes the anonymous status action without context or receipts', async (t) => {
  const { baseUrl } = await start(t);
  const response = await postAction(baseUrl, 'site.status', { input: {} });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const document = await response.json();
  assert.equal(document.status, 'completed');
  assert.deepEqual(document.receipts, []);
  assert.equal(document.result.context_layer.conformance, 'not-claimed');
});

test('context-free actions reject unexpected context bundles before execution', async (t) => {
  const { baseUrl, logs } = await start(t);
  const privateMarker = 'synthetic-private-context-marker';
  const response = await postAction(baseUrl, 'site.status', {
    input: {},
    context_bundle: {
      password: privateMarker,
      context: [{ value: privateMarker }],
    },
  });
  assert.equal(response.status, 422);
  const error = await response.json();
  assert.equal(error.code, 'CONTEXT_BUNDLE_NOT_ALLOWED');
  assert.equal(JSON.stringify(error).includes(privateMarker), false);
  assert.equal(JSON.stringify(logs).includes(privateMarker), false);
});

test('protected actions fail closed when authentication is not configured', async (t) => {
  const config = testConfig();
  const { baseUrl } = await start(t, { config });
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundleFor(config) },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(response.status, 503);
  const error = await response.json();
  assert.equal(error.code, 'AUTHENTICATION_UNAVAILABLE');
  assert.equal(JSON.stringify(error).includes('approved-private-value'), false);
});

test('protected actions reject malformed or anonymous authenticator identities', async (t) => {
  const config = testConfig();
  const identities = [
    null,
    {},
    {
      principal: 'untrusted_anonymous',
      authenticated_by: 'explicit_anonymous_class',
      client_instance: 'urn:aaa:client-instance:test',
    },
    {
      principal: 'urn:aaa:client:test',
      authenticated_by: 'explicit_anonymous_class',
      client_instance: 'urn:aaa:client-instance:test',
    },
    {
      principal: 'urn:aaa:client:test',
      authenticated_by: 'test',
    },
    {
      principal: 'not a stable id',
      authenticated_by: 'test',
      client_instance: 'urn:aaa:client-instance:test',
    },
  ];
  let verifierCalls = 0;
  const receiptStore = new InMemoryReceiptStore();
  const { baseUrl } = await start(t, {
    config,
    authenticator: async () => identities.shift(),
    verifyBundle: async () => {
      verifierCalls += 1;
      return verified();
    },
    receiptStore,
  });

  for (let index = 0; index < 6; index += 1) {
    const response = await postAction(
      baseUrl,
      'context.inspect',
      { input: {}, context_bundle: bundleFor(config) },
      { 'context-layer-version': '0.1-draft' },
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'AUTHENTICATION_INCOMPLETE');
  }
  assert.equal(verifierCalls, 0);
  assert.equal(receiptStore.list().length, 0);
});

test('executes a bound protected action with a narrowed handler view and durable receipts', async (t) => {
  const config = testConfig();
  const receiptStore = new InMemoryReceiptStore();
  let handlerBundle;
  const { baseUrl } = await start(t, {
    config,
    authenticator,
    verifyBundle: async (bundle, context) => {
      assert.equal(context.identity.principal, 'urn:aaa:client:test');
      assert.equal(bundle.recipient, config.agent.recipient);
      return verified();
    },
    receiptStore,
    handlers: {
      'context.inspect': async ({ context, bundle }) => {
        handlerBundle = bundle;
        assert.equal(context[0].predicate, 'project.summary');
        return {
          accepted: true,
          note: 'Protected context was used locally and omitted from the response.',
        };
      },
    },
  });
  const bundle = bundleFor(config);
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundle },
    { 'context-layer-version': '0.1-draft', 'idempotency-key': 'http-test-1' },
  );
  assert.equal(response.status, 200);
  const document = await response.json();
  assert.equal(document.receipts.length, 2);
  assert.equal(JSON.stringify(document).includes(bundle.context[0].claim), false);
  assert.equal(JSON.stringify(document).includes(bundle.context[0].value), false);

  assert.deepEqual(handlerBundle.capabilities, ['context.inspect']);
  assert.equal(Object.hasOwn(handlerBundle, 'issuer'), false);
  assert.equal(Object.hasOwn(handlerBundle, 'provenance'), false);

  const receipts = receiptStore.list();
  assert.equal(receipts.length, 2);
  assert.equal(receipts.every((receipt) => receipt.payload_included === false), true);
  assert.equal(JSON.stringify(receipts).includes(bundle.context[0].value), false);

  const replay = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundle },
    { 'context-layer-version': '0.1-draft', 'idempotency-key': 'http-test-1' },
  );
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).code, 'BUNDLE_REPLAYED');
  assert.equal(receiptStore.list().length, 2);
});

test('rejects verifier output that does not attest caller binding', async (t) => {
  const config = testConfig();
  const receiptStore = new InMemoryReceiptStore();
  const { baseUrl } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => verified({ requesterBound: false }),
    receiptStore,
  });
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundleFor(config) },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'BUNDLE_VERIFICATION_INCOMPLETE');
  assert.equal(receiptStore.list().length, 0);
});

test('rejects exact-purpose mismatch before bundle verification', async (t) => {
  const config = testConfig();
  let verifierCalled = false;
  const bundle = bundleFor(config);
  bundle.purpose = 'perform a different task';
  const { baseUrl } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => {
      verifierCalled = true;
      return verified();
    },
    receiptStore: new InMemoryReceiptStore(),
  });
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundle },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'BUNDLE_PURPOSE_MISMATCH');
  assert.equal(verifierCalled, false);
});

test('blocks forbidden context echo and records a minimized failure receipt', async (t) => {
  const config = testConfig();
  const receiptStore = new InMemoryReceiptStore();
  const bundle = bundleFor(config);
  const { baseUrl, logs } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore,
    handlers: {
      'context.inspect': async ({ context }) => ({ leaked: context[0].value }),
    },
  });
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundle },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(response.status, 500);
  const error = await response.json();
  assert.equal(error.code, 'ACTION_OUTPUT_RESTRICTED');
  assert.equal(JSON.stringify(error).includes(bundle.context[0].value), false);
  assert.equal(JSON.stringify(logs).includes(bundle.context[0].value), false);

  const receipts = receiptStore.list();
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].outcome, 'failure');
  assert.equal(JSON.stringify(receipts).includes(bundle.context[0].value), false);
});

test('blocks claim metadata when onward disclosure is forbidden', async (t) => {
  const config = testConfig();
  const receiptStore = new InMemoryReceiptStore();
  const bundle = bundleFor(config);
  const { baseUrl } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore,
    handlers: {
      'context.inspect': async ({ context }) => ({
        exposed_predicate: context[0].predicate,
        exposed_confidence: context[0].confidence,
      }),
    },
  });
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundle },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'ACTION_OUTPUT_RESTRICTED');
  assert.equal(receiptStore.list()[1].outcome, 'failure');
});

test('blocks nested leaves from context with forbidden onward disclosure', async (t) => {
  const config = testConfig();
  const receiptStore = new InMemoryReceiptStore();
  const bundle = bundleFor(config);
  bundle.context[0].value = {
    summary: {
      detail: 'nested-private-leaf',
    },
  };
  const { baseUrl, logs } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore,
    handlers: {
      'context.inspect': async ({ context }) => ({
        leaked: context[0].value.summary.detail,
      }),
    },
  });
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundle },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(response.status, 500);
  const error = await response.json();
  assert.equal(error.code, 'ACTION_OUTPUT_RESTRICTED');
  assert.equal(JSON.stringify(error).includes('nested-private-leaf'), false);
  assert.equal(JSON.stringify(logs).includes('nested-private-leaf'), false);
  assert.equal(JSON.stringify(receiptStore.list()).includes('nested-private-leaf'), false);
  assert.equal(receiptStore.list()[1].outcome, 'failure');
});

test('blocks restricted context leaves used as output property names', async (t) => {
  const config = testConfig();
  const receiptStore = new InMemoryReceiptStore();
  const bundle = bundleFor(config);
  bundle.context[0].value = {
    summary: {
      detail: 'nested-private-key',
    },
  };
  const { baseUrl } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore,
    handlers: {
      'context.inspect': async ({ context }) => ({
        [context[0].value.summary.detail]: true,
      }),
    },
  });
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundle },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(response.status, 500);
  const error = await response.json();
  assert.equal(error.code, 'ACTION_OUTPUT_RESTRICTED');
  assert.equal(JSON.stringify(error).includes('nested-private-key'), false);
  assert.equal(JSON.stringify(receiptStore.list()).includes('nested-private-key'), false);
});

test('side-effecting actions require and atomically reserve caller-scoped idempotency keys', async (t) => {
  const config = testConfig();
  const action = config.actions.find((entry) => entry.id === 'context.inspect');
  action.side_effect = 'reversible';
  action.human_confirmation = 'required';

  const receiptStore = new InMemoryReceiptStore();
  let handlerCalls = 0;
  const { baseUrl } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore,
    handlers: {
      'context.inspect': async () => {
        handlerCalls += 1;
        return { accepted: true };
      },
    },
  });

  const missing = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundleFor(config, { id: 'urn:cl:bundle:effect-missing' }) },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(handlerCalls, 0);

  const headers = {
    'context-layer-version': '0.1-draft',
    'idempotency-key': 'effect-key-001',
  };
  const first = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundleFor(config, { id: 'urn:cl:bundle:effect-one' }) },
    headers,
  );
  assert.equal(first.status, 200);
  assert.equal(handlerCalls, 1);
  assert.equal(receiptStore.list().length, 2);

  const replay = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundleFor(config, { id: 'urn:cl:bundle:effect-two' }) },
    headers,
  );
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).code, 'IDEMPOTENCY_REPLAYED');
  assert.equal(handlerCalls, 1);
  assert.equal(receiptStore.list().length, 2);
});

test('side-effecting handler exceptions are recorded and returned as indeterminate', async (t) => {
  const config = testConfig();
  const action = config.actions.find((entry) => entry.id === 'context.inspect');
  action.side_effect = 'reversible';
  action.human_confirmation = 'required';

  const receiptStore = new InMemoryReceiptStore();
  let effects = 0;
  const { baseUrl } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore,
    handlers: {
      'context.inspect': async () => {
        effects += 1;
        throw new Error('synthetic post-effect failure');
      },
    },
  });
  const headers = {
    'context-layer-version': '0.1-draft',
    'idempotency-key': 'effect-error-001',
  };
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundleFor(config, { id: 'urn:cl:bundle:effect-error-one' }) },
    headers,
  );
  assert.equal(response.status, 500);
  const error = await response.json();
  assert.equal(error.code, 'ACTION_OUTCOME_INDETERMINATE');
  assert.equal(error.indeterminate, true);
  assert.equal(effects, 1);
  assert.equal(receiptStore.list().length, 2);
  assert.equal(receiptStore.list()[1].outcome, 'indeterminate');

  const replay = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundleFor(config, { id: 'urn:cl:bundle:effect-error-two' }) },
    headers,
  );
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).code, 'IDEMPOTENCY_REPLAYED');
  assert.equal(effects, 1);
});

test('standalone action gateway validates injected safety policy before mounting', () => {
  const config = testConfig();
  config.actions.find((action) => action.id === 'context.inspect').auth = 'anonymous';
  assert.throws(
    () => createActionGateway({ config }),
    (error) => error.code === 'CONFIG_INVALID',
  );
});

test('development verifier binds one exact configured non-anonymous principal', async () => {
  const verifier = createDevelopmentBundleVerifier({
    enabled: true,
    trustedIssuers: [validBundle.issuer.id],
    expectedPrincipal: 'urn:aaa:client:test',
  });
  for (const identity of [
    {
      principal: 'untrusted_anonymous',
      authenticated_by: 'explicit_anonymous_class',
    },
    {
      principal: 'urn:aaa:client:other',
      authenticated_by: 'test',
    },
  ]) {
    await assert.rejects(
      verifier(validBundle, { identity }),
      (error) => error.code === 'BUNDLE_VERIFICATION_INCOMPLETE',
    );
  }

  const verification = await verifier(validBundle, {
    identity: {
      principal: 'urn:aaa:client:test',
      authenticated_by: 'test',
    },
  });
  assert.equal(verification.requesterBound, true);
  assert.match(verification.assurance, /static-principal-assumption/);
});

test('expires and revokes scoped context while an async handler is still running', async (t) => {
  const config = testConfig();
  const receiptStore = new InMemoryReceiptStore();
  let currentTime = NOW.getTime();
  let expiryCallback;
  let releaseHandler;
  let retainedContext;
  let handlerSignal;
  let markHandlerStarted;
  const handlerStarted = new Promise((resolve) => {
    markHandlerStarted = resolve;
  });

  const { baseUrl } = await start(t, {
    config,
    now: () => new Date(currentTime),
    setTimer(callback, delay) {
      assert.equal(delay, 1000);
      expiryCallback = callback;
      return { unref() {} };
    },
    clearTimer() {
      expiryCallback = null;
    },
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore,
    handlers: {
      'context.inspect': async ({ context, signal }) => {
        retainedContext = context;
        handlerSignal = signal;
        markHandlerStarted();
        return new Promise((resolve) => {
          releaseHandler = resolve;
        });
      },
    },
  });

  const request = postAction(
    baseUrl,
    'context.inspect',
    {
      input: {},
      context_bundle: bundleFor(config, {
        id: 'urn:cl:bundle:expires-during-handler',
        bundle: { expires_at: '2026-08-20T12:02:01.000Z' },
      }),
    },
    { 'context-layer-version': '0.1-draft' },
  );

  await handlerStarted;
  const expire = expiryCallback;
  assert.equal(typeof expire, 'function');
  currentTime = Date.parse('2026-08-20T12:02:01.000Z');
  expire();

  const response = await request;
  assert.equal(response.status, 410);
  const error = await response.json();
  assert.equal(error.code, 'BUNDLE_EXPIRED');
  assert.equal(error.indeterminate, false);
  assert.equal(handlerSignal.aborted, true);
  assert.throws(() => retainedContext[0].value, TypeError);
  assert.equal(receiptStore.list().length, 2);
  assert.equal(receiptStore.list()[1].outcome, 'failure');

  releaseHandler({ accepted: true });
});

test('revokes context before a delayed completion receipt without contradicting success', async (t) => {
  const config = testConfig();
  const receiptStore = new InMemoryReceiptStore();
  const appendReceipt = receiptStore.append.bind(receiptStore);
  let releaseReceipt;
  let markReceiptStarted;
  const receiptGate = new Promise((resolve) => {
    releaseReceipt = resolve;
  });
  const receiptStarted = new Promise((resolve) => {
    markReceiptStarted = resolve;
  });
  receiptStore.append = async (receipt) => {
    if (receipt.operation === 'context.inspect') {
      markReceiptStarted();
      await receiptGate;
    }
    return appendReceipt(receipt);
  };

  let currentTime = NOW.getTime();
  let expiryCallback;
  let timerCleared = false;
  let retainedContext;
  let handlerSignal;
  const { baseUrl } = await start(t, {
    config,
    now: () => new Date(currentTime),
    setTimer(callback, delay) {
      assert.equal(delay, 1000);
      expiryCallback = callback;
      return { unref() {} };
    },
    clearTimer() {
      timerCleared = true;
      expiryCallback = null;
    },
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore,
    handlers: {
      'context.inspect': async ({ context, signal }) => {
        retainedContext = context;
        handlerSignal = signal;
        return { accepted: true };
      },
    },
  });

  const request = postAction(
    baseUrl,
    'context.inspect',
    {
      input: {},
      context_bundle: bundleFor(config, {
        id: 'urn:cl:bundle:expires-during-receipt',
        bundle: { expires_at: '2026-08-20T12:02:01.000Z' },
      }),
    },
    { 'context-layer-version': '0.1-draft' },
  );

  await receiptStarted;
  assert.equal(timerCleared, true);
  assert.equal(expiryCallback, null);
  assert.equal(handlerSignal.aborted, true);
  assert.equal(handlerSignal.reason.code, 'CONTEXT_ACCESSOR_DISPOSED');
  assert.throws(() => retainedContext[0].value, TypeError);

  currentTime = Date.parse('2026-08-20T12:02:01.000Z');
  releaseReceipt();

  const response = await request;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'completed');
  assert.equal(receiptStore.list().length, 2);
  assert.equal(receiptStore.list()[1].outcome, 'success');
});

test('validates action output schemas before reporting success', async (t) => {
  const config = testConfig();
  const receiptStore = new InMemoryReceiptStore();
  const { baseUrl } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore,
    handlers: {
      'context.inspect': async () => 'not-an-object',
    },
  });
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundleFor(config) },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'ACTION_OUTPUT_INVALID');
  assert.equal(receiptStore.list()[1].outcome, 'failure');
});

test('rejects cyclic handler results before restriction scanning or receipt success', async (t) => {
  const config = testConfig();
  const receiptStore = new InMemoryReceiptStore();
  const { baseUrl } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore,
    handlers: {
      'context.inspect': async () => {
        const result = { accepted: true };
        result.self = result;
        return result;
      },
    },
  });
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundleFor(config) },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'ACTION_OUTPUT_INVALID');
  assert.equal(receiptStore.list().length, 2);
  assert.equal(receiptStore.list()[1].outcome, 'failure');
});

test('fails before protected execution when the required receipt store is unavailable', async (t) => {
  const config = testConfig();
  let handlerCalled = false;
  const { baseUrl } = await start(t, {
    config,
    authenticator,
    verifyBundle: async () => verified(),
    receiptStore: new InMemoryReceiptStore({ available: false }),
    handlers: {
      'context.inspect': async () => {
        handlerCalled = true;
        return {};
      },
    },
  });
  const response = await postAction(
    baseUrl,
    'context.inspect',
    { input: {}, context_bundle: bundleFor(config) },
    { 'context-layer-version': '0.1-draft' },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'RECEIPT_STORE_UNAVAILABLE');
  assert.equal(handlerCalled, false);
});

test('returns safe errors for malformed JSON, bad origins, media types, and inputs', async (t) => {
  const { baseUrl } = await start(t);

  const malformed = await postAction(baseUrl, 'site.status', '{"input":');
  assert.equal(malformed.status, 400);
  const malformedBody = await malformed.json();
  assert.equal(malformedBody.code, 'INVALID_JSON');
  assert.equal(Object.hasOwn(malformedBody, 'stack'), false);

  const origin = await postAction(
    baseUrl,
    'site.status',
    { input: {} },
    { origin: 'https://attacker.invalid' },
  );
  assert.equal(origin.status, 403);
  assert.equal((await origin.json()).code, 'ORIGIN_NOT_ALLOWED');

  const mediaType = await fetch(baseUrl + '/api/v1/agent-actions/site.status', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(mediaType.status, 415);
  assert.equal((await mediaType.json()).code, 'UNSUPPORTED_MEDIA_TYPE');

  const invalidInput = await postAction(baseUrl, 'site.status', {
    input: { unexpected: true },
  });
  assert.equal(invalidInput.status, 422);
  assert.equal((await invalidInput.json()).code, 'ACTION_INPUT_INVALID');

  const invalidRequest = await postAction(baseUrl, 'site.status', {
    input: {},
    unexpected: true,
  });
  assert.equal(invalidRequest.status, 422);
  assert.equal((await invalidRequest.json()).code, 'ACTION_REQUEST_INVALID');
});
