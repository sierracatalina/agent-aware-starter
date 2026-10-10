# Hand-off service site (AAA/0.2 fixture)

Aster Studio is a fictional, Auny-shaped service catalog: readable offerings, published price/duration metadata, documented service-page links, and human-operated checkout. It is not affiliated with Auny and makes no claim about any live site's protocol support.

All files are examples (`live: false`), using the AAA/0.2 names and schema/document version `0.2.0`.

- [`agents.json`](agents.json) declares `action_root: "none"` and no HTTP action endpoints.
- [`ai-instructions.json`](ai-instructions.json) uses `discovery.full_text`, `discovery.markdown_twin`, `policy.read_freely`, and `out_of_settings_actions` with `name`, `service`, `href`, `price`, `duration`, `how_to`, and `requires_human_confirmation`.
- [`llms.txt`](llms.txt) mirrors the reading guidance and restrictions. Both readable-document pointers target this companion, conventionally served at `/.well-known/llms.txt` if a publisher adopts the fixture.

The two service paths are illustrative documented destinations, not working pages in this repository. Prices and durations are display text; final availability and payment terms must be checked by the human. Every action requires human confirmation, and the human handles payment details, terms, and final purchase submission. Public-reading hints never grant additional authority.

Unknown vendor metadata belongs in `extensions`. This fixture does not use the experimental `actions`, `safety.untrusted_regions`, or `how` aliases; their AAA counterparts are `out_of_settings_actions`, `interaction_rules.ignore_elements`, and `how_to`.

See [the hand-off profile](../../../spec/03-settings-surface.md#hand-off-profile) and [0.2 migration guide](../../../docs/migration-0.2.md).

```sh
node reference/validate.mjs examples/product-examples/handoff-site/agents.json
node reference/validate.mjs examples/product-examples/handoff-site/ai-instructions.json
```
