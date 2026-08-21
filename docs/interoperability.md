# Interoperability profile

## Claim boundary

The starter publishes a project-specific discovery surface and an HTTP action gateway. It does **not** currently implement or advertise MCP or A2A. “Adapter-ready” means the core action, Context Layer verification, receipt, and writeback boundaries can be called by a future native adapter; it does not mean protocol support exists.

`context-layer/0.1-draft` is a working draft. The starter is a CL-Core-Consumer candidate/self-test implementation, not a certified or conformant implementation.

## Public paths

| Path | Authority | Contract |
| --- | --- | --- |
| `/robots.txt` | RFC 9309 | UTF-8 crawler preferences at the origin root. Not access control. |
| `/llms.txt` | llms.txt proposal | Concise content navigation at the origin root. Not a security policy. |
| `/agents.txt` | agents.txt community convention | Human-readable v1 integration summary; not an IETF or A2A standard. |
| `/agents.json` | agents.txt community convention | Structured v1 discovery. Not an A2A Agent Card. |
| `/agent-manifest.json` | This project | Action capability metadata. Not a PWA manifest or protocol grant. |
| `/agent-hints.json` | This project | Advisory, untrusted hints. The gateway ignores hints for authorization. |
| `/.well-known/context-layer` | Context Layer draft convention | Experimental and unregistered; explicitly reports working-draft/candidate status. |
| `/context-layer-conformance.json` | This project | Machine-readable candidate/self-test boundary; no role or certification claim. |
| `/openapi.json` | OpenAPI format | Describes the routes that this starter actually implements. |
| `/.well-known/llms.txt` | Deprecated alias | Canonical document is `/llms.txt`. |
| `/.well-known/agents.json` | Deprecated alias | Canonical project-specific document is `/agents.json`. |
| `/.well-known/ai-instructions.json` | Deprecated alias | Canonical advisory document is `/agent-hints.json`. |

RFC 8615 requires new well-known names to be registered. The aliases above exist only for migration. The experimental Context Layer name must not be presented as an IANA-registered standard.

Discovery responses should have exact media types, `X-Content-Type-Options: nosniff`, explicit cache policy, strong ETags, and permissive CORS only for non-sensitive public documents. Credential-bearing API responses use `no-store` and do not inherit public CORS.

## MCP adapter readiness

A future MCP adapter should target the current MCP revision independently of Context Layer. For the 2026-07-28 specification, the minimum gate is:

- one stateless Streamable HTTP POST endpoint, conventionally `/mcp`;
- `server/discover` with truthful versions, capabilities, server metadata, and cache lifetime;
- required MCP version, method, and name header/body consistency checks;
- strict `Origin` validation and loopback binding for local servers;
- OAuth 2.1 protected-resource discovery and bearer audience validation for HTTP deployments;
- no upstream token pass-through;
- input/output JSON Schema and validation for every tool;
- bounded opaque handles that are reauthorized on every use;
- output sanitization, rate limits, and user confirmation for sensitive effects;
- modern revision fixtures and, only if needed, a separately tested legacy adapter.

Recommended Context Layer mapping:

| Context Layer concept | MCP representation |
| --- | --- |
| Request for scoped disclosure | Narrow tool such as `context.request`; never a raw-vault search tool |
| Approved bundle | Schema-validated `structuredContent` plus a serialized text fallback, or a read-only opaque resource |
| Declared action | Separate tool with its own schema, authentication, and confirmation semantics |
| Receipt | Structured tool result plus durable Context Layer receipt |
| Writeback | `context.propose_memory_update`; never unrestricted storage mutation |
| Extension | Negotiated MCP identifier such as `com.sierracatalina/context-layer`, with explicit version/fallback rules |

Do not expose `/mcp`, mention MCP in `/agents.json`, or publish OAuth resource metadata until that runtime is reachable, authenticated, and passing native tests.

Primary MCP sources:

- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [MCP versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [MCP server discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

## A2A adapter readiness

A future A2A v1 adapter should provide:

- a minimal public Agent Card at the registered `/.well-known/agent-card.json` path;
- an absolute production HTTPS interface URL and truthful protocol binding/version;
- `A2A-Version: 1.0` validation on requests;
- accurate skills, input/output media types, security schemes, and requirements;
- an authenticated Extended Agent Card for sensitive capabilities or tenant-specific detail;
- native authentication on every request;
- optional JCS/JWS card signing with a documented verification policy;
- ETag and cache controls;
- no advertised streaming, push, multiple bindings, or extensions unless implemented and tested.

Recommended Context Layer mapping:

| Context Layer concept | A2A representation |
| --- | --- |
| Agent identity/capability | Public or authenticated Agent Card metadata |
| Action request | Task/message handled by the same local gateway core |
| Approved bundle/reference | Structured data Part under a versioned Context Layer extension |
| Recipient binding | Exact remote-agent identity used by bundle verification |
| Governed output | Artifact/status plus durable receipt |
| Additional disclosure | New ContextRequest, never implicit task continuation |
| Extension | URI such as `https://sierracatalina.com/context-layer/extensions/a2a/v1` |

Unknown optional extensions may be ignored only per the negotiated A2A rules. An unsupported required extension fails explicitly, and an adapter must not silently fall back to an older extension version.

Do not publish an Agent Card until its endpoint, authentication, skills, extensions, and advertised capabilities pass native A2A tests.

Primary A2A sources:

- [A2A v1 specification](https://a2a-protocol.org/latest/specification/)
- [A2A agent discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)
- [A2A v1 changes](https://a2a-protocol.org/latest/whats-new-v1/)
- [IANA Well-Known URI Registry](https://www.iana.org/assignments/well-known-uris)

## Robots, llms.txt, and browser metadata

`robots.txt` expresses crawler preferences under RFC 9309. It does not protect a route, and listing a sensitive path can disclose that the path exists.

`llms.txt` remains a community proposal. It belongs at `/llms.txt`, uses concise links and summaries, and must not contain credentials, private context, or instructions that purport to override a consumer’s policy.

`/agent-manifest.json` is not a W3C Web App Manifest. If an installable browser experience is later added, publish a separate `/manifest.webmanifest` with `application/manifest+json`, a stable same-origin `id`, explicit `start_url` and `scope`, and no user-specific tracking state. PWA metadata never grants agent capability.

Primary sources:

- [RFC 8615: Well-Known URIs](https://www.rfc-editor.org/rfc/rfc8615.html)
- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
- [llms.txt proposal](https://llmstxt.org/)
- [agents.txt community convention](https://agents-txt.com/)
- [W3C Web App Manifest](https://www.w3.org/TR/appmanifest/)
- [W3C Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)

## Version domains

| Domain | Value/profile | Rule |
| --- | --- | --- |
| Context Layer core | `context-layer/0.1-draft` | Working draft. Exact match in phase 0; never claim certification. |
| Gateway documents | `aaa/1.0-draft` | Project contract only. |
| Context Layer header | `Context-Layer-Version: 0.1-draft` | Wire selector for context-requiring actions. |
| MCP | Date revision, currently `2026-07-28` | Native negotiation, independent of Context Layer. |
| A2A wire | `1.0` | Native request header; independent of Agent Card implementation semver. |
| Application/package | Semver | Does not imply protocol or Context Layer conformance. |

Never infer one version from another.

## Extension rules

The phase-0 Context Layer schemas are closed. They do not accept ad hoc extension fields. A future profile must publish a new schema or a defined extension envelope and must:

1. use a collision-resistant identifier;
2. state whether support is required;
3. define validation and downgrade behavior;
4. preserve core restrictions;
5. reject unsupported required behavior;
6. never silently reinterpret a published `$id`;
7. include valid, invalid, downgrade, and unknown-extension fixtures.

Integrity suites follow the same rule. The Context Layer draft does not yet justify inventing a universal signature claim. Use the external authority’s documented integrity profile and report the actual assurance in receipts.
