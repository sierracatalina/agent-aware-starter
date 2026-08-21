# Agent-Aware Starter

A conservative Node.js starter for publishing machine-readable site metadata and executing narrowly declared agent actions through Context Layer controls.

> [!IMPORTANT]
> `context-layer/0.1-draft` is a working draft. This repository is a **CL-Core-Consumer candidate and self-test implementation**. It is not certified, audited, or guaranteed conformant. Passing the local tests is evidence about this code revision only; it is not a certification claim.

MCP and A2A are adapter-ready architectural targets, but their runtimes are disabled and are not advertised. This starter does not expose `/mcp`, does not publish `/.well-known/agent-card.json`, and must not claim either protocol until a real adapter, authentication profile, and protocol test suite are configured.

## Request path

```text
public discovery metadata
        |
        v
authenticated action gateway
        |
        v
external Context Layer authority
        |
        v
verified, recipient-bound ScopedContextBundle
        |
        v
capability + restriction gate
        |
        v
declared action
        |
        v
durable, minimized receipt
        |
        v
proposal-only writeback
```

The gateway is a consumer of approved context. It is not a context vault or policy authority. Discovery describes what may be requested; it never grants permission. Authentication identifies a caller; it does not replace Context Layer purpose, recipient, field, action, expiry, or onward-disclosure policy.

See [Architecture](docs/architecture.md), [Security](SECURITY.md), and [Operations](docs/operations.md) before deploying.

## What is implemented

- Public discovery documents with explicit media types, cache policy, ETags, deprecation metadata, and no credentials.
- A read-only action catalog at `GET /api/v1/agent-actions`.
- Declared actions at `POST /api/v1/agent-actions/{actionId}` with bounded JSON input, request authentication where required, Context Layer bundle validation, recipient/action/restriction checks, revocable deadline-bound handler context, and minimized receipts.
- A development bearer authenticator and development issuer-allowlist bundle verifier that fail closed when unconfigured.
- A local JSONL receipt store with atomic single-use and caller-scoped idempotency reservations for development and single-process self-tests.
- Loopback binding by default, body limits, origin checks, rate limiting, safe errors, and defensive response headers.
- Closed phase-0 Context Layer schemas under `schemas/context-layer/` and self-tests under `test/`.

The starter does **not** implement a context vault, a Context Layer policy authority, direct memory mutation, MCP, A2A, OAuth authorization-server behavior, or production-grade key and receipt infrastructure.

## Discovery surface

| Path | Status | Meaning |
| --- | --- | --- |
| `/robots.txt` | Standard | RFC 9309 crawler preferences; never authorization. |
| `/llms.txt` | Proposal | Root-level llms.txt navigation document; advisory only. |
| `/agents.txt` | Community/project | agents.txt v1 integration summary; not an IETF or A2A standard. |
| `/agents.json` | Community/project | agents.txt v1 structured discovery; not an A2A Agent Card. |
| `/agent-manifest.json` | Project-specific | Capability manifest; not a Web App Manifest. |
| `/agent-hints.json` | Project-specific | Untrusted navigation hints; never a security boundary. |
| `/.well-known/context-layer` | Experimental draft | Unregistered Context Layer draft discovery convention. |
| `/openapi.json` | Standard format | OpenAPI description of the implemented HTTP surface. |
| `/context-layer-conformance.json` | Project-specific | Machine-readable candidate scope; explicitly not a certification. |
| `/.well-known/{llms.txt,agents.json,ai-instructions.json}` | Deprecated | Compatibility aliases with canonical links; see [migration guidance](docs/migration.md). |

`/agents.json` and `/agent-manifest.json` deliberately do not impersonate the registered A2A Agent Card. If A2A is enabled later, its native card belongs at `/.well-known/agent-card.json` and must describe only a tested A2A runtime.

## Requirements

- Node.js 22 LTS, 24 LTS, or 26 Current
- pnpm 11.19.0

Node.js 20 is end-of-life for the current support window and is not part of CI.

## Quickstart

Install and run all static and behavioral checks:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test
```

Start the safe local profile:

```bash
cp .env.example .env
node --env-file=.env server.js
```

Then inspect the public surface:

```bash
curl -i http://127.0.0.1:3000/healthz
curl -i http://127.0.0.1:3000/agents.json
curl -i http://127.0.0.1:3000/api/v1/agent-actions
```

The default `.env.example` intentionally leaves protected actions unavailable. For a local-only Context Layer action demo, set a bearer token of at least 16 characters, enable the development unsigned-bundle verifier, and explicitly allowlist the issuer used by the fixture. Never use that profile in production.

For PowerShell:

```powershell
Copy-Item .env.example .env
node --env-file=.env server.js
```

`pnpm verify` is the convenient aggregate command. CI invokes install, build, check, and test independently and never assumes an MCP, A2A, or external Context Layer server exists.

### Plain Express compatibility

The legacy middleware remains safe to mount directly:

```js
const express = require('express');
const agentHandler = require('./middleware/agent-handler');

const app = express();
app.use(agentHandler);
```

The default export and `agentHandler.createAgentAwareRouter(options)` compatibility
factory both include the safe JSON error boundary. Malformed or oversized JSON is
returned in the same minimized error envelope as `createApp`, without Express HTML,
stack traces, or filesystem paths. The lower-level `createAgentAwareRouter` export
from `src` requires an application-owned error boundary; prefer `createApp` or the
compatibility middleware for complete composition.

## Environment

The standalone server reads these variables. `.env` is not loaded implicitly by the library; use Node's `--env-file` option or your deployment platform.

| Variable | Safe default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address. Non-loopback values also require `AAA_ALLOW_NETWORK_BIND=true`. |
| `PORT` | `3000` | HTTP port. |
| `AAA_ALLOW_NETWORK_BIND` | `false` | Explicit acknowledgement of network exposure; not an authorization control. |
| `AAA_PUBLIC_ORIGIN` | bundled config | Public origin used to render same-origin metadata and validate browser origins. |
| `AGENT_AWARE_CONFIG` | bundled config | Optional path to an alternate validated agent-aware configuration file. |
| `AAA_RECEIPT_FILE` | `var/receipts.jsonl` | Local development receipt path. Replace the store in production. |
| `AAA_API_TOKEN` | unset | Development static bearer token; protected actions fail closed when unset. |
| `AAA_CLIENT_PRINCIPAL` | local URN | Principal recorded for the development bearer token. |
| `AAA_CLIENT_INSTANCE` | local URN | Client-instance identifier recorded for the development bearer token. |
| `AAA_ALLOW_UNSIGNED_BUNDLES` | `false` | Enables the development issuer-allowlist verifier only. Forbidden in production. |
| `AAA_TRUSTED_BUNDLE_ISSUERS` | empty | Comma-separated development issuer IDs. Not a signature trust store. |
| `AAA_ALLOWED_ORIGINS` | empty | Additional exact browser origins allowed for mutations. |

See [.env.example](.env.example) and [Operations](docs/operations.md) for deployment requirements.

## Context Layer contract

Context-requiring actions accept `Context-Layer-Version: 0.1-draft` and a `ScopedContextBundle` whose `spec_version` is `context-layer/0.1-draft`. The phase-0 schemas are closed. Their published `$id` semantics must not be changed in place.

The gateway must verify, at minimum:

- authority integrity and trusted issuer;
- intended recipient and authenticated caller binding;
- expiry and temporal validity;
- requested action and permitted capabilities;
- field and purpose restrictions;
- replay/single-use requirements;
- policy-snapshot evidence needed by the receipt contract.

The bundled unsigned verifier checks only a development issuer allowlist and an exact configured non-anonymous local-principal assumption; it does not prove cryptographic integrity or authority-bound requester identity and does not satisfy those production requirements. Validated context is exposed to handlers through a revocable read-only accessor. The accessor aborts and becomes inaccessible at the effective bundle deadline or immediately after the action, and the gateway refuses to report success if expiry occurs while a handler is running.

## Production gates

Before any network deployment, replace or provide:

1. A real caller authenticator with issuer, audience, expiry, scope, and revocation validation.
2. A cryptographic Context Layer bundle verifier tied to the external authority and exact recipient.
3. A durable, atomic receipt store with idempotency/replay controls and an outage policy appropriate to side effects.
4. Reviewed action handlers that enforce declared restrictions at the point of use.
5. TLS termination, an exact origin policy, rate limiting suitable for the deployment, secret-safe telemetry, and operational key rotation.
6. Protocol-specific adapters and conformance suites before publishing MCP or A2A discovery.

See [Candidate status and self-test claims](docs/conformance.md) for the exact claim boundary.

## Interoperability and versioning

- Context Layer core: `context-layer/0.1-draft`; working draft, unsupported majors rejected.
- Gateway documents: `aaa/1.0-draft`; application contract, not a protocol standard.
- MCP: date-versioned independently. A future adapter should target the current specification and negotiate its own extension identifier.
- A2A: wire version and Agent Card implementation version remain independent from Context Layer versions.
- Optional additions use explicit, collision-resistant extension identifiers. Unknown required extensions are rejected. Closed core schemas are never loosened silently.

Details are in [Interoperability](docs/interoperability.md).

## Primary references

- [Context Layer specification](https://sierracatalina.com/context-layer/specification)
- [Context Layer implementation profiles](https://sierracatalina.com/context-layer/implementation)
- [Model Context Protocol 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [A2A Protocol v1](https://a2a-protocol.org/latest/specification/)
- [RFC 8615: Well-Known URIs](https://www.rfc-editor.org/rfc/rfc8615.html)
- [RFC 9309: Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
- [llms.txt proposal](https://llmstxt.org/)
- [W3C Web App Manifest](https://www.w3.org/TR/appmanifest/)
- [W3C Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)

## License

UNLICENSED. Review `package.json` before redistribution.
