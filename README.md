# Agent Aware Architecture (AAA)

AAA is a machine-readable handshake for agent-aware sites and Settings surfaces. Agents read a small well-known set instead of inferring intent from the DOM.

## Start here

| Document | Role |
| --- | --- |
| [PROPOSAL.md](PROPOSAL.md) | Short entry |
| [docs/proposals/aaa-handshake.md](docs/proposals/aaa-handshake.md) | Protocol write-up |
| [spec/00-overview.md](spec/00-overview.md) | Spec tree entry |
| [schemas/](schemas/) | JSON Schema (draft 2020-12) |
| [examples/](examples/) | Fixtures (`live: false`) |

## Spec tree

1. [00-overview](spec/00-overview.md) — scope
2. [01-handshake](spec/01-handshake.md) — discovery sequence
3. [02-well-known](spec/02-well-known.md) — `ai-instructions.json`, `agents.json`, `llms.txt`
4. [03-settings-surface](spec/03-settings-surface.md) — Settings and hand-off profiles, `action_root: "none"`, deep links
5. [04-safety](spec/04-safety.md) — guardrails and confirmation
6. [05-ownership](spec/05-ownership.md) — what this handshake covers

## Handshake

```text
surface encountered
  -> GET /.well-known/ai-instructions.json
  -> GET discovery.actions (usually /.well-known/agents.json)
  -> GET discovery.context (usually /.well-known/llms.txt)
  -> if action_root is an HTTP path or URL → call only mapped actions
  -> if action_root is the string "none" → use a documented Settings destination or human hand-off
```

Settings-desktop deep-link pattern:

```text
app://settings?id=<anchor>
```

Examples in this repository set `"live": false`. They are fixtures, not a published origin.

## Examples

- [examples/well-known/](examples/well-known/) — generic site; HTTP `action_root`
- [examples/product-examples/settings-desktop/](examples/product-examples/settings-desktop/) — Settings surface; `action_root` is the string `none`
- [examples/product-examples/handoff-site/](examples/product-examples/handoff-site/) — AAA/0.2 service catalog; human-operated payment and `action_root: "none"`

## Status and checks

- Protocol target: `AAA/0.2`; two current schemas with identity `0.2.0`, plus two byte-frozen 0.1 schemas
- Reference suite: 177 tests; six JSON fixtures, all `live: false`
- Node 20 or later; no dependencies or package installation

```sh
node --test reference/
node reference/validate.mjs examples/well-known/agents.json
node reference/validate.mjs examples/well-known/ai-instructions.json
```

CI runs the tests and validates every JSON file under `examples/` on pushes and pull requests. Any nonzero result fails the check. The [validator](reference/validate.mjs) exits 0 for valid, 1 for invalid, and 2 for usage or I/O errors.

## Reference reader

```sh
node reference/read.mjs https://example.com
node reference/read.mjs https://example.com --strict --json
node reference/read.mjs https://example.com --action get_status --json
```

The [reader](reference/read.mjs) follows `ai-instructions.json` → `agents.json` → `llms.txt`, using the [bounded public-HTTPS fetch policy](spec/01-handshake.md#fetching-the-files). It reports a map and warnings; it does not execute actions. Unknown fields warn and are ignored by default. `--strict` makes every schema error invalid. The library exports `readOrigin(origin, options)`; the validator exports `validateDocument(doc, kind)` using the same strict engine as its CLI.

Outcomes are `ok`, `missing`, `invalid`, `fetch_refused`, `unknown_action`, or `settings_profile`. Exit 0 means `ok` or `settings_profile`; exit 1 means no usable requested map; exit 2 means usage error. An unknown action is never guessed. `action_root: "none"` never becomes an invented HTTP API. Permissive flags are advisory, and restrictive lists only tighten the consumer's existing policy.

`--allow-http-local` is only for an explicitly selected loopback HTTP test fixture, such as `node reference/read.mjs http://127.0.0.1:8080 --allow-http-local`. It does not permit loopback/private redirect targets or weaken production HTTPS checks. Keep it out of production invocations.

## Publication conformance

```sh
node reference/conform.mjs --serve examples/well-known
node reference/conform.mjs --serve examples/product-examples/settings-desktop --json
node reference/conform.mjs https://example.com
node reference/conform.mjs http://127.0.0.1:8080 --allow-http-local
```

The [conformance runner](reference/conform.mjs) fetches the handshake and checks the authoring schemas plus the live-publication rules in [spec 02](spec/02-well-known.md#what-live-means): `application/json` for both JSON files, `text/plain; charset=utf-8` for `llms.txt` when present, `last_updated` on both documents when `live: true`, and well-known paths for a live claim. `--serve <dir>` hosts a fixture directory (a flat trio or a `.well-known/` subdirectory) on loopback and runs the same checks. Exit 0 means every check passed; 1 means a check failed; 2 is usage or I/O. The library exports `conformOrigin(origin, options)` and `serveAndConform(dir)`.

For new fields and experimental-name mappings, see [migration to 0.2](docs/migration-0.2.md).

## Historical starter

The original Express demo that served `public/.well-known` lives under [reference/historical-starter/](reference/historical-starter/). See [reference/starter-runtime.md](reference/starter-runtime.md).

## License

MIT License. Copyright (c) 2026 Sierra Catalina. See [LICENSE](LICENSE).
