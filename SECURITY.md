# Security policy

## Security status

This starter is a **CL-Core-Consumer candidate/self-test implementation** for the working draft `context-layer/0.1-draft`. It is not certified, audited, or production-hardened.

The standalone runtime deliberately includes development components:

- a static bearer-token authenticator;
- an unsigned bundle verifier based only on an issuer allowlist;
- a single-host JSONL receipt store;
- an in-memory, process-local rate limiter.

These components demonstrate fail-closed interfaces. They are not substitutes for production identity, cryptographic verification, durable accounting, or distributed replay protection.

MCP and A2A are not implemented or advertised. Their security models do not apply until real adapters are introduced.

## Reporting a vulnerability

Do not open a public issue containing exploit details, credentials, private context, or user data. Use the repository host’s private security-advisory workflow when available and include:

- affected revision and deployment profile;
- minimal reproduction;
- expected and observed trust boundary;
- whether protected context or a side effect was exposed;
- suggested mitigation, if known.

Rotate any credential included in a report before sharing it. Maintainers should acknowledge, triage severity and disclosure timing, and publish a minimized advisory after a fix is available.

## Supported versions

Security fixes target the current default branch. Draft and pre-release versions may change incompatibly. Deployments should pin an exact revision and rerun `pnpm verify` after every dependency, schema, configuration, or adapter change.

## Assets

The design protects:

- caller and agent identities;
- approved context claims and provenance references;
- authority decisions, restrictions, approvals, and bundle integrity;
- action capabilities and side effects;
- idempotency and replay state;
- receipts and policy-snapshot evidence;
- writeback proposals;
- authentication, signing, storage, and deployment credentials.

Public discovery metadata is not confidential, but its integrity matters because consumers may use it for routing.

## Adversaries and assumptions

Assume an attacker can:

- read all public discovery documents;
- send malformed, oversized, replayed, cross-origin, and concurrent requests;
- control prompt text, page content, selector hints, action input, and upstream tool output;
- copy a valid-looking bundle or identifier from another recipient;
- attempt issuer, audience, recipient, action, or time confusion;
- induce partial failures around side effects and receipt writes;
- probe logs and error differences;
- compromise an optional adapter or downstream handler.

Do not assume that an agent follows advisory instructions, that a browser sends `Origin`, that a bearer token carries Context Layer purpose policy, or that a schema-valid bundle is authentic.

The external Context Layer authority, production identity provider, cryptographic key source, and receipt service are separate trust roots. Compromise of one is not silently treated as authorization from another.

## Threats and controls

| Threat | Required control |
| --- | --- |
| Discovery metadata treated as permission | Catalogs contain an authorization notice; every action reauthenticates and regates independently. |
| Prompt injection or hostile site content | Treat text, hints, selectors, prompts, and model output as data. Capability comes only from authenticated identity, local declaration, and verified authority decision. |
| Bundle forgery | Use a production cryptographic verifier with pinned issuer/trust policy and algorithm constraints. Never enable the unsigned development verifier. |
| Cross-recipient/context reuse | Match exact recipient, caller binding, purpose, action, lifetime, and restrictions on every request. |
| Replay | Use atomic single-use reservation, idempotency keys, and durable replay state scoped to issuer and bundle ID. |
| Capability escalation | Intersect bundle grants with the local action declaration. Unknown or broader capability is rejected. |
| Data over-disclosure | Provide handlers only a revocable minimized claim view; recursively block nested restricted values and test that denied fields are absent from output, receipts, errors, and logs. |
| Receipt bypass | Preflight required receipt storage before work. Fail closed before execution. Mark a side-effecting handler exception or post-effect persistence failure indeterminate. |
| Direct memory mutation | Emit only a `MemoryUpdateProposal`; require a separate authority/user decision and receipt. |
| Token substitution/pass-through | Validate resource audience and mint/use separate downstream credentials. Never forward the caller token to an authority or handler. |
| Origin/CSRF abuse | Enforce exact origins for browser mutations. If cookie authentication is added, add a complete CSRF defense; Origin checking alone is insufficient. |
| SSRF or webhook abuse | Future URL-accepting handlers must resolve and validate destinations, block private/link-local/file schemes, limit redirects, and use egress controls. |
| Denial of service | Bound bodies, schemas, concurrency, timeouts, retries, semantic probes, receipt size, and per-principal/IP rates. |
| Secret leakage | Redact logs, omit payloads from receipts, return stable safe errors, and scan public/generated artifacts. |
| Protocol downgrade | Keep MCP, A2A, Context Layer, and application versions independent; reject unsupported required versions/extensions. |

## Production caller authenticator

Replace `createBearerAuthenticator` before network deployment. A production implementation must:

1. authenticate each protected request over TLS;
2. validate credential signature or introspection response;
3. validate exact issuer, audience/resource, expiry, not-before, and authorized algorithms;
4. validate action-appropriate scope and revocation/session state;
5. produce a stable principal and client-instance binding;
6. distinguish invalid credentials (`401`/`403`) from unavailable verification (`503`);
7. avoid credentials in query strings, logs, URLs, discovery, or receipts;
8. prevent token pass-through to the Context Layer authority and downstream services;
9. define key rotation, cache lifetime, clock skew, and outage behavior;
10. undergo negative tests for confused-deputy and cross-tenant cases.

The bundled static token has no issuer, audience, expiry, scope, revocation, delegation, or rotation protocol. Constant-time comparison does not make it production authentication.

## Production Context Layer bundle verifier

Replace `createDevelopmentBundleVerifier`. A production verifier must validate the exact integrity profile issued by the external authority and must:

- pin trusted issuers and allowed algorithms/key sources;
- validate authority key lifetime, rotation, revocation, and canonicalization rules;
- reject unsigned, partially signed, ambiguously encoded, or algorithm-confused objects;
- validate `spec_version: context-layer/0.1-draft` and the closed schema;
- match exact recipient to this deployed agent and, where defined, the authenticated caller/client instance;
- validate `issued_at`, `expires_at`, clock skew, purpose, action, capability, restrictions, disclosure limits, and approval binding;
- validate decision, provenance, and receipt-contract references;
- return a policy-snapshot digest derived from verified evidence;
- mark single-use and approval-bound behavior accurately;
- reauthorize opaque handles on every use;
- perform durable replay reservation when required;
- fail closed when any key, policy, clock, revocation, or verification dependency is unavailable.

An issuer string allowlist plus the exact configured local-principal assumption is not authority-bound requester proof or integrity verification. `AAA_ALLOW_UNSIGNED_BUNDLES=true` is only for local fixtures and must be prohibited by production configuration policy.

The Context Layer working draft does not justify inventing a universal signature suite. Integrate the actual authority profile and document its assurance precisely.

## Production receipt store

Replace `FileReceiptStore` before distributed or material side-effect use. The production store must provide:

- durable, append-only or equivalently auditable persistence;
- atomic single-use bundle reservation;
- uniqueness for receipt IDs and action idempotency keys;
- safe concurrent writers across processes and regions;
- transactional ordering appropriate to the side effect;
- authenticated service identity and encryption in transit/at rest;
- minimized records with retention and deletion policy;
- tamper evidence, access audit, backup, restore, and reconciliation;
- explicit health/preflight behavior;
- a response path that distinguishes failure from an indeterminate post-effect state.

Never automatically retry a non-idempotent action after an indeterminate response. Reconcile the external system and receipt ledger first.

Receipts should contain references, digests, actors, operation, timestamps, outcome, and a user-safe summary. They should not copy tokens, bundle bodies, approved claim values, free-form prompts, or handler payloads.

## Action-handler requirements

Every action handler must:

- be registered in the reviewed local action configuration;
- accept only schema-validated input and the revocable approved request-local context view;
- enforce field, purpose, recipient, action, confirmation, retention, and onward-disclosure restrictions at point of use;
- honor the supplied expiry `AbortSignal` and never retain or copy context beyond the action;
- require authenticated scoped context, bound confirmation, durable receipts, and a caller/action-scoped idempotency key before any side effect;
- treat an exception after a possible side effect as indeterminate unless rollback is authoritatively proven;
- use bounded timeouts, output sizes, and dependency calls;
- prevent command, query, template, path, and URL injection;
- avoid direct raw-vault or long-term-memory access;
- return a schema-valid, secret-free result;
- express durable context changes only as proposals;
- document idempotency and side-effect behavior;
- have success, denial, timeout, replay, partial-failure, and receipt-failure tests.

Annotations, descriptions, or model-generated plans are untrusted. They cannot alter handler authorization.

## Public discovery

Public files must contain no:

- credentials, tokens, cookies, private URLs, tenant identifiers, or internal hostnames;
- raw context, personal data, prompts, policy exceptions, or selector-derived secrets;
- capabilities or protocol endpoints that are not implemented and tested.

`robots.txt`, `llms.txt`, `agent-hints.json`, and `ai-instructions.json` are advisory. They are not authentication, authorization, prompt-injection prevention, or a security perimeter.

`/.well-known/context-layer` is an unregistered draft convention. Keep its experimental status explicit. Do not create new `/.well-known` names without following RFC 8615 and the IANA registration process.

## Network deployment

The server binds to `127.0.0.1` by default. A non-loopback `HOST` is rejected unless `AAA_ALLOW_NETWORK_BIND=true`. That flag acknowledges exposure; it does not secure the service.

A production edge must additionally provide:

- HTTPS and current TLS policy;
- exact public-origin configuration;
- authenticated routing to the application;
- trusted-proxy configuration designed for the actual topology;
- request and header limits;
- distributed rate and abuse controls;
- denial of unexpected methods and content types;
- egress controls for any future outbound integration;
- isolated credentials and least-privilege filesystem access;
- health checks that reveal no sensitive state.

`AAA_ALLOWED_ORIGINS` accepts exact additional browser origins. It is not a wildcard mechanism. Requests without an Origin header remain possible for non-browser clients and still require normal authentication and authorization.

## Logging and errors

Log event names, stable error codes, route templates, request IDs, timing, and minimized actor/reference identifiers. Do not log authorization headers, bundle bodies, claim values, prompts, raw action input/output, or stack traces to shared production telemetry.

Errors intentionally avoid reflecting attacker-controlled values. Preserve that property. A protected-path dependency outage should be observable internally while producing a safe `503` externally.

## Dependency and change security

- Pin the package manager and lockfile.
- Run install with `--frozen-lockfile`.
- Review lockfile and transitive changes.
- Run `pnpm build`, `pnpm check`, and `pnpm test` on supported Node lines.
- Regenerate discovery and inspect diffs after configuration changes.
- Treat schema `$id`, action capability, authentication, receipt, and public-route changes as security-sensitive.
- Add negative tests before enabling a new adapter or extension.
- Never publish MCP or A2A discovery as a placeholder.

## Primary references

- [Context Layer specification](https://sierracatalina.com/context-layer/specification)
- [Context Layer implementation profiles](https://sierracatalina.com/context-layer/implementation)
- [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP Streamable HTTP security requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [A2A v1 specification](https://a2a-protocol.org/latest/specification/)
- [RFC 8615: Well-Known URIs](https://www.rfc-editor.org/rfc/rfc8615.html)
- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
- [W3C CSP Level 3](https://www.w3.org/TR/CSP3/)
