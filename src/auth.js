'use strict';

const crypto = require('node:crypto');
const { AgentAwareError } = require('./errors');

function createBearerAuthenticator(options = {}) {
  const token = options.token;
  const principal = options.principal || 'urn:aaa:client:local';
  const clientInstance = options.clientInstance || 'urn:aaa:client-instance:local';

  if (typeof token !== 'string' || token.length < 16) {
    return async function unavailableAuthenticator() {
      throw new AgentAwareError(
        'AUTHENTICATION_UNAVAILABLE',
        'Protected agent actions are unavailable because authentication is not configured.',
        { status: 503, retryable: true },
      );
    };
  }

  const expected = Buffer.from(token);
  return async function authenticateBearer(request) {
    const header = request.get('authorization') || '';
    const match = /^Bearer ([^\s]+)$/i.exec(header);
    if (!match) {
      throw new AgentAwareError(
        'AUTHENTICATION_REQUIRED',
        'A bearer credential is required for this action.',
        { status: 401 },
      );
    }

    const actual = Buffer.from(match[1]);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw new AgentAwareError(
        'AUTHENTICATION_INVALID',
        'The supplied credential is not valid for this action.',
        { status: 401 },
      );
    }

    return {
      principal,
      authenticated_by: 'bearer',
      client_instance: clientInstance,
    };
  };
}

function createDevelopmentBundleVerifier(options = {}) {
  const trustedIssuers = new Set(options.trustedIssuers || []);
  const enabled = options.enabled === true;
  const expectedPrincipal = options.expectedPrincipal;

  return async function verifyDevelopmentBundle(bundle, context = {}) {
    if (!enabled || trustedIssuers.size === 0) {
      throw new AgentAwareError(
        'BUNDLE_VERIFICATION_UNAVAILABLE',
        'Protected context cannot be used because bundle verification is not configured.',
        { status: 503, retryable: true },
      );
    }

    if (!bundle.issuer || !trustedIssuers.has(bundle.issuer.id)) {
      throw new AgentAwareError(
        'BUNDLE_ISSUER_UNTRUSTED',
        'The context bundle issuer is not trusted by this deployment.',
        { status: 403 },
      );
    }

    if (
      !context.identity
      || typeof context.identity.principal !== 'string'
      || typeof expectedPrincipal !== 'string'
      || expectedPrincipal.length < 3
      || context.identity.principal !== expectedPrincipal
      || context.identity.principal === 'untrusted_anonymous'
      || context.identity.authenticated_by === 'explicit_anonymous_class'
    ) {
      throw new AgentAwareError(
        'BUNDLE_VERIFICATION_INCOMPLETE',
        'The development verifier requires the exact configured non-anonymous caller.',
        { status: 503, retryable: true },
      );
    }

    return {
      verified: true,
      assurance: 'development-issuer-allowlist-static-principal-assumption',
      policySnapshotDigest: sha256(bundle.decision_ref),
      singleUse: false,
      approvalBound: false,
      requesterBound: true,
    };
  };
}

function sha256(value) {
  return 'sha256:' + crypto.createHash('sha256').update(String(value)).digest('hex');
}

function parseTrustedIssuers(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

module.exports = {
  createBearerAuthenticator,
  createDevelopmentBundleVerifier,
  parseTrustedIssuers,
};
