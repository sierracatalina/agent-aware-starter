# Changelog

## AAA/0.1 document profile 0.1.1

- Publish strict, closed JSON schemas with one coherent Settings `action_root: "none"` branch.
- Pin the exact schema bytes in `schemas/manifest.json`.
- Validate both shipped document pairs, action-ID uniqueness, action-root containment, Settings anchors, and cross-document mode agreement.
- Define `allow_autonomous_execution: false` as a hard confirmation requirement for every declared HTTP action and require confirmation of one exact invocation.
- Keep AAA as discovery; identity, grants, context disclosure, receipt verification, and execution remain independently authorized.

This profile narrows the permissive 0.1.0 schemas. Consumers that intentionally support 0.1.0 should pin that older artifact separately; the current examples and reference validator use 0.1.1.
