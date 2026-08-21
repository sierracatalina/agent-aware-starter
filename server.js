'use strict';

const path = require('node:path');
const {
  FileReceiptStore,
  createApp,
  createBearerAuthenticator,
  createDevelopmentBundleVerifier,
  loadConfig,
  parseTrustedIssuers,
} = require('./src');

const config = loadConfig({
  publicOrigin: process.env.AAA_PUBLIC_ORIGIN,
});
const host = process.env.HOST || '127.0.0.1';
const port = parsePort(process.env.PORT || '3000');

if (!isLoopback(host) && process.env.AAA_ALLOW_NETWORK_BIND !== 'true') {
  throw new Error('Refusing a non-loopback bind without AAA_ALLOW_NETWORK_BIND=true.');
}

const receiptFile = path.resolve(
  process.env.AAA_RECEIPT_FILE || path.join(__dirname, 'var', 'receipts.jsonl'),
);
const receiptStore = new FileReceiptStore(receiptFile);
const clientPrincipal = process.env.AAA_CLIENT_PRINCIPAL || 'urn:aaa:client:local';
const authenticator = createBearerAuthenticator({
  token: process.env.AAA_API_TOKEN,
  principal: clientPrincipal,
  clientInstance: process.env.AAA_CLIENT_INSTANCE,
});
const verifyBundle = createDevelopmentBundleVerifier({
  enabled: process.env.AAA_ALLOW_UNSIGNED_BUNDLES === 'true',
  trustedIssuers: parseTrustedIssuers(process.env.AAA_TRUSTED_BUNDLE_ISSUERS),
  expectedPrincipal: clientPrincipal,
});

const app = createApp({
  config,
  authenticator,
  verifyBundle,
  receiptStore,
  allowedOrigins: parseOrigins(process.env.AAA_ALLOWED_ORIGINS),
  logger: console,
});

const server = app.listen(port, host, () => {
  console.info({
    event: 'server.started',
    origin: 'http://' + host + ':' + port,
    network_exposure: isLoopback(host) ? 'loopback' : 'explicit',
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

server.on('error', (error) => {
  console.error({
    event: 'server.error',
    code: typeof error.code === 'string' ? error.code : 'SERVER_ERROR',
  });
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) {
        console.error({ event: 'server.shutdown_failed', signal });
        process.exitCode = 1;
      }
    });
  });
}

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('PORT must be an integer from 1 through 65535.');
  }
  return parsed;
}

function isLoopback(value) {
  return value === '127.0.0.1' || value === '::1' || value === 'localhost';
}

function parseOrigins(value) {
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}
