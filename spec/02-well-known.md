# AAA 02 — Well-known files

AAA uses three artifacts, conventionally served under `/.well-known/` when a host chooses to publish them. Examples in this repository are fixtures (`live: false`).

| File | Role |
| --- | --- |
| `llms.txt` | Optional prose essence for agent readers |
| `agents.json` | Agent card: capabilities and `action_root` |
| `ai-instructions.json` | Selectors, interaction rules, safety, Settings anchors |

## `agents.json`

Required fields for AAA/0.1:

| Field | Meaning |
| --- | --- |
| `schema_version` | Card schema, e.g. `0.1.0` |
| `live` | `true` only if a host actually serves this card. Pack examples MUST be `false`. |
| `agent_card.name` | Display name |
| `agent_card.capabilities` | Declared capability tokens |
| `agent_card.endpoints.discovery` | Path to `ai-instructions.json` |
| `agent_card.endpoints.action_root` | HTTP path/URL **or** the string `none` |

Recommended:

| Field | Meaning |
| --- | --- |
| `status` | `proposed` \| `draft` \| `active` |
| `http_action_api` | Duplicate of the HTTP-vs-none signal for readers |
| `notes` | Non-normative |

Schema: [`../schemas/agents.schema.json`](../schemas/agents.schema.json).

## `ai-instructions.json`

| Field | Meaning |
| --- | --- |
| `version` | Instructions document version |
| `priority_selectors` | CSS / intent selectors for primary UI |
| `interaction_rules` | Retries, timeouts, ignore lists |
| `safety.prohibit_direct_input_to` | Fields the agent must not type into |
| `safety.require_human_confirmation_for` | Actions / paths that need a human |
| `settings_anchors` | Settings-desktop only: documented deep-link ids |

Schema: [`../schemas/ai-instructions.schema.json`](../schemas/ai-instructions.schema.json).

## `llms.txt`

Markdown essence. MUST NOT be the sole source of endpoints or safety. Prefer the JSON files.

## Content type

When served, `agents.json` and `ai-instructions.json` SHOULD be `application/json`. `llms.txt` SHOULD be `text/plain; charset=utf-8`. Serving is optional and is not implied by this pack.
