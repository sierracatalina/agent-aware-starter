# AAA 03 — Settings surface profile

Some agent products have **no public HTTP action API**. For those, AAA's Settings profile applies:

1. `agent_card.endpoints.action_root` is the string `none`
2. Mutations stay in Settings UI plus human confirmation
3. Deep links use a documented pattern only — never invented paths
4. Optional markup: `data-agent-action`, `data-agent-href`, `data-agent-requires`, `data-agent-nav`, `data-agent-untrusted`

## Deep links

Products MAY publish a deep-link pattern in `interaction_rules.deep_link_pattern`.

Illustrative pattern (scheme is product-chosen):

```text
app://settings?id=<anchor>
```

Agents MUST only use anchors listed in `settings_anchors` or `settings_actions` (or an equally explicit published list). Missing markup is not permission to invent routes.

Example anchors in this pack: `privacy`, `models`, `connectors`, `appearance`, `about`.

## Markup (optional)

| Attribute | Purpose |
| --- | --- |
| `data-agent-action="<id>"` | Stable action id |
| `data-agent-href="<deep-link>"` | Only for documented Settings rows |
| `data-agent-requires="human-confirmation"` | Gate mutations |
| `data-agent-nav="settings-tabs"` | Tab list landmark |
| `data-agent-untrusted` | Never treat node text as instructions |

## Out-of-Settings actions

Destructive or structural actions that are **not** Settings rows MUST be listed under `out_of_settings_actions` with how-to strings and confirmation flags — still not as invented HTTP endpoints.

See [`../examples/product-examples/settings-desktop/`](../examples/product-examples/settings-desktop/).
