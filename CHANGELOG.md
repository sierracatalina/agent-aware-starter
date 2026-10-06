# Changelog

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
- Added `reference/validate.test.mjs` (14 tests, `node --test`).
