'use strict';

class AgentAwareError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'AgentAwareError';
    this.code = code;
    this.status = options.status || 400;
    this.details = Array.isArray(options.details) ? options.details : [];
    this.retryable = Boolean(options.retryable);
    this.indeterminate = Boolean(options.indeterminate);
  }
}

function asAgentAwareError(error) {
  if (error instanceof AgentAwareError) return error;
  return new AgentAwareError(
    'INTERNAL_ERROR',
    'The operation could not be completed safely.',
    { status: 500 },
  );
}

function errorDocument(error, requestId, issuer = 'urn:aaa:gateway:local') {
  const safe = asAgentAwareError(error);
  return {
    schema_version: 'aaa/1.0-draft',
    type: 'error',
    id: `urn:aaa:error:${requestId}`,
    created_at: new Date().toISOString(),
    issuer: { id: issuer },
    code: safe.code,
    message: safe.message,
    retryable: safe.retryable,
    indeterminate: safe.indeterminate,
  };
}

module.exports = {
  AgentAwareError,
  asAgentAwareError,
  errorDocument,
};
