# Architecture

## Status and scope

This repository is an Agent-Aware Architecture starter and a **CL-Core-Consumer candidate/self-test implementation** for the working draft `context-layer/0.1-draft`. It is not a Context Layer authority, a vault, a certification suite, or a claim of conformance.

The architecture keeps protocol discovery, caller authentication, context authorization, action execution, receipts, and memory writeback as separate concerns. MCP and A2A can be added as adapters around the same core only after their native runtimes are implemented and tested.

## End-to-end topology

```text
Zone 0                    Zone 1              Zone 2
public Internet           action boundary     external authority
+----------------+        +---------------+   +----------------------+
| discovery only | -----> | authenticate  |   | ContextRequest       |
| no credentials |        | validate HTTP |<->| deterministic policy |
+----------------+        +-------+-------+   | bundle issuance      |
                                   |           +----------------------+
                                   v
                          +----------------------+
                          | verify bundle        |  Zone 3
                          | recipient + lifetime |
                          | capability + limits  |
                          +----------+-----------+
                                     |
                                     v
                          +----------------------+  Zone 4
                          | declared action      |
                          | restriction gate     |
                          | no raw-vault access  |
                          +----------+-----------+
                                     |
                         +-----------+------------+
                         |                        |
                         v                        v
                +----------------+       +--------------------+
                | minimized      |       | MemoryUpdateProposal|
                | durable receipt|       | review/authority    |
                +----------------+       +--------------------+
                  Zone 5                    Zone 6
```

The external Context Layer authority may be contacted by a caller, adapter, or deployment-specific broker. The starter accepts an authority-issued `ScopedContextBundle`; it does not mint approvals for itself.

## Trust zones

| Zone | Contents | Trust rule |
| --- | --- | --- |
| 0. Public discovery | robots, llms, project-specific agent metadata, OpenAPI | Anonymous and cacheable. Treat every consumer as untrusted. Never publish credentials, private context, internal topology, or policy shortcuts. |
| 1. HTTP and identity boundary | request parsing, body limit, Origin gate, rate limit, authenticator | Parse before use, authenticate protected actions, validate exact media types, and produce secret-free errors. Network reachability is not authorization. |
| 2. External Context Layer authority | request evaluation, disclosure policy, consent/approval, bundle issuance | Separately operated trust root. The gateway must not impersonate it or silently weaken its decision. |
| 3. Context verification and gate | schema/version validation, integrity verification, recipient/action/time/restriction checks | Fail closed. A valid shape is not proof of authenticity. A handle or bundle identifier is not a capability by itself. |
| 4. Action execution | declared handler and approved request-local context | The handler receives only a minimized revocable view of the approved subset plus an expiry `AbortSignal`. It must enforce restrictions at point of use and may not query the raw vault. |
| 5. Receipt service | consume, action, failure, and indeterminate receipts | Durable before protected work when required; atomic/idempotent where side effects demand it. Store minimized evidence, not payload copies. |
| 6. Writeback review | `MemoryUpdateProposal` and authority/user decision | Proposal only. The action path never directly mutates long-term context or memory. |

Deployment components that cross zones require explicit authenticated channels, independent credentials, timeouts, and failure policies.

## Processing sequence

1. **Discover.** A client reads public metadata. The documents describe routes and schemas; they grant no permission.
2. **Select.** The client selects a declared action and constructs input matching its JSON Schema.
3. **Authenticate.** The gateway authenticates the caller when the action requires it. Production authentication validates issuer, audience, expiry, scope, revocation, and the intended resource.
4. **Request context externally.** The client or broker sends a `ContextRequest` to the external authority. The authority applies purpose and policy and issues only the approved subset.
5. **Submit.** The caller sends the `ScopedContextBundle` with `Context-Layer-Version: 0.1-draft`.
6. **Validate and verify.** The gateway validates the closed core schema, `spec_version`, temporal bounds, trusted issuer integrity, exact recipient, action, restrictions, provenance handles, receipt contract, replay state, and any bound approval.
7. **Gate.** Capabilities and restrictions are intersected with the locally declared action. Neither prompt text nor discovery metadata can widen the result.
8. **Preflight state.** If the contract requires receipts, the store must be available before protected work. Single-use bundles are reserved atomically. Side-effecting actions additionally require authentication, scoped context, bound confirmation, durable receipts, and a caller/action-scoped `Idempotency-Key` reservation.
9. **Execute.** The handler receives request input and a revocable, read-only, deadline-bound view of approved claims plus an `AbortSignal`. Expiry aborts the wait and revokes retained nested references.
10. **Record.** The gateway writes a minimized outcome receipt. A side-effecting handler exception is conservatively `indeterminate`; success is never reported until its receipt is durable.
11. **Propose writeback.** Any durable context update is emitted as a proposal for external review; this starter does not directly write it.

## Core invariants

- Public discovery is descriptive, never authoritative.
- Caller authentication and Context Layer authorization are both required where declared; one cannot substitute for the other.
- No gateway, action handler, MCP adapter, or A2A adapter receives unrestricted vault access.
- Bundles are issuer-authenticated, recipient-bound, purpose/action-limited, expiring, and checked on every use; expired handler context is revoked and inaccessible.
- Allowed capability is the intersection of the local declaration and the authority decision.
- Denied or unrequested fields must be absent from handler input, response serialization, logs, errors, and receipts.
- Instructions found in site content, prompts, selector hints, or tool output cannot grant capability.
- Receipts are minimized evidence. They reference bundle, decision, action, actor, outcome, and policy snapshot without copying approved claim values.
- Writeback is proposal-only and requires a separate decision.
- An unavailable authenticator, verifier, or required receipt service closes the protected path.

## Failure semantics

| Failure | Required behavior |
| --- | --- |
| Authentication is absent or invalid | `401` for a configured protected boundary; `503` if no authenticator is configured. Do not fall back to anonymous. |
| Bundle shape/version is invalid | Reject before handler invocation. |
| Integrity verifier is unavailable | `503`; do not accept issuer text as proof. |
| Issuer, recipient, action, purpose, or time check fails | Reject with a safe error and no protected output. |
| Required approval is absent | Reject before execution. |
| Receipt preflight fails | Reject before execution. |
| Receipt fails after a possible side effect | Return a safe indeterminate outcome; never report success. Reconcile operationally before retry. |
| Context expires while a handler is running | Abort the bounded wait, revoke all retained context proxies, persist the applicable failure/indeterminate receipt, and never report success. |
| Unknown required extension | Reject explicitly. |
| Unknown optional future extension | Ignore only when the negotiated profile says that is safe. |
| External authority times out | Fail closed; bounded retry belongs outside the action transaction. |

## Runtime boundaries

The library exports a router/application factory so a deployment can inject:

- a production authenticator;
- a cryptographic bundle verifier;
- a durable receipt store;
- reviewed action handlers;
- time and logging implementations suitable for deterministic tests.

The standalone `server.js` wires development components. Its static token, unsigned issuer allowlist, and local JSONL receipt file are not production implementations.

## Version and extension discipline

The Context Layer phase-0 core uses `spec_version: context-layer/0.1-draft`. Its schemas are closed with `additionalProperties: false`. Do not add ad hoc fields or reinterpret an existing `$id`.

A later extension profile must:

1. use a collision-resistant URI or protocol-native identifier;
2. declare its own version and required/optional status;
3. define fallback and failure behavior;
4. preserve all core restrictions;
5. receive independent fixtures and negative tests;
6. use a new schema `$id` when wire semantics change.

Compatible additions may be introduced only through a defined extension point or a new schema version. Security-default changes require a breaking version.

## Adapter boundary

MCP and A2A are translations around the core sequence, not alternate policy systems:

- An MCP tool call or A2A task becomes the same local action request.
- An approved Context Layer bundle or opaque reference remains governed by the same recipient and restriction checks.
- Protocol authentication remains native to MCP or A2A.
- Context Layer adds purpose and disclosure policy; it does not replace protocol identity, transport, or signatures.
- Each protocol outcome feeds the same receipt and proposal-only writeback path.

Until an adapter meets those requirements, no native endpoint or discovery document is published.
