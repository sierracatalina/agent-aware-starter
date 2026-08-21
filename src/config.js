'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const { AgentAwareError } = require('./errors');
const schema = require('../schemas/agent-aware/config.schema.json');

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../config/agent-aware.json');
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function errorDetails(errors = []) {
  return errors.map((error) => ({
    path: error.instancePath || '/',
    rule: error.keyword,
    message: error.message,
  }));
}

function parseHttpUrl(value, base, label) {
  let parsed;
  try {
    parsed = new URL(value, base);
  } catch {
    throw invalidUrl(label);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw invalidUrl(label);
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw invalidUrl(label);
  }
  return parsed;
}

function validateSiteOrigin(value) {
  const parsed = parseHttpUrl(value, undefined, 'Site origin');
  if (parsed.origin !== value) throw invalidUrl('Site origin');
}

function isLoopbackHostname(value) {
  return value === 'localhost'
    || value === '::1'
    || value === '[::1]'
    || /^127(?:\.[0-9]{1,3}){3}$/.test(value);
}

function invalidUrl(label) {
  return new AgentAwareError(
    'CONFIG_INVALID',
    label + ' must be credential-free HTTPS, or loopback HTTP where allowed.',
    { status: 500 },
  );
}

function validateConfig(config) {
  if (!validateSchema(config)) {
    throw new AgentAwareError(
      'CONFIG_INVALID',
      'Agent-aware configuration failed schema validation.',
      { status: 500, details: errorDetails(validateSchema.errors) },
    );
  }

  validateSiteOrigin(config.site.origin);
  const actionSchemaCompiler = new Ajv({
    allErrors: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(actionSchemaCompiler);
  const actionIds = new Set();
  for (const action of config.actions) {
    if (actionIds.has(action.id)) {
      throw new AgentAwareError(
        'CONFIG_INVALID',
        `Action id ${action.id} must be unique.`,
        { status: 500 },
      );
    }
    actionIds.add(action.id);

    assertSynchronousSchema(action.input_schema, action.id + '.input_schema');
    assertSynchronousSchema(action.output_schema, action.id + '.output_schema');
    compileActionSchema(
      actionSchemaCompiler,
      action.input_schema,
      action.id + '.input_schema',
    );
    compileActionSchema(
      actionSchemaCompiler,
      action.output_schema,
      action.id + '.output_schema',
    );

    if (action.context.required) {
      if (action.auth !== 'required') {
        throw new AgentAwareError(
          'CONFIG_INVALID',
          `Context-aware action ${action.id} must require authenticated callers.`,
          { status: 500 },
        );
      }

      const completeContextPolicy =
        action.context.purposes.length === 1
        && action.context.selectors.length > 0
        && Number.isInteger(action.context.max_retention_seconds)
        && action.context.max_retention_seconds >= 1
        && action.context.max_retention_seconds <= config.context_layer.max_bundle_lifetime_seconds
        && action.context.receipt_required;

      if (!completeContextPolicy) {
        throw new AgentAwareError(
          'CONFIG_INVALID',
          `Context-aware action ${action.id} requires one exact purpose, bounded selectors, retention, and a receipt.`,
          { status: 500 },
        );
      }
    } else {
      const emptyContextPolicy =
        action.context.purposes.length === 0
        && action.context.selectors.length === 0
        && action.context.max_retention_seconds === 0
        && action.context.receipt_required === false
        && action.human_confirmation === 'never';

      if (!emptyContextPolicy) {
        throw new AgentAwareError(
          'CONFIG_INVALID',
          `Non-context action ${action.id} cannot advertise context, confirmation, retention, or receipt controls.`,
          { status: 500 },
        );
      }
    }

    if (action.side_effect !== 'none') {
      const completeEffectPolicy =
        action.auth === 'required'
        && action.context.required
        && action.context.receipt_required
        && action.human_confirmation === 'required';

      if (!completeEffectPolicy) {
        throw new AgentAwareError(
          'CONFIG_INVALID',
          `Side-effecting action ${action.id} requires authentication, scoped context, bound confirmation, and durable receipts.`,
          { status: 500 },
        );
      }
    }
  }

  if (config.protocols.mcp.enabled) {
    if (!config.protocols.mcp.endpoint) {
      throw new AgentAwareError(
        'CONFIG_INVALID',
        'MCP cannot be enabled without a configured endpoint.',
        { status: 500 },
      );
    }
    parseHttpUrl(config.protocols.mcp.endpoint, config.site.origin, 'MCP endpoint');
  }

  if (config.protocols.a2a.enabled) {
    if (!config.protocols.a2a.interface) {
      throw new AgentAwareError(
        'CONFIG_INVALID',
        'A2A cannot be enabled without a real HTTPS interface.',
        { status: 500 },
      );
    }
    const a2aInterface = parseHttpUrl(
      config.protocols.a2a.interface,
      undefined,
      'A2A interface',
    );
    if (a2aInterface.protocol !== 'https:') throw invalidUrl('A2A interface');
  }

  return config;
}

function compileActionSchema(compiler, schema, label) {
  try {
    compiler.compile(schema);
  } catch {
    throw new AgentAwareError(
      'CONFIG_INVALID',
      label + ' is not a supported strict JSON Schema.',
      { status: 500 },
    );
  }
}

function assertSynchronousSchema(schema, label) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || schema.type !== 'object') {
    throw new AgentAwareError(
      'CONFIG_INVALID',
      label + ' must declare an object root type.',
      { status: 500 },
    );
  }

  const stack = [schema];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (Object.hasOwn(value, '$async')) {
      throw new AgentAwareError(
        'CONFIG_INVALID',
        label + ' cannot use the unsupported $async schema keyword.',
        { status: 500 },
      );
    }
    if (Array.isArray(value)) {
      stack.push(...value);
    } else {
      stack.push(...Object.values(value));
    }
  }
}

function loadConfig(options = {}) {
  const env = options.env || process.env;
  const requestedPath = options.path || options.configPath || options.file || env.AGENT_AWARE_CONFIG;
  const configPath = path.resolve(requestedPath || DEFAULT_CONFIG_PATH);

  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    throw new AgentAwareError(
      'CONFIG_UNAVAILABLE',
      'Agent-aware configuration could not be read.',
      { status: 500 },
    );
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new AgentAwareError(
      'CONFIG_INVALID_JSON',
      'Agent-aware configuration is not valid JSON.',
      { status: 500 },
    );
  }

  if (options.publicOrigin) {
    config = {
      ...config,
      site: { ...config.site, origin: options.publicOrigin },
    };
  }

  return validateConfig(config);
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  loadConfig,
  validateConfig,
};
