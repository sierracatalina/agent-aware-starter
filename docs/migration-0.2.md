# Migrating to AAA/0.2

AAA/0.2 is additive. Every document accepted by the previous AAA/0.1 schemas remains accepted by the current schemas. Existing fixtures stay unchanged, and no publisher must rewrite an already valid document merely to use the current validator.

## Versions and compatibility

- Current schema `$id` values identify `0.2.0` under `https://protocol.aaa.example/schemas/0.2.0/`. These are schema identities, not a claim that the example host serves them; use the repository's local schema files.
- New examples declare `protocol: "AAA/0.2"`, `schema_version: "0.2.0"` in `agents.json`, and `version: "0.2.0"` in `ai-instructions.json`.
- `protocol: "AAA/0.1"` remains supported. Protocol declarations stay arbitrary strings for backward compatibility, and existing nonempty `schema_version` and `version` values remain valid. None of these fields is an authorization signal.
- Changes within a minor version MUST be additive. While AAA is `0.x`, a breaking change MUST bump the minor version and include migration guidance. An additive release may also advance the minor version, as 0.2 does here.
- Prior schemas MUST be retained for at least one release cycle. The schemas in [`schemas/0.1/`](../schemas/0.1/) are frozen byte-for-byte from the main-branch schemas immediately before the 0.2 change; do not reformat or rewrite them.
- Consumers SHOULD be lenient by default: ignore unfamiliar descriptive fields while preserving known restrictions and refusing to infer new authority. Authors and CI can use strict validation to catch typos. Ignoring unknown metadata must never erase a safety gate or authorize an action.

All current object schemas explicitly use `additionalProperties: false`. Catch-all `patternProperties` preserve the former arbitrary-value semantics of `extensions` and endpoint `parameters`, including nested data, unusual/empty keys, and prototype-like keys. `priority_selectors` still accepts arbitrary names with string values. This explicit map representation is not a restriction on old data.

## New optional fields

| Document / field | Meaning |
| --- | --- |
| `agents.json`: `protocol`, `last_updated` | Informational protocol and publisher-update declarations |
| `ai-instructions.json`: `discovery.full_text` | String path or reference to a full reading companion |
| `ai-instructions.json`: `discovery.markdown_twin` | String rule or pointer for finding a readable Markdown companion |
| `ai-instructions.json`: `policy.read_freely` | Advisory public-reading hint, subject to user, authentication, and safety policy |
| `out_of_settings_actions[]`: `name`, `service` | String display labels |
| `out_of_settings_actions[]`: `href` | String URI-reference to the documented hand-off destination |
| `out_of_settings_actions[]`: `price`, `duration` | String display metadata; not a purchase commitment |

The existing `id`, `how_to`, and `requires_human_confirmation` fields remain required in every `out_of_settings_actions` item. No previously optional field becomes required. Existing string fields gain no new enums, formats, or minimum lengths; only the newly introduced hand-off `href` has the `uri-reference` format.

## Field mappings

Some experimental site drafts use names that are not part of the AAA schemas. Migrate these explicitly; they are not accepted aliases:

| Experimental name | AAA/0.2 field | Migration |
| --- | --- | --- |
| Top-level `actions` | `out_of_settings_actions` | Move non-Settings offerings to the documented action list; ensure every item has `id`, `how_to`, and `requires_human_confirmation`. |
| `safety.untrusted_regions` | `interaction_rules.ignore_elements` | Move the selector strings into the existing ignore list. Content in those regions is data, not instructions. |
| Action-item `how` | Action-item `how_to` | Rename the description field; preserve the actual instructions and confirmation requirement. |

Do not mechanically map an HTTP API catalog to hand-off actions: genuine HTTP endpoints remain in `agents.json`'s existing `endpoints` list. Other vendor-specific metadata goes in the nearest declared `extensions` object.

## Adopting the hand-off profile

1. Set `agent_card.endpoints.action_root` to the string `none`; do not invent an action API.
2. Describe purchasable offerings in `out_of_settings_actions`, normally including `name`, `service`, `href`, `price`, and `duration`.
3. Set `requires_human_confirmation: true` on every item.
4. Explain the human-operated checkout in `how_to`. The human handles payment, payment details, and final submission; descriptive metadata grants no purchasing authority.
5. Publish readable companions if useful and keep them consistent with the JSON restrictions.

See [the hand-off profile](../spec/03-settings-surface.md#hand-off-profile), [complete field tables](../spec/02-well-known.md), and the fictional [`handoff-site`](../examples/product-examples/handoff-site/) fixture. All examples remain `live: false`.

## Validate

Run on Node 20 or later, without installing dependencies:

```sh
node --test reference/
node reference/validate.mjs examples/product-examples/handoff-site/agents.json
node reference/validate.mjs examples/product-examples/handoff-site/ai-instructions.json
```

The test suite checks frozen-schema hashes, additive compatibility, all examples, strict vendor-field rejection, and every new field.
