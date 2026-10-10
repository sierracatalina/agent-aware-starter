# AAA schemas

- [`agents.schema.json`](agents.schema.json) and [`ai-instructions.schema.json`](ai-instructions.schema.json): current additive AAA/0.2 schemas, identity `0.2.0`.
- [`0.1/`](0.1/): byte-for-byte frozen main-branch schemas from before the 0.2 update. Keep them unchanged for at least one release cycle.

All current object schemas declare `additionalProperties: false`. A `patternProperties` pattern of `^` deliberately matches every property name, including empty names and line breaks, preserving unrestricted extension/parameter values and string-valued selector maps.

See [version policy and migration](../docs/migration-0.2.md). Consumers SHOULD be lenient by default; the reference validator is a strict authoring/CI check.
