# AAA 02 — Well-known files

AAA uses three artifacts, conventionally served under `/.well-known/` when a host chooses to publish them. Examples in this repository are fixtures (`live: false`).

| File | Role |
| --- | --- |
| `llms.txt` | Optional prose essence for agent readers |
| `agents.json` | Agent card: capabilities and `action_root` |
| `ai-instructions.json` | Selectors, interaction rules, safety, Settings anchors |

## `agents.json`

Required fields for the AAA/0.1.1 document profile:

| Field | Meaning |
| --- | --- |
| `schema_version` | Card schema: `0.1.1` |
| `status` | `example` \| `draft` \| `active` \| `deprecated` |
| `live` | `true` only if a host actually serves this card. Pack examples MUST be `false`. |
| `http_action_api` | `none` for Settings or `declared` for HTTP actions |
| `agent_card.name` | Display name |
| `agent_card.capabilities` | Declared capability tokens |
| `agent_card.endpoints.discovery` | Path to `ai-instructions.json` |
| `agent_card.endpoints.action_root` | HTTP path/URL prefix **or** the string `none` |

Optional:

| Field | Meaning |
| --- | --- |
| `notes` | Non-normative |

Schema: [`../schemas/agents.schema.json`](../schemas/agents.schema.json).

For HTTP actions, every declared endpoint MUST be the root itself or a descendant path segment beneath it, with the same HTTPS origin when absolute URLs are used. Action names MUST be unique. Action URLs MUST use canonical paths without query, fragment, encoded separators, or dot segments; pass invocation arguments separately. A strict consumer MUST reject a conflicting action ID or an endpoint outside the root. The [reference validator](../reference/validate_documents.py) checks these semantic conditions.

## `ai-instructions.json`

| Field | Meaning |
| --- | --- |
| `version` | Instructions document version |
| `profile` | `site` or `settings` |
| `policy.allow_autonomous_execution` | `false` requires exact-invocation human confirmation for every declared HTTP action |
| `priority_selectors` | CSS / intent selectors for primary UI |
| `interaction_rules` | Retries, timeouts, ignore lists |
| `safety.prohibit_direct_input_to` | Fields the agent must not type into |
| `safety.require_human_confirmation_for` | Actions / paths that need a human |
| `settings_anchors` | Settings-desktop only: documented deep-link ids |

Schema: [`../schemas/ai-instructions.schema.json`](../schemas/ai-instructions.schema.json).

Both JSON documents MUST agree on `status`, `live`, and `http_action_api`. A live document MUST be active. `action_root: "none"` requires the Settings profile and no HTTP actions.

## `llms.txt`

Markdown essence. MUST NOT be the sole source of endpoints or safety. Prefer the JSON files.

## Content type

When served, `agents.json` and `ai-instructions.json` SHOULD be `application/json`. `llms.txt` SHOULD be `text/plain; charset=utf-8`. Serving is optional and is not implied by this pack.
