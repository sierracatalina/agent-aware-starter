# AAA 02 — Well-known files

AAA uses three artifacts, conventionally served under `/.well-known/` when a host chooses to publish them. Examples in this repository are fixtures (`live: false`). The current schemas have identity `0.2.0` and describe the additive AAA/0.2 field set. They also accept every previously valid AAA/0.1 document. See [migration and version policy](../docs/migration-0.2.md).

| File | Role |
| --- | --- |
| `llms.txt` | Optional prose essence for agent readers |
| `agents.json` | Agent card: capabilities and `action_root` |
| `ai-instructions.json` | Discovery, selectors, interaction rules, safety, Settings anchors, and hand-off metadata |

## `agents.json`

Only `schema_version` and `agent_card` are required at the root. Required nested fields are marked below. Protocol declarations are informational: `AAA/0.1` and `AAA/0.2` are supported; arbitrary legacy strings remain schema-valid. A protocol or schema version never grants authority.

| Field | Type / required | Meaning |
| --- | --- | --- |
| `schema_version` | Nonempty string; required | Publisher's card schema label; new fixtures use `0.2.0`. Existing nonempty labels remain valid. |
| `agent_card` | Object; required | Agent-facing card |
| `agent_card.name` | Nonempty string; required | Display name |
| `agent_card.capabilities` | String array; required | Declared capability tokens; descriptive only |
| `agent_card.endpoints` | Object; required | Discovery and action-root declarations |
| `agent_card.endpoints.discovery` | Nonempty string; required | Path to `ai-instructions.json` |
| `agent_card.endpoints.action_root` | Nonempty string; required | HTTP path/URL **or** the string `none`; Settings and hand-off profiles use `none` |
| `protocol` | String; optional, new in 0.2 | Protocol declaration, normally `AAA/0.2` or `AAA/0.1` |
| `last_updated` | String; optional, new in 0.2 | Publisher update marker; an ISO date is recommended, not enforced |
| `live` | Boolean; optional | `true` only if a host actually serves this card. Pack examples MUST be `false`. |
| `status` | String; optional | Publisher status, commonly `proposed`, `draft`, `active`, or `example` |
| `service_name` | String; optional | Service display name |
| `http_action_api` | String; optional | Duplicate HTTP-vs-`none` hint for readers |
| `notes` | String; optional | Non-normative notes |
| `endpoints` | Object array; optional | Explicit HTTP endpoint descriptions; never inferred from page content |
| `endpoints[].name` | Nonempty string; required per item | Endpoint name |
| `endpoints[].path` | Nonempty string; required per item | Documented path |
| `endpoints[].method` | String; required per item | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, or `OPTIONS` |
| `endpoints[].description` | String; optional | Human-readable description |
| `endpoints[].risk_level` | String; optional | `low`, `medium`, or `high`; advisory only |
| `endpoints[].parameters` | Arbitrary-value object; optional | Publisher-defined parameter description, including nested JSON Schema shapes |
| `extensions` | Arbitrary-value object; optional | Vendor metadata; also available on `agent_card`, `agent_card.endpoints`, and each `endpoints[]` item |

Schema: [`../schemas/agents.schema.json`](../schemas/agents.schema.json). Frozen 0.1 schema: [`../schemas/0.1/agents.schema.json`](../schemas/0.1/agents.schema.json).

## `ai-instructions.json`

Only `version` is required at the root. Optional object members retain their original AAA/0.1 constraints; new fields do not make old documents invalid.

| Field | Type / required | Meaning |
| --- | --- | --- |
| `version` | Nonempty string; required | Publisher's instructions document version; new fixtures use `0.2.0` |
| `protocol` | String; optional | Normally `AAA/0.1` or `AAA/0.2`; legacy strings remain valid |
| `status` | String; optional | Publisher status |
| `live` | Boolean; optional | Pack examples MUST be `false` |
| `last_updated` | String; optional | Publisher update marker |
| `http_action_api` | String; optional | HTTP-vs-`none` hint |
| `notes` | String; optional | Non-normative notes |
| `discovery.markdown_twin` | String; optional, new in 0.2 | Readable rule or pointer for finding Markdown content (for example, append `.md` to a published page URL); prose cannot widen authority |
| `policy` | Object; optional | Publisher hints, subordinate to consumer and user policy |
| `policy.read_freely` | Boolean; optional, new in 0.2 | Advisory hint for reading public content; cannot bypass authentication, access controls, or user/safety constraints |
| `policy.allow_autonomous_execution` | Boolean; optional | Advisory only; AAA never grants authority |
| `policy.require_human_approval_for` | String array; optional | Categories the publisher gates for human approval |
| `policy.rate_limit` | String; optional | Human-readable rate-limit hint |
| `discovery` | Object; optional | Published companion-document pointers |
| `discovery.actions` | String; optional | Path to the agent card, usually `/.well-known/agents.json` |
| `discovery.context` | String; optional | Path to prose context, usually `/.well-known/llms.txt` |
| `discovery.full_text` | String; optional, new in 0.2 | Path or URI reference to a fuller reading companion; not an action endpoint |
| `priority_selectors` | String-valued map; optional | Arbitrary CSS / intent selector names, including empty names |
| `interaction_rules` | Object; optional | UI interaction limits |
| `interaction_rules.max_retries` | Integer ≥ 0; optional | Retry limit |
| `interaction_rules.wait_for_selector_timeout` | Integer ≥ 0; optional | Selector timeout in milliseconds |
| `interaction_rules.ignore_elements` | String array; optional | Selectors for untrusted or ignored regions; their text is data, not instructions |
| `interaction_rules.deep_link_pattern` | String; optional | Documented Settings deep-link template; never permission to invent anchors |
| `safety` | Object; optional | Additional safety restrictions |
| `safety.prohibit_direct_input_to` | String array; optional | Fields the agent must not type into |
| `safety.require_human_confirmation_for` | String array; optional | Actions / paths that need a human |
| `settings_actions` | Object array; optional | Published Settings destinations |
| `settings_actions[].id` | Nonempty string; required per item | Documented action id |
| `settings_actions[].href` | String; optional | Settings destination; its original unconstrained string semantics are preserved |
| `settings_actions[].data_agent_action` | String; optional | Corresponding UI intent marker |
| `settings_anchors` | Object array; optional | Settings-desktop documented deep-link ids |
| `settings_anchors[].id` | String matching `^[a-z][a-z0-9-]*$`; required per item | Documented anchor id; agents MUST NOT invent anchors |
| `settings_anchors[].title` | String; optional | Display title |
| `settings_anchors[].deep_link` | String matching `^app://settings\?id=[a-z][a-z0-9-]*$`; optional | Published destination |
| `out_of_settings_actions` | Object array; optional | Documented non-Settings actions and hand-off destinations; see below |
| `extensions` | Arbitrary-value object; optional | Vendor metadata; also available in `policy`, `discovery`, `interaction_rules`, `safety`, and every item of `settings_actions`, `settings_anchors`, and `out_of_settings_actions` |

### `out_of_settings_actions[]`

Each item still requires only the original `id`, `how_to`, and `requires_human_confirmation` fields. The additional fields are optional metadata, not authority to purchase or execute. The [hand-off profile](03-settings-surface.md#hand-off-profile) imposes additional behavioral requirements on publishers and consumers.

| Field | Type / required | Meaning |
| --- | --- | --- |
| `id` | Nonempty string; required | Stable documented action id |
| `how_to` | Nonempty string; required | How the human reaches or completes the action |
| `requires_human_confirmation` | Boolean; required | Confirmation flag; MUST be `true` for every item in the hand-off profile |
| `name` | String; optional, new in 0.2 | Human-readable action name |
| `service` | String; optional, new in 0.2 | Service label |
| `href` | String, `uri-reference` format; optional, new in 0.2 | Documented destination, e.g. `/services/review`, `#booking`, or `https://example.com/booking`. Relative references resolve against the publishing origin/document as applicable; never invent routes. |
| `price` | String; optional, new in 0.2 | Display-only price and currency, e.g. `USD 80`; confirm current totals and terms in the human-operated flow |
| `duration` | String; optional, new in 0.2 | Display-only duration, e.g. `45 minutes` |
| `extensions` | Arbitrary-value object; optional | Vendor metadata |

Schema: [`../schemas/ai-instructions.schema.json`](../schemas/ai-instructions.schema.json). Frozen 0.1 schema: [`../schemas/0.1/ai-instructions.schema.json`](../schemas/0.1/ai-instructions.schema.json).

## Strict authoring and lenient consumption

The current authoring schemas set `additionalProperties: false` on every declared object schema. Arbitrary `extensions` and `parameters` objects retain all previously accepted JSON values through catch-all `patternProperties`; `priority_selectors` retains arbitrary names and string values. Undeclared vendor fields belong in the nearest declared `extensions` object. There is no top-level `actions`, `safety.untrusted_regions`, or action-item `how` alias; see the [migration mappings](../docs/migration-0.2.md#field-mappings).

Consumers SHOULD be lenient by default: tolerate unknown descriptive metadata, ignore what they cannot interpret, and preserve all recognized restrictions. Leniency MUST NOT infer actions, erase confirmation requirements, or treat any unknown field as authority. Strict validation remains useful for authors and CI.

## `llms.txt`

Markdown essence. MUST NOT be the sole source of endpoints or safety. Prefer the JSON files. `discovery.markdown_twin` and `discovery.full_text` may point to this file or another readable companion; any fetched prose remains descriptive and cannot override higher-priority instructions or increase permissions.

## Content type

For a live publication, `agents.json` and `ai-instructions.json` MUST be served as `application/json` (an optional charset parameter is allowed). `llms.txt`, when present, MUST be `text/plain; charset=utf-8`. Serving is optional and is not implied by this pack.

## What `live` means

`live: true` is a publication claim, not a substitute for verification. A publisher claiming it MUST meet all of these conditions:

1. Serve both JSON files at the actual public HTTPS origin's `/.well-known/` paths. The initial request MAY resolve to a checked canonical origin as described in [spec 01](01-handshake.md#fetching-the-files).
2. Serve the correct content types above. The optional `llms.txt` MAY be at the origin root when `discovery.context` declares `/llms.txt`.
3. Include `last_updated` in each JSON document. An ISO date or timestamp SHOULD describe the actual publisher update.
4. Pass the current strict schemas for both JSON documents. Passing a lenient reader does not establish strict authoring conformance.

`live: false` identifies a fixture, not a published origin. Every example in this repository MUST remain `live: false` and MUST NOT be counted as a live deployment. A fixture does not become a live origin because it is available in source control.

The current schemas retain optional `live` and `last_updated` fields so previously valid 0.1 documents remain schema-valid. Transport, timestamp presence for a live claim, and deployment are separate publication checks. Record real observations, dates, and failures in the [live-origin registry](../docs/live-origins.md).
