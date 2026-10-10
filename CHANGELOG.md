# Changelog

## AAA/0.2 — 2026-10-10

- Corrected the task-4 test count to 20 and aligned discovery order across
  entry-point documentation. Added Node 20 push/PR CI for all reference tests
  and every JSON example, plus a directory test entry point for Node 20+.
- Defined bounded public-HTTPS fetching, checked/pinned DNS, redirect and
  same-origin discovery rules, and tighten-only consumption. Autonomy flags
  remain advisory and cannot change behavior.
- Exported `validateDocument(doc, kind)` from the existing validator engine
  without changing its CLI. Added a read-only, lenient-by-default reference
  reader with strict mode, explicit outcomes, local fixture support, and
  adversarial network/merge tests. The full reference suite has 165 tests.
- Defined live-publication requirements and added a dated live-origin
  registry distinguishing frozen-0.1 diagnostics from current-schema results.

- Added schema identity `0.2.0` while preserving every previously accepted
  AAA/0.1 document, arbitrary nonempty version labels, and legacy protocol
  strings. Frozen the previous main schemas byte-for-byte under `schemas/0.1/`.
- Added optional `agents.json` protocol/update metadata and
  `ai-instructions.json` `discovery.full_text`, `discovery.markdown_twin`, and
  `policy.read_freely`. All are descriptive; AAA never grants authority.
- Extended `out_of_settings_actions` with optional `name`, `service`, `href`
  (`uri-reference`), `price`, and `duration` strings. Kept `id`, `how_to`, and
  `requires_human_confirmation` required. Added no experimental field aliases.
- Made `additionalProperties: false` explicit on every current object schema,
  preserving arbitrary extension/parameter maps and string-valued selector
  maps through catch-all `patternProperties`.
- Added reference-validator support and regression coverage for pattern maps,
  URI references, every new field, strict vendor fields, existing fixtures,
  frozen hashes, and additive schema compatibility.
- Documented the hand-off profile and added a fictional, `live: false`
  `handoff-site` fixture with human-only checkout and AAA/0.2 field names.
- Added complete field tables and `docs/migration-0.2.md`. Changes within a
  minor version MUST be additive; breaking changes while `0.x` MUST bump the
  minor version. Prior schemas remain available for at least one release
  cycle. Consumers SHOULD be lenient by default without expanding authority.

## task-4 — 2026-10-06

- Tightened `schemas/agents.schema.json` and `schemas/ai-instructions.schema.json`:
  `additionalProperties: false` at every object level, with a single
  `extensions` object for vendor-specific extras.
- Defined `endpoints[]` items in `agents.json` (`name`, `path`, `method`
  required; `description`, `risk_level`, `parameters` optional).
- Declared the fields the repo's own examples use (`policy`, `discovery`,
  `protocol`, `status`, `last_updated`, `http_action_api`, `notes`,
  `settings_actions`, `deep_link_pattern`); no example documents changed.
- Fixed `agent_card.endpoints.action_root`: `oneOf` rejected the settings
  profile value `"none"` (it matched both branches) even though spec 00
  invariant 2 requires it. Changed to `anyOf`, keeping the intended meaning.
  The repo's `settings-desktop` example failed validation before this fix.
- Added `reference/validate.mjs`, a dependency-free CLI that validates
  `agents.json` / `ai-instructions.json` documents against the schemas
  (exit 0 = valid, 1 = invalid, 2 = usage error).
- `policy.allow_autonomous_execution: true` is reported as ADVISORY only —
  AAA never grants authority (spec 00, invariant 1). Covered by tests.
- Added `reference/validate.test.mjs` (20 tests, `node --test`).
