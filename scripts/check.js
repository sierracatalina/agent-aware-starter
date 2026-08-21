'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { loadConfig } = require('../src/config');
const { renderDiscovery } = require('../src/discovery');

const root = path.resolve(__dirname, '..');
const generatedRoot = path.join(root, 'public', 'generated');
const config = loadConfig({ env: {} });
const rendered = renderDiscovery(config);
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);

for (const schemaName of [
  'scoped-context-bundle.schema.json',
  'receipt.schema.json',
  'memory-update-proposal.schema.json',
]) {
  const schemaPath = path.join(root, 'schemas', 'context-layer', schemaName);
  ajv.compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
}

const expectedFiles = new Set();
for (const [routePath, descriptor] of Object.entries(rendered)) {
  const relativePath = routePath.replace(/^\/+/, '');
  const targetPath = path.resolve(generatedRoot, relativePath);
  assert.equal(
    targetPath === generatedRoot || targetPath.startsWith(generatedRoot + path.sep),
    true,
    'generated discovery path escapes its root: ' + routePath,
  );
  expectedFiles.add(path.relative(generatedRoot, targetPath).split(path.sep).join('/'));
  assert.equal(
    fs.readFileSync(targetPath, 'utf8'),
    descriptor.body,
    'generated discovery is stale: ' + relativePath,
  );
  if (descriptor.contentType.startsWith('application/json')) {
    const document = JSON.parse(descriptor.body);
    assertPublicDocument(document, routePath);
  }
}

const actualFiles = new Set(listFiles(generatedRoot));
assert.deepEqual(
  [...actualFiles].sort(),
  [...expectedFiles].sort(),
  'public/generated contains stale or missing discovery artifacts',
);

for (const requiredPath of [
  'pnpm-lock.yaml',
  'README.md',
  'SECURITY.md',
  'docs/architecture.md',
  'docs/conformance.md',
  'schemas/agent-aware/config.schema.json',
]) {
  assert.equal(fs.existsSync(path.join(root, requiredPath)), true, 'missing ' + requiredPath);
}

const patchArtifacts = listFiles(root, {
  skip: new Set(['.git', 'node_modules', 'public/generated']),
}).filter((filePath) => /\.(?:orig|rej)$/.test(filePath));
assert.deepEqual(patchArtifacts, [], 'patch artifacts must not be committed');

const combinedDiscovery = Object.values(rendered)
  .map((descriptor) => descriptor.body)
  .join('\n');
if (!config.protocols.mcp.enabled) {
  assert.doesNotMatch(combinedDiscovery, /"(?:mcp)"\s*:/i);
}
if (!config.protocols.a2a.enabled) {
  assert.equal(Object.hasOwn(rendered, '/.well-known/agent-card.json'), false);
}

process.stdout.write(
  'Static checks passed: config, 3 Context Layer schemas, '
  + expectedFiles.size
  + ' generated artifacts, and secret-safe discovery.\n',
);

function listFiles(directory, options = {}, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(prefix, entry.name);
    const normalized = relativePath.split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (options.skip && options.skip.has(normalized)) continue;
      files.push(...listFiles(path.join(directory, entry.name), options, relativePath));
    } else if (entry.isFile()) {
      files.push(normalized);
    }
  }
  return files;
}

function assertPublicDocument(value, routePath) {
  const forbiddenKey = /^(?:access[_-]?token|api[_-]?key|client[_-]?secret|cookie|credential|password|private[_-]?key|raw[_-]?(?:payload|source)|refresh[_-]?token|session[_-]?token)$/i;
  const credentialValue = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b|\b(?:sk|rk|pk)_(?:live|prod)_[A-Za-z0-9_-]{12,}\b)/i;

  visit(value, '$');

  function visit(current, currentPath) {
    if (typeof current === 'string') {
      assert.doesNotMatch(current, credentialValue, routePath + ' contains a credential-like value');
      return;
    }
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, currentPath + '[' + index + ']'));
      return;
    }
    for (const [key, nested] of Object.entries(current)) {
      assert.equal(forbiddenKey.test(key), false, routePath + ' contains ' + currentPath + '.' + key);
      visit(nested, currentPath + '.' + key);
    }
  }
}
