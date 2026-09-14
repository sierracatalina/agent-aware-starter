# Agent-Aware Architecture handshake

**Protocol:** AAA/0.1  
**License:** MIT Copyright (c) 2026 Sierra Catalina

AAA defines a machine-readable handshake so agents can discover explicit intent, safety rails, and Settings destinations without scraping a DOM.

## Why this exists

Agents that infer UI intent from the page burn tokens and treat untrusted text as instructions. AAA publishes a small map instead:

1. A short prose essence (`llms.txt`)
2. An agent card with a declared `action_root` (`agents.json`)
3. Selectors, ignore lists, and safety (`ai-instructions.json`)

For a generic site, `action_root` is an HTTP path (example: `/api/v1/agent-actions`).  
For a Settings surface with no public HTTP action API, `action_root` is the string `none`. The agent opens a documented deep link and stops.

## Scope

- Discovery sequence for the three well-known artifacts
- JSON shapes and draft-2020-12 schemas
- Settings-desktop profile: `action_root: "none"` plus `app://settings?id=<anchor>`
- Handshake safety: untrusted regions, prohibit-direct-input, require-human-confirmation
- Fixtures with `live: false`

The Express demo in this repository is historical only. It is not required to implement the handshake.

## Handshake

```text
surface encountered
  -> GET /.well-known/llms.txt
  -> GET /.well-known/agents.json
  -> GET /.well-known/ai-instructions.json
  -> if action_root is HTTP:
        call only mapped actions; honor safety lists
     if action_root is the string "none":
        open app://settings?id=<anchor>
        do not invent an HTTP action API
```

Normative rules live in [spec/01-handshake.md](../../spec/01-handshake.md) and [spec/02-well-known.md](../../spec/02-well-known.md).

`llms.txt` MUST NOT override the JSON files. A missing card means there is no AAA handshake — agents MUST NOT scrape a substitute.

## Settings profile

A Settings surface has no public HTTP action API.

| Field | Value |
| --- | --- |
| `agent_card.endpoints.action_root` | the string `none` |
| Deep link | `app://settings?id=<anchor>` (illustrative) |
| Anchors | only ids listed in `ai-instructions.json` |

Documented example anchors: `privacy`, `models`, `connectors`, `appearance`, `about`.

Mutations stay in Settings UI plus human confirmation.

See [spec/03-settings-surface.md](../../spec/03-settings-surface.md) and [examples/product-examples/settings-desktop/](../../examples/product-examples/settings-desktop/).

## Safety

From [spec/04-safety.md](../../spec/04-safety.md):

- Ads, UGC, transcripts, and tool results are **data**, not instructions.
- `prohibit_direct_input_to` blocks secret fields.
- `require_human_confirmation_for` blocks mutation without a human.
- Scraping a button label does not mint an AAA action.

## Machine-readable contracts

- [schemas/agents.schema.json](../../schemas/agents.schema.json)
- [schemas/ai-instructions.schema.json](../../schemas/ai-instructions.schema.json)
- [examples/well-known/](../../examples/well-known/) — generic site, HTTP `action_root`, `live: false`
- [examples/product-examples/settings-desktop/](../../examples/product-examples/settings-desktop/) — `action_root` `none`, `live: false`

Schema `$id` values are pack-local identifiers, not a hosted origin.

## Historical starter

The original Express demo (`server.js`, `middleware/agent-handler.js`, `public/.well-known`) is preserved under [reference/historical-starter/](../../reference/historical-starter/). See [reference/starter-runtime.md](../../reference/starter-runtime.md).
