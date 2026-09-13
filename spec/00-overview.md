# AAA 00 — Overview

**Protocol:** Agent Aware Architecture (AAA)  
**Profile:** Settings / site handshake  
**Version target:** `AAA/0.1`

AAA specifies how an agent discovers explicit intent from a well-known file set and, for a Settings surface, opens a documented destination instead of inventing an HTTP action API.

## Invariants

1. **Handshake, not authority.** Well-known files declare a map. They do not grant ambient write access.
2. **Settings profile uses `action_root: "none"`.** A Settings surface MUST NOT expose a public HTTP action API through AAA.
3. **No scraped authority.** A button label is not an AAA action. If it is not on the map, it is out of band.
4. **Fixtures use `live: false`.** Examples in this repository are not a published origin.

## In this tree

| Doc | Topic |
| --- | --- |
| [01-handshake](01-handshake.md) | Discovery sequence |
| [02-well-known](02-well-known.md) | `llms.txt`, `agents.json`, `ai-instructions.json` |
| [03-settings-surface](03-settings-surface.md) | Settings profile, `none`, deep links |
| [04-safety](04-safety.md) | Untrusted regions, confirmation |
| [05-ownership](05-ownership.md) | What this handshake covers |

Schemas: [`../schemas/`](../schemas/). Examples: [`../examples/`](../examples/).
