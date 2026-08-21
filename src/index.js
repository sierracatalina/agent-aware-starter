'use strict';

const { createActionGateway } = require('./action-gateway');
const {
  createApp,
  createAgentAwareRouter,
  createErrorHandler,
  securityHeaders,
  validateOrigin,
} = require('./app');
const {
  createBearerAuthenticator,
  createDevelopmentBundleVerifier,
  parseTrustedIssuers,
} = require('./auth');
const { loadConfig, validateConfig } = require('./config');
const {
  AgentAwareError,
  asAgentAwareError,
  errorDocument,
} = require('./errors');
const contextLayer = require('./context-layer');
const discovery = require('./discovery');

module.exports = {
  AgentAwareError,
  asAgentAwareError,
  createActionGateway,
  createAgentAwareRouter,
  createApp,
  createBearerAuthenticator,
  createDevelopmentBundleVerifier,
  createErrorHandler,
  errorDocument,
  loadConfig,
  parseTrustedIssuers,
  securityHeaders,
  validateConfig,
  validateOrigin,
  ...contextLayer,
  ...discovery,
};
