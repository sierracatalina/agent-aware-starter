'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { createActionGateway } = require('./action-gateway');
const { loadConfig, validateConfig } = require('./config');
const { renderDiscovery } = require('./discovery');
const { AgentAwareError, asAgentAwareError, errorDocument } = require('./errors');

function createApp(options = {}) {
  const config = options.config
    ? validateConfig(options.config)
    : loadConfig({
      file: options.configFile,
      publicOrigin: options.publicOrigin,
    });
  const logger = options.logger || silentLogger();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(requestIdentity);
  app.use(securityHeaders);
  app.use(createAgentAwareRouter({ ...options, config, logger }));

  app.use((request, response, next) => {
    next(new AgentAwareError('NOT_FOUND', 'The requested resource does not exist.', {
      status: 404,
    }));
  });
  app.use(createErrorHandler(config, logger));

  return app;
}

function createAgentAwareRouter(options = {}) {
  const config = options.config
    ? validateConfig(options.config)
    : loadConfig({
      file: options.configFile,
      publicOrigin: options.publicOrigin,
    });
  const logger = options.logger || silentLogger();
  const router = express.Router();

  router.use((request, response, next) => {
    if (request.id) {
      next();
      return;
    }
    requestIdentity(request, response, next);
  });
  router.use(securityHeaders);

  mountDiscovery(router, config, logger);

  router.get('/', (request, response) => {
    response.set('Cache-Control', 'public, max-age=60');
    response.json({
      name: config.site.name,
      description: config.site.description,
      discovery: {
        agents: '/agents.json',
        capabilities: '/agent-manifest.json',
        content: '/llms.txt',
        context_layer: '/.well-known/context-layer',
      },
      notice: 'Discovery metadata is not authorization.',
    });
  });

  router.get('/healthz', (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.json({
      status: 'ok',
      schema_version: config.schema_version,
      context_layer: config.context_layer.status,
    });
  });

  router.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.use('/api', createRateLimiter(options.rateLimit));
  router.use('/api', validateOrigin(config, options.allowedOrigins));
  router.use('/api', requireJsonForMutations);
  router.use('/api', express.json({
    limit: options.bodyLimit || '64kb',
    strict: true,
    type: ['application/json', 'application/vnd.context-layer+json'],
  }));

  router.use('/api/v1/agent-actions', createActionGateway({
    config,
    authenticator: options.authenticator,
    verifyBundle: options.verifyBundle,
    receiptStore: options.receiptStore,
    handlers: options.handlers,
    now: options.now,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  }));

  return router;
}

function mountDiscovery(router, config, logger) {
  const rendered = renderDiscovery(config);
  const entries = rendered instanceof Map
    ? Array.from(rendered.entries())
    : Object.entries(rendered);

  for (const [routePath, descriptor] of entries) {
    router.get(routePath, (request, response) => {
      const body = typeof descriptor.body === 'string'
        ? descriptor.body
        : JSON.stringify(descriptor.body, null, 2) + '\n';
      const etag = strongEtag(body);

      response.set({
        'Cache-Control': descriptor.cacheControl || discoveryCacheControl(config),
        'Content-Type': descriptor.contentType,
        ETag: etag,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });

      if (descriptor.deprecated) {
        response.set('Deprecation', 'true');
        response.set('Link', '<' + descriptor.canonicalPath + '>; rel="canonical"');
      }

      if (request.get('if-none-match') === etag) {
        response.status(304).end();
        return;
      }

      response.on('finish', () => {
        logger.info({
          event: 'agent.discovery',
          method: request.method,
          path: routePath,
          status: response.statusCode,
          request_id: request.id,
        });
      });
      response.send(body);
    });
  }
}

function requestIdentity(request, response, next) {
  if (!request.id) {
    request.id = crypto.randomUUID();
  }
  response.set('X-Request-Id', request.id);
  next();
}

function securityHeaders(request, response, next) {
  response.removeHeader('X-Powered-By');
  response.set({
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  next();
}

function requireJsonForMutations(request, response, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method)) {
    next();
    return;
  }
  if (!request.is('application/json') && !request.is('application/vnd.context-layer+json')) {
    next(new AgentAwareError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Mutating agent requests require a supported JSON media type.',
      { status: 415 },
    ));
    return;
  }
  next();
}

function validateOrigin(config, extraOrigins = []) {
  const configuredOrigin = config.site.url || config.site.origin;
  const allowed = new Set([new URL(configuredOrigin).origin, ...extraOrigins]);
  return function originGuard(request, response, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      next();
      return;
    }
    const origin = request.get('origin');
    if (origin && !allowed.has(origin)) {
      next(new AgentAwareError(
        'ORIGIN_NOT_ALLOWED',
        'The request origin is not allowed for this action.',
        { status: 403 },
      ));
      return;
    }
    next();
  };
}

function createRateLimiter(settings = {}) {
  const windowMs = settings.windowMs || 60_000;
  const max = settings.max || 60;
  const buckets = new Map();

  return function rateLimit(request, response, next) {
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    response.set('RateLimit-Limit', String(max));
    response.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    response.set('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      next(new AgentAwareError(
        'RATE_LIMITED',
        'The agent action rate limit has been exceeded.',
        { status: 429, retryable: true },
      ));
      return;
    }
    next();
  };
}

function createErrorHandler(config, logger) {
  return function errorHandler(error, request, response, next) {
    if (response.headersSent) {
      next(error);
      return;
    }

    let safe = error;
    if (error && error.type === 'entity.too.large') {
      safe = new AgentAwareError('PAYLOAD_TOO_LARGE', 'The request payload exceeds the configured limit.', {
        status: 413,
      });
    } else if (error instanceof SyntaxError && error.status === 400) {
      safe = new AgentAwareError('INVALID_JSON', 'The request body is not valid JSON.', {
        status: 400,
      });
    }
    safe = asAgentAwareError(safe);

    logger.error({
      event: 'agent.error',
      code: safe.code,
      method: request.method,
      status: safe.status,
      request_id: request.id,
    });

    if (['AUTHENTICATION_REQUIRED', 'AUTHENTICATION_INVALID'].includes(safe.code)) {
      response.set('WWW-Authenticate', 'Bearer');
    }

    response
      .status(safe.status)
      .type('application/json')
      .set('Cache-Control', 'no-store')
      .send(JSON.stringify(errorDocument(
        safe,
        request.id,
        config.agent.id,
      )));
  };
}

function strongEtag(body) {
  return '"' + crypto.createHash('sha256').update(body).digest('base64url') + '"';
}

function discoveryCacheControl(config) {
  if (typeof config.discovery.cache_control === 'string') {
    return config.discovery.cache_control;
  }
  const seconds = Number.isInteger(config.discovery.cache_seconds)
    ? config.discovery.cache_seconds
    : 300;
  return 'public, max-age=' + seconds;
}

function silentLogger() {
  return {
    info() {},
    error() {},
  };
}

module.exports = {
  createApp,
  createAgentAwareRouter,
  createErrorHandler,
  securityHeaders,
  validateOrigin,
};
