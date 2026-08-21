# Contributing

Contributions should preserve the starter’s central invariant: public metadata describes possibilities, while authenticated server-side code and a verified external Context Layer decision grant only the narrow capability used for an action.

Read [Architecture](docs/architecture.md), [Security](SECURITY.md), and [Candidate status](docs/conformance.md) before changing schemas, discovery, authentication, receipts, actions, or adapters.

## Setup

Use a supported Node line and the pinned package manager:

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Supported CI lines are Node.js 22 LTS, 24 LTS, and 26 Current with pnpm 11.19.0.

Do not add secrets to `.env.example`, fixtures, generated discovery, tests, logs, issues, commits, or pull requests.

## Development workflow

1. Create a focused branch.
2. Make one logical change.
3. Update schemas/configuration and tests together.
4. Run `pnpm build` and inspect generated discovery.
5. Run `pnpm check` and `pnpm test`.
6. Review the full diff for secrets, unsupported claims, and accidental generated changes.
7. Document security, schema, environment, and migration impact.

The build output should be deterministic. Edit its configured source rather than hand-editing generated public documents unless the repository explicitly identifies a file as a source.

## Adding or changing an action

An action change must include:

- stable ID, name, and truthful description;
- bounded JSON input and output schemas;
- authentication requirement;
- Context Layer requirement and exact allowed claims/purposes;
- side-effect classification;
- human-confirmation requirement;
- receipt and replay/idempotency behavior;
- handler with point-of-use restriction enforcement;
- no raw-vault or direct-memory access;
- success, denial, malformed input, injection, timeout, replay, and receipt-failure tests;
- regenerated discovery/OpenAPI and migration notes for breaking changes.

Descriptions and annotations are untrusted metadata. Never use them as authorization.

## Context Layer schemas

Phase-0 core schemas use `spec_version: context-layer/0.1-draft`, public immutable `$id` values, and `additionalProperties: false`.

Do not:

- add ad hoc fields to a closed schema;
- silently reinterpret a published `$id`;
- infer acceptance of an unknown extension;
- weaken recipient, action, purpose, expiry, receipt, or writeback requirements;
- describe the working draft as certified or conformant.

A future extension requires a collision-resistant identifier, explicit version, required/optional semantics, fallback/error rules, new fixtures, negative tests, and a reviewed schema/version boundary.

## Discovery changes

For every discovery change, verify:

- the path is standard, registered, proposal-based, draft, or project-specific as labeled;
- the endpoint/capability actually exists;
- media type, cache, ETag, CORS, canonical/deprecation headers, and `nosniff`;
- no credentials, private context, tenant data, internal URLs, or policy exceptions;
- `/robots.txt` and `/llms.txt` remain at the origin root;
- project-specific `agents.json` is not presented as an A2A Agent Card;
- hints are advisory, not a security perimeter.

Follow [Legacy discovery migration](docs/migration.md) rather than deleting or redirecting paths without client and cache analysis.

## Protocol adapters

MCP and A2A are disabled and not advertised. A contribution must not add placeholder discovery.

An MCP adapter requires a current native transport/discovery implementation, OAuth resource/audience controls for HTTP, exact version/header validation, Origin controls, schema-valid tools, negative tests, and Context Layer parity.

An A2A adapter requires a real v1 interface, native authentication/version/task semantics, truthful Agent Card, extension negotiation, negative tests, and Context Layer parity.

The adapter must call the same guarded core. It may not implement a second, weaker authorization path.

## Security-sensitive review

Request focused security review for:

- authentication, token, key, issuer, audience, or tenant logic;
- bundle integrity, recipient/time/action/restriction checks;
- receipt reservation, idempotency, durability, or indeterminate outcomes;
- new side effects, URLs, subprocesses, file paths, templates, or queries;
- public routes, CORS, origins, proxy, TLS, or headers;
- dependency and lockfile changes;
- schema/version/extension changes;
- MCP, A2A, or other protocol advertising.

Add negative and failure-injection tests before the implementation change is considered complete.

## Commit and pull-request format

Use scoped commits:

```text
type(scope): short imperative summary
```

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `schema`, and `migration`.

Keep the subject under 72 characters. Mention schema and migration impact explicitly.

A pull request should include:

1. summary;
2. changed files or areas;
3. database/schema impact;
4. testing performed and Node lines;
5. risks or follow-up work;
6. environment variables, breaking behavior, and migration/rollback notes;
7. manual steps for user-visible or deployment behavior.

Do not claim production readiness or protocol conformance unless the stated tests actually establish that exact profile.

## Before requesting review

- [ ] `pnpm install --frozen-lockfile` succeeds.
- [ ] `pnpm build`, `pnpm check`, and `pnpm test` pass.
- [ ] Generated discovery diff is intentional and secret-free.
- [ ] New behavior has denial and dependency-failure coverage.
- [ ] Docs and `.env.example` match the actual runtime.
- [ ] Schema/version and migration impact is explicit.
- [ ] MCP/A2A remain unadvertised unless their full enablement gate is met.
- [ ] The Context Layer claim remains candidate/self-test only.
