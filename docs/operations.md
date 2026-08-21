# Operations

## Operational status

This starter is safe for local development and self-test only until production dependencies are injected. It is a CL-Core-Consumer candidate for the working draft `context-layer/0.1-draft`, not a certified or conformant deployment.

The standalone server intentionally fails protected work closed when authentication or bundle verification is not configured. Do not “fix” that behavior by falling back to anonymous access or accepting an unverified bundle.

## Runtime profiles

| Profile | Intended use | Components |
| --- | --- | --- |
| Static verification | CI and review | Build discovery, validate config/schemas, run unit and integration tests. No server or external protocol runtime. |
| Local safe default | Inspect public discovery and unprotected status | Loopback server, protected actions unavailable, local JSONL receipt file. |
| Local bundle fixture | Test a known development fixture | Loopback server, static bearer, explicitly enabled unsigned issuer allowlist, local receipts. Never network-expose. |
| Production | Real actions and context | TLS edge, production authenticator, cryptographic bundle verifier, durable receipt/replay store, reviewed handlers, external Context Layer authority. |

MCP and A2A have no runtime profile in this repository. Add them only through separately tested adapters.

## Supported toolchain

- Node.js 22 LTS, 24 LTS, or 26 Current
- pnpm 11.19.0
- the committed `pnpm-lock.yaml`

Install exactly the locked graph:

```bash
pnpm install --frozen-lockfile
```

Run the same phases as CI:

```bash
pnpm build
pnpm check
pnpm test
```

`pnpm verify` runs the aggregate local sequence.

## Environment variables

The standalone `server.js` reads process environment directly. It does not load `.env` itself. Node can load a file with `node --env-file=.env server.js`.

| Variable | Default | Operational rule |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Keep loopback for development. |
| `PORT` | `3000` | Integer from 1 through 65535. |
| `AAA_ALLOW_NETWORK_BIND` | false | Must equal `true` for non-loopback binding. Acknowledges exposure only. |
| `AAA_PUBLIC_ORIGIN` | configured site URL | Set the exact externally visible origin. Use HTTPS in production. |
| `AGENT_AWARE_CONFIG` | bundled config | Optional path to an alternate validated configuration file. Treat configuration as reviewed code. |
| `AAA_RECEIPT_FILE` | `var/receipts.jsonl` | Development store path. Ensure directory permissions and backup policy; replace for production. |
| `AAA_API_TOKEN` | unset | Static development bearer. At least 16 characters; unset makes protected actions unavailable. |
| `AAA_CLIENT_PRINCIPAL` | `urn:aaa:client:local` | Development identity recorded after static-token authentication. |
| `AAA_CLIENT_INSTANCE` | `urn:aaa:client-instance:local` | Development client-instance identity. |
| `AAA_ALLOW_UNSIGNED_BUNDLES` | false | Enables the development issuer allowlist. Must remain false in production. |
| `AAA_TRUSTED_BUNDLE_ISSUERS` | empty | Comma-separated development issuer identifiers. Does not verify signatures. |
| `AAA_ALLOWED_ORIGINS` | empty | Comma-separated exact additional browser origins for mutations. |

Do not commit `.env`. The checked-in [.env.example](../.env.example) contains no working secret.

## Local safe-default runbook

```bash
pnpm install --frozen-lockfile
pnpm verify
cp .env.example .env
node --env-file=.env server.js
```

Expected startup behavior:

- bind `127.0.0.1:3000`;
- render only configured public discovery;
- serve health and the read-only action catalog;
- return a safe unavailable/authentication error for protected execution;
- create the receipt file only when a receipt is written.

Smoke checks:

```bash
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://127.0.0.1:3000/llms.txt
curl -fsS http://127.0.0.1:3000/agents.json
curl -fsS http://127.0.0.1:3000/openapi.json
curl -fsS http://127.0.0.1:3000/api/v1/agent-actions
```

Inspect headers during review:

```bash
curl -i http://127.0.0.1:3000/agents.json
curl -i -H 'If-None-Match: "<etag-from-previous-response>"' http://127.0.0.1:3000/agents.json
```

Verify content type, ETag/304 behavior, cache policy, `nosniff`, and the absence of secrets.

## Local fixture profile

Only on loopback, set:

```dotenv
AAA_API_TOKEN=replace-with-a-local-token-at-least-16-characters
AAA_ALLOW_UNSIGNED_BUNDLES=true
AAA_TRUSTED_BUNDLE_ISSUERS=urn:example:context-authority:development
```

The bundle’s issuer must match the explicit allowlist, and the authenticated principal must exactly match `AAA_CLIENT_PRINCIPAL`. The bearer token must be sent in `Authorization: Bearer ...`. Context-requiring actions also require `Context-Layer-Version: 0.1-draft`.

This verifies data flow, not integrity. The development verifier does not validate a signature, audience, key, revocation, or full approval binding.

## Production composition

Use the library factory rather than the development `server.js` wiring. Inject all of the following:

1. **Authenticator:** validates issuer, resource audience, lifetime, scope, revocation, algorithms, and produces a stable principal/client instance.
2. **Bundle verifier:** authenticates the external authority, validates integrity and recipient/caller/action/purpose/time/restrictions, reports policy snapshot evidence, and supports replay/approval semantics.
3. **Receipt store:** durable and atomic across replicas, with single-use reservation, idempotency, audit, retention, backup, and reconciliation.
4. **Handlers:** reviewed, bounded implementations that enforce restrictions at point of use and create proposals instead of direct memory writes.
5. **Logger:** structured and redacted; never serializes tokens, bundles, claims, prompts, or action payloads.
6. **Edge controls:** TLS, exact origin/routing, distributed abuse limits, request limits, timeouts, egress restrictions, and secret management.

A typical network bind also needs:

```dotenv
HOST=0.0.0.0
AAA_ALLOW_NETWORK_BIND=true
AAA_PUBLIC_ORIGIN=https://agent.example
```

Do not set those values until all production components and the edge are ready. `AAA_ALLOW_NETWORK_BIND` is not authentication.

## External Context Layer authority

The authority remains a separate service and trust zone. Operational integration must define:

- mutually authenticated transport or equivalent service authentication;
- issuer and key discovery/pinning;
- exact gateway recipient identifier;
- request and bundle timeouts;
- clock synchronization and allowed skew;
- policy and schema version compatibility;
- replay/single-use coordination;
- approval binding;
- receipt delivery and reconciliation;
- authority outage and key-rotation runbooks.

The action gateway should not make an authority outage transparent through cached over-broad context. Expired context stays expired. Handlers must honor the injected `AbortSignal`; the gateway also races execution against effective expiry, revokes the read-only context membrane, and rechecks the deadline before success.

## Receipt operations

The JSONL file is suitable only for local, single-host development. Limit filesystem access to the runtime identity, keep it outside public roots, and treat it as sensitive operational metadata even though payloads are minimized.

For production:

- preflight the store before a receipt-required action;
- reserve a single-use bundle atomically;
- require `Idempotency-Key` for every side-effecting action and reserve it atomically per caller and action;
- persist enough evidence to reconcile without copying context values;
- monitor write latency, conflict, reservation, and failure rates;
- back up and restore-test the ledger;
- implement retention/deletion policy;
- surface a post-effect persistence failure as indeterminate;
- never blindly retry an indeterminate non-idempotent action.

## Health and monitoring

`GET /healthz` is a shallow process/configuration signal and intentionally reveals little. It does not prove that the identity provider, authority verifier, receipt store, or downstream side-effect systems are healthy.

Production readiness should use an internal authenticated check that evaluates dependencies without returning secrets publicly. Track at least:

- request rate, latency, response class, and stable error code;
- authentication invalid/unavailable counts;
- bundle validation, issuer, recipient, expiry, replay, and restriction denials;
- receipt preflight/write/reservation latency and failures;
- indeterminate action outcomes;
- per-action handler timeout/error counts;
- discovery generation/check failures;
- dependency and key-rotation health.

Use route templates and opaque/minimized identifiers. Never emit authorization headers, bundle bodies, approved values, or raw input/output.

## Failure runbook

| Signal | Immediate action | Retry rule |
| --- | --- | --- |
| `AUTHENTICATION_UNAVAILABLE` | Restore identity verification; inspect provider/key health. | Retry only after verification is healthy. |
| `BUNDLE_VERIFICATION_UNAVAILABLE` | Restore verifier/key/policy dependencies. | Obtain/reverify a fresh bundle. |
| issuer/recipient/version/expiry rejection | Check configuration and authority issuance; do not weaken checks. | Correct the mismatch and request a new bundle. |
| `RECEIPT_STORE_UNAVAILABLE` before action | Restore store and verify atomic reservation. | Safe to retry because handler did not run. |
| receipt failure after possible effect | Mark incident indeterminate; reconcile receipt and external system. | Do not retry until idempotency/effect is proven. |
| replay or idempotency conflict | Investigate duplicate client delivery or abuse. | Reconcile the original result/receipt; do not re-execute. |
| `BUNDLE_EXPIRED` during handler execution | Confirm downstream cancellation and inspect the minimized failure receipt. | Obtain a new decision/bundle; never reuse the expired view. |
| repeated `429` | Inspect abuse/client behavior and distributed limits. | Honor backoff; do not bypass the limiter. |
| discovery check drift | Regenerate, review diff, and rerun tests. | Do not deploy stale or falsely advertised metadata. |

## Deployment checklist

- [ ] `pnpm install --frozen-lockfile`, build, check, and test pass on a supported Node line.
- [ ] Generated discovery diff is reviewed and contains no secrets.
- [ ] Public origin, recipient IDs, action contracts, and allowed origins are exact.
- [ ] Non-loopback exposure is intentional and protected by TLS/edge controls.
- [ ] Development static auth and unsigned bundle flags are impossible in production policy.
- [ ] Authenticator negative tests cover issuer, audience, expiry, scope, revocation, and tenant confusion.
- [ ] Bundle verifier tests cover integrity, recipient, action, time, replay, approval, restrictions, and denied-field absence.
- [ ] Receipt store passes concurrency, atomic reservation, outage, backup, restore, and reconciliation tests.
- [ ] Action handlers pass injection, timeout, idempotency, side-effect, and receipt-failure tests.
- [ ] Logs/errors are inspected for secrets and protected values.
- [ ] MCP and A2A remain absent from discovery unless real adapters pass native tests.
- [ ] Rollback preserves receipt/replay state and does not re-enable an older insecure schema or policy.

## CI

The workflow tests Node 22 LTS, 24 LTS, and 26 Current. It installs pnpm 11.19.0, installs the frozen lockfile, then runs build, check, and test as distinct steps. It does not start a server or require network access to MCP, A2A, or a Context Layer authority.

Tests should use injected fixtures and temporary receipt paths. They must not depend on developer `.env` files.
