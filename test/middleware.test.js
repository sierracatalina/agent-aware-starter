'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const agentHandler = require('../middleware/agent-handler');
const { createApp, loadConfig } = require('../src');

function testConfig() {
  return loadConfig({
    env: {},
    publicOrigin: 'http://127.0.0.1',
  });
}

function plainExpress(middleware) {
  const app = express();
  app.use(middleware);
  return app;
}

async function start(t, app) {
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  t.after(() => new Promise((resolve) => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => resolve());
  }));
  return 'http://127.0.0.1:' + server.address().port;
}

async function postRaw(baseUrl, body, contentType = 'application/json') {
  return fetch(baseUrl + '/api/v1/agent-actions/site.status', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

async function assertSafeError(response, expected) {
  assert.equal(response.status, expected.status);
  assert.match(response.headers.get('content-type'), /^application\/json\b/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');

  const source = await response.text();
  assert.doesNotMatch(source, /<!doctype|<html|<pre>/i);
  assert.doesNotMatch(source, /(?:[A-Za-z]:\\|\/(?:home|mnt|Users|workspace)\/)/);
  assert.doesNotMatch(source, /\bat\s+\S+\s+\([^)]*\)/);

  const document = JSON.parse(source);
  assert.equal(document.schema_version, 'aaa/1.0-draft');
  assert.equal(document.type, 'error');
  assert.equal(document.code, expected.code);
  assert.equal(document.message, expected.message);
  assert.equal(document.retryable, false);
  assert.equal(document.indeterminate, false);
  assert.equal(Object.hasOwn(document, 'stack'), false);
  assert.equal(Object.hasOwn(document, 'path'), false);
  assert.match(document.id, /^urn:aaa:error:[0-9a-f-]+$/);
  assert.match(document.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(document.issuer, {
    id: 'urn:aaa:agent:site-orchestrator',
  });
  return document;
}

function stableEnvelope(document) {
  const { id, created_at: createdAt, ...stable } = document;
  assert.ok(id);
  assert.ok(createdAt);
  return stable;
}

test('default legacy middleware returns the createApp JSON envelope for malformed JSON', async (t) => {
  const config = testConfig();
  const legacyUrl = await start(t, plainExpress(agentHandler));
  const appUrl = await start(t, createApp({ config }));

  const legacyResponse = await postRaw(legacyUrl, '{"input":');
  const appResponse = await postRaw(appUrl, '{"input":');

  const expected = {
    status: 400,
    code: 'INVALID_JSON',
    message: 'The request body is not valid JSON.',
  };
  const legacyDocument = await assertSafeError(legacyResponse, expected);
  const appDocument = await assertSafeError(appResponse, expected);
  assert.deepEqual(stableEnvelope(legacyDocument), stableEnvelope(appDocument));
});

test('compatibility factory contains oversized-body errors in a plain Express app', async (t) => {
  const router = agentHandler.createAgentAwareRouter({
    config: testConfig(),
    bodyLimit: '32b',
  });
  const baseUrl = await start(t, plainExpress(router));
  const response = await postRaw(
    baseUrl,
    JSON.stringify({ input: { value: 'x'.repeat(128) } }),
  );

  await assertSafeError(response, {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'The request payload exceeds the configured limit.',
  });
});

test('compatibility factory preserves successful plain Express composition', async (t) => {
  assert.equal(agentHandler.createAgentHandler, agentHandler.createAgentAwareRouter);
  const router = agentHandler.createAgentHandler({ config: testConfig() });
  const baseUrl = await start(t, plainExpress(router));
  const response = await fetch(baseUrl + '/healthz');

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json\b/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal((await response.json()).status, 'ok');
});
