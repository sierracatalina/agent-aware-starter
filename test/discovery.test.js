'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadConfig, validateConfig } = require('../src/config');
const { renderDiscovery, writeDiscovery } = require('../src/discovery');

const config = loadConfig({ env: {} });
const canonicalPaths = [
  '/robots.txt',
  '/llms.txt',
  '/agents.txt',
  '/agents.json',
  '/agent-manifest.json',
  '/context-layer-conformance.json',
  '/agent-hints.json',
  '/.well-known/context-layer',
  '/openapi.json',
];
const aliasPaths = [
  '/.well-known/llms.txt',
  '/.well-known/agents.json',
  '/.well-known/ai-instructions.json',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

test('renders canonical paths and deprecated aliases', () => {
  const artifacts = renderDiscovery(config);
  for (const routePath of canonicalPaths) {
    assert.ok(artifacts[routePath], 'missing ' + routePath);
    assert.equal(artifacts[routePath].canonicalPath, routePath);
    assert.equal(artifacts[routePath].deprecated, false);
  }
  for (const routePath of aliasPaths) {
    assert.ok(artifacts[routePath], 'missing ' + routePath);
    assert.equal(artifacts[routePath].deprecated, true);
  }
  assert.equal(artifacts['/.well-known/llms.txt'].canonicalPath, '/llms.txt');
  assert.equal(artifacts['/.well-known/agents.json'].canonicalPath, '/agents.json');
  assert.equal(artifacts['/.well-known/ai-instructions.json'].canonicalPath, '/agent-hints.json');
});

test('descriptors contain correct MIME, cache, CORS, and body fields', () => {
  const artifacts = renderDiscovery(config);
  for (const [routePath, artifact] of Object.entries(artifacts)) {
    const mime = routePath.endsWith('.txt')
      ? 'text/plain; charset=utf-8'
      : 'application/json; charset=utf-8';
    assert.equal(artifact.contentType, mime, routePath);
    assert.equal(artifact.cacheControl, 'public, max-age=' + config.discovery.cache_seconds);
    assert.equal(artifact.headers['Access-Control-Allow-Origin'], '*');
    assert.equal(typeof artifact.body, 'string');
  }
});

test('rendering and generated file output are deterministic', () => {
  assert.deepEqual(renderDiscovery(config), renderDiscovery(config));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aaa-discovery-'));
  try {
    const first = writeDiscovery(config, outputDir);
    const firstBodies = first.map((filePath) => fs.readFileSync(filePath, 'utf8'));
    const second = writeDiscovery(config, outputDir);
    assert.deepEqual(first, second);
    assert.deepEqual(firstBodies, second.map((filePath) => fs.readFileSync(filePath, 'utf8')));
  } finally {
    fs.rmSync(outputDir, { force: true, recursive: true });
  }
});

test('resource links resolve and placeholder links are absent', () => {
  const artifacts = renderDiscovery(config);
  for (const resource of config.discovery.resources) {
    assert.ok(artifacts[resource.path], resource.path + ' is not generated');
  }
  const bodies = Object.values(artifacts).map((artifact) => artifact.body).join('\n');
  assert.doesNotMatch(bodies, /example\.com|\/docs\b|\/api-docs\b|\/pricing\b/);
  assert.doesNotMatch(bodies, /\[(?:Project|Action|Category|Definition|Site) [A-Z]\]/);
});

test('disabled MCP and A2A are not advertised', () => {
  const artifacts = renderDiscovery(config);
  const agentsText = artifacts['/agents.txt'].body;
  const agentsJson = JSON.parse(artifacts['/agents.json'].body);
  const manifest = JSON.parse(artifacts['/agent-manifest.json'].body);
  assert.doesNotMatch(agentsText, /^(?:MCP|A2A):/m);
  assert.equal(Object.hasOwn(agentsJson, 'mcp'), false);
  assert.equal(Object.hasOwn(agentsJson, 'a2a'), false);
  assert.deepEqual(manifest.protocols, []);
  assert.equal(Object.hasOwn(artifacts, '/.well-known/agent-card.json'), false);
  assert.deepEqual(agentsJson.authorization, {
    protocols: ['x-context-layer'],
    discovery: '/.well-known/context-layer',
  });
});

test('A2A requires an enabled real interface before publication', () => {
  const missingInterface = clone(config);
  missingInterface.protocols.a2a.enabled = true;
  assert.throws(() => validateConfig(missingInterface), { code: 'CONFIG_INVALID' });

  const configured = clone(config);
  configured.protocols.a2a = {
    enabled: true,
    interface: 'https://sierracatalina.com/a2a',
  };
  const artifacts = renderDiscovery(configured);
  assert.ok(artifacts['/.well-known/agent-card.json']);
  assert.match(
    artifacts['/agents.txt'].body,
    /^A2A: https:\/\/sierracatalina\.com\/\.well-known\/agent-card\.json$/m,
  );
});

test('configuration rejects credential-bearing or insecure public protocol URLs', () => {
  for (const origin of [
    'https://user:pass@sierracatalina.com',
    'https://sierracatalina.com/path',
    'http://example.com',
  ]) {
    const candidate = clone(config);
    candidate.site.origin = origin;
    assert.throws(() => validateConfig(candidate), { code: 'CONFIG_INVALID' });
  }

  const unsafeMcp = clone(config);
  unsafeMcp.protocols.mcp = {
    enabled: true,
    endpoint: 'javascript:alert(1)',
  };
  assert.throws(() => validateConfig(unsafeMcp), { code: 'CONFIG_INVALID' });

  const insecureA2A = clone(config);
  insecureA2A.protocols.a2a = {
    enabled: true,
    interface: 'http://127.0.0.1:4000/a2a',
  };
  assert.throws(() => validateConfig(insecureA2A), { code: 'CONFIG_INVALID' });

  const local = clone(config);
  local.site.origin = 'http://127.0.0.1:3000';
  assert.equal(validateConfig(local), local);
});
test('configuration rejects anonymous context and unguarded side effects', () => {
  const anonymousContext = clone(config);
  anonymousContext.actions.find((action) => action.id === 'context.inspect').auth = 'anonymous';
  assert.throws(() => validateConfig(anonymousContext), { code: 'CONFIG_INVALID' });

  const unsafeEffect = clone(config);
  unsafeEffect.actions.find((action) => action.id === 'site.status').side_effect = 'irreversible';
  assert.throws(() => validateConfig(unsafeEffect), { code: 'CONFIG_INVALID' });

  const zeroRetention = clone(config);
  zeroRetention.actions
    .find((action) => action.id === 'context.inspect')
    .context.max_retention_seconds = 0;
  assert.throws(() => validateConfig(zeroRetention), { code: 'CONFIG_INVALID' });

  const safeEffect = clone(config);
  const action = safeEffect.actions.find((entry) => entry.id === 'context.inspect');
  action.side_effect = 'reversible';
  action.human_confirmation = 'required';
  assert.equal(validateConfig(safeEffect), safeEffect);
});

test('non-context actions cannot advertise unenforced context controls', () => {
  const mutations = [
    (context, action) => { action.human_confirmation = 'required'; },
    (context) => { context.receipt_required = true; },
    (context) => { context.selectors = ['project.summary']; },
    (context) => { context.purposes = ['inspect approved project context']; },
    (context) => { context.max_retention_seconds = 60; },
  ];

  for (const mutate of mutations) {
    const candidate = clone(config);
    const action = candidate.actions.find((entry) => entry.id === 'site.status');
    mutate(action.context, action);
    assert.throws(() => validateConfig(candidate), { code: 'CONFIG_INVALID' });
  }
});

test('configuration rejects asynchronous input and output schemas', () => {
  for (const schemaField of ['input_schema', 'output_schema']) {
    const candidate = clone(config);
    candidate.actions.find((action) => action.id === 'site.status')[schemaField] = {
      $async: true,
      type: 'object',
      required: ['required_field'],
    };
    assert.throws(
      () => validateConfig(candidate),
      (error) => error.code === 'CONFIG_INVALID' && /\$async/.test(error.message),
    );
  }
});

test('configuration rejects unknown action schema keywords', () => {
  for (const schemaField of ['input_schema', 'output_schema']) {
    const candidate = clone(config);
    candidate.actions.find((action) => action.id === 'site.status')[schemaField] = {
      type: 'object',
      additionalProperty: false,
    };
    assert.throws(() => validateConfig(candidate), { code: 'CONFIG_INVALID' });
  }
});

test('configuration rejects primitive action schema roots', () => {
  for (const schemaField of ['input_schema', 'output_schema']) {
    const candidate = clone(config);
    candidate.actions.find((action) => action.id === 'site.status')[schemaField] = {
      type: 'string',
    };
    assert.throws(() => validateConfig(candidate), { code: 'CONFIG_INVALID' });
  }
});

test('OpenAPI declares conditional auth, Context Layer, idempotency, and media contracts', () => {
  const openapi = JSON.parse(renderDiscovery(config)['/openapi.json'].body);
  assert.equal(openapi.components.securitySchemes.bearerAuth.scheme, 'bearer');
  const operation = openapi.paths['/api/v1/agent-actions/{actionId}'].post;
  assert.deepEqual(operation.security, [{ bearerAuth: [] }, {}]);
  assert.deepEqual(
    operation.parameters.map((parameter) => parameter.name),
    ['actionId', 'Context-Layer-Version', 'Idempotency-Key'],
  );
  assert.ok(operation.requestBody.content['application/json']);
  assert.ok(operation.requestBody.content['application/vnd.context-layer+json']);
  assert.deepEqual(operation['x-agent-aware-action-policies']['context.inspect'], {
    authentication: 'required',
    context_required: true,
    context_layer_version_required: true,
    idempotency_key_required: false,
    side_effect: 'none',
    human_confirmation: 'never',
    receipt_required: true,
  });
});

test('public JSON artifacts contain no secret-like fields or private payloads', () => {
  const forbidden = /(?:password|secret|api[_-]?key|access[_-]?token|private[_-]?(?:data|context|payload))/i;
  for (const [routePath, artifact] of Object.entries(renderDiscovery(config))) {
    if (!artifact.contentType.startsWith('application/json')) continue;
    const document = JSON.parse(artifact.body);
    assert.equal(
      collectKeys(document).some((key) => forbidden.test(key)),
      false,
      routePath + ' contains a forbidden public field',
    );
    assert.doesNotMatch(JSON.stringify(document), /Bearer\s+[A-Za-z0-9._~-]+/i);
  }
});

test('manifests state metadata authority and Context Layer status honestly', () => {
  const artifacts = renderDiscovery(config);
  assert.match(artifacts['/llms.txt'].body, /not authorization/i);
  assert.match(artifacts['/agent-manifest.json'].body, /not authorization/i);
  assert.match(artifacts['/agent-hints.json'].body, /not authorization/i);

  const contextLayer = JSON.parse(artifacts['/.well-known/context-layer'].body);
  assert.equal(contextLayer.spec_version, 'context-layer/0.1-draft');
  assert.equal(contextLayer.implementation_status, 'consumer-candidate');
  assert.equal(contextLayer.conformance, 'not-claimed');
  assert.deepEqual(contextLayer.roles.claimed, []);
  assert.equal(contextLayer.conformance_report, '/context-layer-conformance.json');
  const report = JSON.parse(artifacts['/context-layer-conformance.json'].body);
  assert.equal(report.status, 'not-claimed');
  assert.deepEqual(report.claimed_roles, []);
  assert.equal(report.candidate_roles.includes('CL-Core-Consumer'), true);
  assert.match(contextLayer.notice, /conformance is not claimed/i);
});
