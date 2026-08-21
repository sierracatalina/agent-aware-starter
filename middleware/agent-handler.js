'use strict';

const express = require('express');
const {
  createAgentAwareRouter: createCoreAgentAwareRouter,
  createErrorHandler,
  loadConfig,
} = require('../src');

function createAgentAwareRouter(options = {}) {
  const config = options.config || loadConfig({
    file: options.configFile,
    publicOrigin: options.publicOrigin,
  });
  const logger = normalizeLogger(options.logger);
  const router = express.Router();

  router.use(createCoreAgentAwareRouter({
    ...options,
    config,
    logger,
  }));
  router.use(createErrorHandler(config, logger));

  return router;
}

function normalizeLogger(logger) {
  if (!logger) return silentLogger();
  return {
    info: typeof logger.info === 'function' ? logger.info.bind(logger) : () => {},
    error: typeof logger.error === 'function' ? logger.error.bind(logger) : () => {},
  };
}

function silentLogger() {
  return {
    info() {},
    error() {},
  };
}

const router = createAgentAwareRouter();

module.exports = router;
// Compatibility alias: unlike the lower-level src factory, this composition
// includes the safe JSON error boundary required by a plain Express app.
module.exports.createAgentAwareRouter = createAgentAwareRouter;
module.exports.createAgentHandler = createAgentAwareRouter;
