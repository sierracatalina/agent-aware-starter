# Candidate status and self-test claims

## Exact claim

This repository is a:

> CL-Core-Consumer candidate and self-test implementation for the working draft `context-layer/0.1-draft`.

It is **not**:

- certified;
- audited;
- guaranteed conformant;
- a Context Layer authority or vault;
- an official Context Layer test suite;
- an MCP server;
- an A2A agent;
- evidence that a deployment’s authenticator, verifier, receipt store, handlers, or edge are secure.

The words “candidate” and “self-test” must remain in public metadata and release notes until an external program defines and independently evaluates a stronger claim.

## What local verification can establish

`pnpm verify` can provide revision-specific evidence that:

- configuration and generated discovery agree;
- checked-in schemas and examples validate as expected;
- phase-0 core schemas reject unknown fields;
- version, recipient, action, expiry, restriction, and receipt gates behave as tested;
- protected paths fail closed when dependencies are absent;
- denied fields are omitted in covered cases;
- development receipts are minimized in covered cases;
- compatibility aliases and public headers match the project contract.

A passing run means only that the included tests passed against that checkout and Node runtime.

## What local verification cannot establish

Local tests do not prove:

- production issuer or key authenticity;
- token issuer/audience/scope/revocation correctness;
- cryptographic canonicalization or algorithm safety;
- distributed replay and single-use atomicity;
- receipt durability across replicas, regions, disaster, or adversarial operators;
- policy correctness at an external Context Layer authority;
- handler safety for integrations not present in fixtures;
- absence of every disclosure side channel;
- MCP or A2A conformance;
- operational TLS, proxy, CORS, CSRF, egress, logging, backup, or incident-response quality.

Those properties require deployment-specific integration, adversarial, and operational evidence.

## Evidence levels

| Level | Evidence | Permitted wording |
| --- | --- | --- |
| 0 | Documentation/design only | “designed to” or “targeting” |
| 1 | Static schema/config/build checks | “self-tested static contract” |
| 2 | Local behavioral and negative tests | “CL-Core-Consumer candidate/self-test implementation” |
| 3 | Production-component integration tests | Describe the exact tested authenticator/verifier/store profile; no general conformance claim |
| 4 | Independent program, if one exists | Use only the program’s authorized certification wording |

This starter targets Level 2. A deployment may be lower or higher for individual controls, but must not aggregate selective evidence into an unsupported certification claim.

## Self-test families

A defensible release should cover:

### Discovery and build

- canonical paths, aliases, status, media types, ETags, cache, CORS, and `nosniff`;
- deterministic regeneration and clean checked-in diff;
- public artifact secret scan;
- no MCP/A2A endpoints or claims while adapters are disabled.

### Schema and versioning

- valid and invalid fixtures for each closed Context Layer schema;
- exact `spec_version: context-layer/0.1-draft`;
- `Context-Layer-Version: 0.1-draft` handling;
- malformed IDs, URLs, times, digests, unknown fields, and oversized arrays;
- unsupported version and future-extension behavior.

### Context and capability enforcement

- expired/not-yet-valid bundle;
- wrong issuer, recipient, caller, action, purpose, or capability;
- local declaration narrowing a broader request;
- restrictions surviving through handler input and output;
- denied claim text absent from serialization, receipts, logs, and errors;
- prompt or hint text unable to expand capability;
- required human confirmation and approval binding;
- reauthorization on every handle/bundle use.

### Receipts and replay

- required-store preflight fail closed;
- atomic single-use reservation conflict;
- idempotent duplicate delivery;
- minimized success/failure receipts;
- policy snapshot evidence;
- post-effect write failure reported as indeterminate;
- no blind retry after an indeterminate effect;
- proposal-only writeback.

### Transport and abuse

- body/content-type limits and malformed JSON;
- safe Origin allow/deny behavior;
- rate limiting and bounded error details;
- secret-free, stable errors;
- concurrent requests and failure injection;
- SSRF/file/private-network rejection when URL-capable handlers are added.

### Adapter parity, when enabled

The same logical request through direct HTTP, MCP, and A2A must yield the same Context Layer decision, redaction, restrictions, handler capability, receipt, and proposal behavior. Native protocol version, authentication, discovery, and extension suites are additionally required.

## Release evidence record

For each release, retain:

- exact commit and lockfile digest;
- Node/pnpm matrix;
- generated-discovery diff/check result;
- test report and fixture versions;
- schema `$id` inventory;
- known skipped or deployment-only tests;
- security-relevant configuration changes;
- dependency audit disposition;
- reviewer and date.

Do not retain credentials, private context, or raw protected payloads in test artifacts.

## Change rules

A change to a core schema `$id`, required field, default-deny behavior, recipient/action binding, receipt requirement, or unknown-field behavior requires explicit version review. Do not loosen a published closed schema in place.

A future extension profile needs a new schema/identifier, negotiation rules, fallback/error behavior, and independent tests. Unsupported required extensions fail.

## Primary references

- [Context Layer specification](https://sierracatalina.com/context-layer/specification)
- [Context Layer required conformance tests](https://sierracatalina.com/context-layer/specification#14-required-conformance-tests)
- [Context Layer versioning](https://sierracatalina.com/context-layer/specification#15-versioning)
- [Context Layer implementation profiles](https://sierracatalina.com/context-layer/implementation)
