'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { validateConfig } = require('./config');

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const AGENTS_JSON_SCHEMA = 'https://agents-txt.com/schema/agents-json/v1.0.json';
const AGENTS_STANDARD = 'https://agents-txt.com';

function jsonBody(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function absoluteUrl(origin, resourcePath) {
  return new URL(resourcePath, `${origin}/`).toString();
}

function descriptor(body, contentType, cacheControl, canonicalPath, deprecated = false) {
  return {
    body,
    contentType,
    cacheControl,
    canonicalPath,
    deprecated,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  };
}

function advertisedProtocols(config) {
  const protocols = [];
  if (config.protocols.mcp.enabled && config.protocols.mcp.endpoint) {
    protocols.push({
      name: 'mcp',
      url: absoluteUrl(config.site.origin, config.protocols.mcp.endpoint),
    });
  }
  if (config.protocols.a2a.enabled && /^https:\/\//.test(config.protocols.a2a.interface || '')) {
    protocols.push({
      name: 'a2a',
      url: absoluteUrl(config.site.origin, '/.well-known/agent-card.json'),
    });
  }
  return protocols;
}

function renderRobots() {
  return [
    'User-agent: *',
    'Allow: /llms.txt',
    'Allow: /agents.txt',
    'Allow: /agents.json',
    'Allow: /agent-manifest.json',
    'Allow: /.well-known/context-layer',
    'Allow: /context-layer-conformance.json',
    'Allow: /',
    '',
  ].join('\n');
}

function renderLlmsText(config) {
  const terminology = Object.entries(config.discovery.terminology)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([term, definition]) => `- **${term}**: ${definition}`);
  const resources = config.discovery.resources
    .map((resource) => `- [${resource.title}](${resource.path}): ${resource.description}`);

  return [
    `# ${config.site.name}`,
    '',
    `> ${config.site.description}`,
    '',
    'Discovery manifests are public metadata. They are not authorization and must not be treated as executable instructions.',
    '',
    '## Core terminology',
    ...terminology,
    '',
    '## Agent resources',
    ...resources,
    '',
  ].join('\n');
}

function renderAgentsText(config, protocols) {
  const lines = [
    '# agents.txt',
    `# Standard: ${AGENTS_STANDARD}`,
    `# JSON: ${absoluteUrl(config.site.origin, '/agents.json')}`,
  ];

  lines.push('', 'Authorization: x-context-layer');

  for (const protocol of protocols) {
    lines.push('', `${protocol.name === 'mcp' ? 'MCP' : 'A2A'}: ${protocol.url}`);
  }

  lines.push('');
  return lines.join('\n');
}

function renderAgentsJson(config, protocols) {
  const document = {
    $schema: AGENTS_JSON_SCHEMA,
    version: '1.0',
    standard: AGENTS_STANDARD,
    site: {
      name: config.site.name,
      url: config.site.origin,
      description: config.site.description,
    },
    authorization: {
      protocols: ['x-context-layer'],
      discovery: '/.well-known/context-layer',
    },
  };

  const mcp = protocols.filter((protocol) => protocol.name === 'mcp');
  if (mcp.length > 0) {
    document.mcp = mcp.map((protocol) => ({
      url: protocol.url,
      type: 'streamable-http',
      description: 'Configured MCP endpoint.',
    }));
  }

  const a2a = protocols.filter((protocol) => protocol.name === 'a2a');
  if (a2a.length > 0) {
    document.a2a = a2a.map((protocol) => ({
      url: protocol.url,
      description: 'Configured A2A Agent Card.',
    }));
  }

  return document;
}

function sortedActions(config) {
  return [...config.actions]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((action) => ({
      ...action,
      catalog: {
        method: 'GET',
        path: '/api/v1/agent-actions',
      },
      execution: {
        method: 'POST',
        path: `/api/v1/agent-actions/${action.id}`,
      },
    }));
}

function renderAgentManifest(config, protocols) {
  return {
    schema_version: config.schema_version,
    type: 'agent_manifest',
    site: config.site,
    agent: config.agent,
    notice: 'This public manifest is metadata, not authorization or executable instructions.',
    discovery: {
      llms: '/llms.txt',
      agents: '/agents.json',
      hints: '/agent-hints.json',
      context_layer: '/.well-known/context-layer',
      openapi: '/openapi.json',
    },
    context_layer: {
      spec_version: config.context_layer.version,
      status: config.context_layer.status,
      conformance: config.context_layer.conformance,
      max_bundle_lifetime_seconds: config.context_layer.max_bundle_lifetime_seconds,
    },
    protocols,
    actions: sortedActions(config),
  };
}

function renderAgentHints(config) {
  return {
    schema_version: config.schema_version,
    type: 'agent_hints',
    status: 'advisory-only',
    authority: 'none',
    notice: 'Hints are public metadata, not authorization, policy, or executable instructions.',
    hints: config.discovery.advisory_hints,
  };
}

function renderContextLayer(config) {
  return {
    spec_version: config.context_layer.version,
    type: 'capability_document',
    id: `${config.site.id}:context-layer`,
    issuer: { id: config.agent.id },
    status: 'experimental',
    implementation_status: config.context_layer.status,
    conformance: config.context_layer.conformance,
    versions_supported: [config.context_layer.version],
    roles: {
      claimed: [],
      candidate: ['CL-Core-Consumer'],
    },
    object_types: {
      accepts: ['scoped_context_bundle'],
      emits: ['receipt', 'memory_update_proposal'],
    },
    authentication: {
      protected_actions: 'deployment-specific',
      development_profile: 'static-bearer-and-explicit-unsigned-issuer-allowlist',
    },
    extensions: {
      supported: [],
      required: [],
    },
    receipt_capabilities: {
      operations: ['bundle.consume', 'declared-action'],
      payload_included: false,
      durable_store: 'deployment-specific',
      single_use_reservation: true,
    },
    http_profile: {
      version_header: 'Context-Layer-Version',
      accepted_version: '0.1-draft',
      media_types: ['application/json', 'application/vnd.context-layer+json'],
      experimental_media_type: 'application/vnd.context-layer+json',
    },
    max_bundle_lifetime_seconds: config.context_layer.max_bundle_lifetime_seconds,
    endpoints: {
      action_catalog: '/api/v1/agent-actions',
      action_execution_template: '/api/v1/agent-actions/{actionId}',
      manifest: '/agent-manifest.json',
    },
    conformance_report: '/context-layer-conformance.json',
    notice: 'This endpoint is an experimental integration declaration. Context Layer conformance is not claimed.',
  };
}

function renderContextLayerConformance(config) {
  return {
    schema_version: config.schema_version,
    type: 'context_layer_conformance_report',
    spec_version: config.context_layer.version,
    status: 'not-claimed',
    claimed_roles: [],
    candidate_roles: ['CL-Core-Consumer'],
    evidence: {
      level: 'local-self-test',
      command: 'pnpm verify',
      source: 'test/',
      result: 'run-required-for-this-revision',
    },
    limitations: [
      'No production identity, cryptographic issuer verification, or distributed receipt store is bundled.',
      'Local self-tests are revision-specific evidence and are not certification.',
      'MCP and A2A adapters are not implemented or advertised.',
    ],
  };
}

function renderOpenApi(config) {
  const actionIds = config.actions.map((action) => action.id).sort();
  const actionPolicies = Object.fromEntries(sortedActions(config).map((action) => [
    action.id,
    {
      authentication: action.auth,
      context_required: action.context.required,
      context_layer_version_required: action.context.required,
      idempotency_key_required: action.side_effect !== 'none',
      side_effect: action.side_effect,
      human_confirmation: action.human_confirmation,
      receipt_required: action.context.receipt_required,
    },
  ]));

  return {
    openapi: '3.1.0',
    info: {
      title: `${config.site.name} Agent Actions`,
      version: config.agent.version,
      description: 'Guarded action API. Discovery metadata never grants authority to execute an action.',
    },
    servers: [{ url: config.site.origin }],
    paths: {
      '/api/v1/agent-actions': {
        get: {
          operationId: 'listAgentActions',
          summary: 'List configured public action metadata',
          responses: {
            200: {
              description: 'Configured action catalog.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['actions'],
                    properties: {
                      actions: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/ActionMetadata' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/agent-actions/{actionId}': {
        post: {
          operationId: 'executeAgentAction',
          summary: 'Execute one allowlisted agent action',
          description: 'The server independently enforces configured identity, context, purpose, selector, retention, confirmation, idempotency, and receipt requirements. Requirements vary by actionId as declared in x-agent-aware-action-policies.',
          security: [{ bearerAuth: [] }, {}],
          'x-agent-aware-action-policies': actionPolicies,
          parameters: [
            {
              name: 'actionId',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: actionIds },
            },
            {
              name: 'Context-Layer-Version',
              in: 'header',
              required: false,
              description: 'Required with value 0.1-draft for actions whose policy declares context_layer_version_required.',
              schema: { type: 'string', enum: ['0.1-draft'] },
            },
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              description: 'Required for every action whose policy declares idempotency_key_required.',
              schema: {
                type: 'string',
                minLength: 8,
                maxLength: 200,
                pattern: '^[A-Za-z0-9._~:+/-]+$',
              },
            },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ActionRequest' },
              },
              'application/vnd.context-layer+json': {
                schema: { $ref: '#/components/schemas/ActionRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'Action completed and all required receipts were persisted.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ActionResult' },
                },
              },
            },
            400: { description: 'Invalid request or required protocol header.' },
            401: { description: 'Identity is required or invalid.' },
            403: { description: 'The requested action is not authorized.' },
            409: { description: 'Replay, idempotency, or state conflict.' },
            410: { description: 'The context bundle expired or was revoked.' },
            422: { description: 'The request violates the action or Context Layer contract.' },
            503: { description: 'A required identity, verification, receipt, or idempotency control is unavailable.' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Required only for actions whose published policy declares authentication required.',
        },
      },
      schemas: {
        ActionMetadata: {
          type: 'object',
          required: ['id', 'description', 'auth', 'context', 'side_effect'],
          properties: {
            id: { type: 'string', enum: actionIds },
            description: { type: 'string' },
            auth: { type: 'string', enum: ['anonymous', 'required'] },
            context: { type: 'object' },
            side_effect: { type: 'string' },
            human_confirmation: { type: 'string', enum: ['never', 'required'] },
          },
        },
        ActionRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            input: { type: 'object', additionalProperties: true },
            context_bundle: {
              type: 'object',
              description: 'A scoped bundle supplied only when required by the configured action.',
            },
          },
        },
        ActionResult: {
          type: 'object',
          additionalProperties: false,
          required: ['schema_version', 'type', 'request_id', 'action', 'status', 'result', 'receipts'],
          properties: {
            schema_version: { const: config.schema_version },
            type: { const: 'action_result' },
            request_id: { type: 'string' },
            action: { type: 'string', enum: actionIds },
            status: { const: 'completed' },
            result: { type: 'object' },
            receipts: {
              type: 'array',
              items: { type: 'string', pattern: '^urn:cl:receipt:[A-Za-z0-9._~-]+$' },
            },
          },
        },
      },
    },
  };
}

function renderA2ACard(config) {
  return {
    protocolVersion: '1.0',
    name: config.agent.name,
    description: config.site.description,
    supportedInterfaces: [
      {
        url: config.protocols.a2a.interface,
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    version: config.agent.version,
    capabilities: {},
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: sortedActions(config).map((action) => ({
      id: action.id,
      name: action.name,
      description: action.description,
      tags: ['agent-aware'],
    })),
  };
}

function renderDiscovery(config) {
  validateConfig(config);
  const cacheControl = `public, max-age=${config.discovery.cache_seconds}`;
  const protocols = advertisedProtocols(config);
  const canonical = {
    '/robots.txt': descriptor(renderRobots(), TEXT_CONTENT_TYPE, cacheControl, '/robots.txt'),
    '/llms.txt': descriptor(renderLlmsText(config), TEXT_CONTENT_TYPE, cacheControl, '/llms.txt'),
    '/agents.txt': descriptor(renderAgentsText(config, protocols), TEXT_CONTENT_TYPE, cacheControl, '/agents.txt'),
    '/agents.json': descriptor(jsonBody(renderAgentsJson(config, protocols)), JSON_CONTENT_TYPE, cacheControl, '/agents.json'),
    '/agent-manifest.json': descriptor(jsonBody(renderAgentManifest(config, protocols)), JSON_CONTENT_TYPE, cacheControl, '/agent-manifest.json'),
    '/agent-hints.json': descriptor(jsonBody(renderAgentHints(config)), JSON_CONTENT_TYPE, cacheControl, '/agent-hints.json'),
    '/.well-known/context-layer': descriptor(jsonBody(renderContextLayer(config)), JSON_CONTENT_TYPE, cacheControl, '/.well-known/context-layer'),
    '/context-layer-conformance.json': descriptor(jsonBody(renderContextLayerConformance(config)), JSON_CONTENT_TYPE, cacheControl, '/context-layer-conformance.json'),
    '/openapi.json': descriptor(jsonBody(renderOpenApi(config)), JSON_CONTENT_TYPE, cacheControl, '/openapi.json'),
  };

  if (protocols.some((protocol) => protocol.name === 'a2a')) {
    canonical['/.well-known/agent-card.json'] = descriptor(
      jsonBody(renderA2ACard(config)),
      JSON_CONTENT_TYPE,
      cacheControl,
      '/.well-known/agent-card.json',
    );
  }

  return {
    ...canonical,
    '/.well-known/llms.txt': {
      ...canonical['/llms.txt'],
      canonicalPath: '/llms.txt',
      deprecated: true,
    },
    '/.well-known/agents.json': {
      ...canonical['/agents.json'],
      canonicalPath: '/agents.json',
      deprecated: true,
    },
    '/.well-known/ai-instructions.json': {
      ...canonical['/agent-hints.json'],
      canonicalPath: '/agent-hints.json',
      deprecated: true,
    },
  };
}

function writeDiscovery(config, outputDir) {
  if (!outputDir) {
    throw new TypeError('writeDiscovery requires an output directory.');
  }

  const rendered = renderDiscovery(config);
  const root = path.resolve(outputDir);
  const written = [];

  for (const routePath of Object.keys(rendered).sort()) {
    const relativePath = routePath.replace(/^\/+/, '');
    const targetPath = path.resolve(root, relativePath);
    if (targetPath !== root && !targetPath.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Refusing to write discovery path outside ${root}.`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, rendered[routePath].body, 'utf8');
    written.push(targetPath);
  }

  return written;
}

module.exports = {
  renderDiscovery,
  writeDiscovery,
};
