# Legacy discovery migration

## Why this migration exists

The original starter placed several project-specific files under `/.well-known/` and described advisory hints as a defensive security perimeter. That is not a safe interoperability claim:

- RFC 8615 reserves `/.well-known/` for registered or properly specified names.
- The llms.txt proposal uses `/llms.txt` at the origin root.
- A2A v1 uses the registered `/.well-known/agent-card.json`; the legacy `agents.json` shape is not an Agent Card.
- Navigation hints cannot authenticate a caller, authorize an action, or prevent prompt injection.

The new surface keeps compatibility aliases temporarily while publishing honest canonical documents.

## Path mapping

| Legacy path | Canonical path | Migration behavior |
| --- | --- | --- |
| `/.well-known/llms.txt` | `/llms.txt` | Serve the canonical body temporarily with `Deprecation: true` and a canonical `Link` header. |
| `/.well-known/agents.json` | `/agents.json` | Serve the project-specific canonical body temporarily with deprecation metadata. Do not call it A2A. |
| `/.well-known/ai-instructions.json` | `/agent-hints.json` | Serve advisory hints temporarily with deprecation metadata. Do not treat them as a security control. |
| none | `/.well-known/context-layer` | Experimental working-draft convention only; explicitly unregistered and non-conformant. |
| none | `/.well-known/agent-card.json` | Do not publish until a real A2A v1 runtime is implemented and tested. |
| none | `/.well-known/oauth-protected-resource` | Do not publish until a real protected MCP HTTP resource is implemented. |

`/agents.txt`, `/agents.json`, `/agent-manifest.json`, and `/agent-hints.json` are project-specific origin-root documents. Their names do not grant standardized semantics.

## Migration phases

### 1. Inventory consumers

Before changing production routes, measure requests by path, client class, response status, and cache validator without logging credentials or query data. Identify controlled clients and their cache lifetimes.

Search documentation, SDKs, examples, robots rules, static links, and monitoring for the three legacy paths.

### 2. Publish canonical documents

Publish `/llms.txt`, `/agents.json`, and `/agent-hints.json` first. Verify:

- exact content type;
- strong ETag and conditional `304`;
- explicit public cache policy;
- `X-Content-Type-Options: nosniff`;
- public CORS only on discovery;
- no credentials, private URLs, context, or unsupported protocol claims.

Update controlled clients to canonical paths.

### 3. Mark aliases deprecated

During the compatibility window, aliases may return the same representation with:

```http
Deprecation: true
Link: </canonical-path>; rel="canonical"
```

A redirect is optional for clients known to follow redirects safely. Serving the body is more compatible for simple discovery fetchers. In either case, keep media type and cache behavior explicit.

Do not redirect `/.well-known/agents.json` to `/.well-known/agent-card.json`. The schemas and semantics are different, and such a redirect would falsely advertise A2A support.

### 4. Observe and announce

Keep aliases for at least one announced release or a deployment-specific measured window. Track only minimized route-level telemetry. Document the removal release/date for client owners.

Purge CDN entries when changing canonical/deprecation headers; otherwise long-lived cached legacy content can outlast the application migration.

### 5. Retire

After controlled consumers have migrated:

1. return `410 Gone` with a small, cache-bounded migration document;
2. monitor residual use;
3. remove the alias in a later breaking release.

Never keep an alias indefinitely merely because an unknown crawler requests it.

## `ai-instructions.json` security correction

Legacy wording suggested that a file could instruct agents to ignore hostile page content. That file was never an enforcement boundary.

The replacement `/agent-hints.json` may offer navigation or content-classification hints, but:

- callers may ignore or maliciously alter it;
- the gateway never reads it to grant capability;
- it cannot override local action configuration or a Context Layer restriction;
- it contains no secrets or private selectors;
- its schema/version is project-specific;
- prompt injection remains untrusted input handled by the authenticated capability gate.

Security decisions belong in executable server-side policy and verified authority decisions.

## Context Layer draft discovery

`/.well-known/context-layer` follows the Context Layer working-draft documentation but is not presently an IANA-registered well-known name. Keep all of the following explicit in its representation and documentation:

- `context-layer/0.1-draft`;
- working-draft status;
- CL-Core-Consumer candidate/self-test status;
- no certification/conformance claim;
- external authority boundary;
- no MCP/A2A runtime claim.

If the convention changes or becomes registered, introduce a reviewed migration rather than silently changing the existing response.

## Adding A2A later

A2A is a separate migration, not a rename:

1. implement an A2A v1 interface over the guarded core;
2. add native version/authentication/skill/task/extension tests;
3. prepare a minimal public Agent Card with only real interfaces and skills;
4. use an authenticated Extended Agent Card for sensitive metadata;
5. publish `/.well-known/agent-card.json`;
6. update project-specific discovery to link to it;
7. keep `/agents.json` clearly labeled project-specific.

## Adding MCP later

Likewise, MCP requires a real runtime:

1. implement current Streamable HTTP and `server/discover`;
2. configure OAuth protected-resource discovery and resource/audience validation;
3. validate Origin and native protocol headers;
4. map narrow tools to the same Context Layer gate;
5. pass protocol, authorization, version, and negative-security tests;
6. only then publish `/mcp` and related metadata.

## Migration tests

Automate:

- canonical and alias path/status/media-type assertions;
- deprecation and canonical `Link` headers;
- ETag and conditional request parity;
- absence of secrets and protected fields;
- `/llms.txt` at root;
- absence of `/.well-known/agent-card.json`, `/mcp`, and MCP metadata while disabled;
- explicit experimental/candidate language for Context Layer draft discovery;
- no authorization behavior derived from hints;
- cache purge/rollback checks in the deployment environment.

## References

- [RFC 8615: Well-Known URIs](https://www.rfc-editor.org/rfc/rfc8615.html)
- [IANA Well-Known URI Registry](https://www.iana.org/assignments/well-known-uris)
- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
- [llms.txt proposal](https://llmstxt.org/)
- [A2A agent discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)
- [Context Layer specification](https://sierracatalina.com/context-layer/specification)
