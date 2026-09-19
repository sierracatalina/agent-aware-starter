# Agent Aware Architecture (AAA)

AAA is a machine-readable handshake for agent-aware sites and Settings surfaces. Agents read a small well-known set instead of inferring intent from the DOM. The current document profile is `0.1.1` under protocol `AAA/0.1`.

## Start here

| Document | Role |
| --- | --- |
| [PROPOSAL.md](PROPOSAL.md) | Short entry |
| [docs/proposals/aaa-handshake.md](docs/proposals/aaa-handshake.md) | Protocol write-up |
| [spec/00-overview.md](spec/00-overview.md) | Spec tree entry |
| [schemas/](schemas/) | JSON Schema (draft 2020-12) |
| [examples/](examples/) | Fixtures (`live: false`) |
| [reference/validate_documents.py](reference/validate_documents.py) | Schema and cross-document semantic validator |
| [schemas/manifest.json](schemas/manifest.json) | Exact SHA-256 digests for the supported `0.1.1` schemas |

## Spec tree

1. [00-overview](spec/00-overview.md) — scope
2. [01-handshake](spec/01-handshake.md) — discovery sequence
3. [02-well-known](spec/02-well-known.md) — `ai-instructions.json`, `agents.json`, `llms.txt`
4. [03-settings-surface](spec/03-settings-surface.md) — Settings profile, `action_root: "none"`, deep-link
5. [04-safety](spec/04-safety.md) — guardrails and confirmation
6. [05-ownership](spec/05-ownership.md) — what this handshake covers

## Handshake

```text
surface encountered
  -> GET /.well-known/ai-instructions.json
  -> GET its declared agents.json discovery pointer
  -> GET its optional llms.txt context pointer
  -> if action_root is an HTTP path or URL → consider only declared actions beneath that root
  -> if action_root is the string "none" → open a documented Settings deep link
```

Settings-desktop deep-link pattern:

```text
app://settings?id=<anchor>
```

Examples in this repository set `"live": false`. They are fixtures, not a published origin.

An AAA card describes an action surface. It does not authenticate an agent, grant authority, or approve invocation arguments. The executing runtime must verify independent authority and bind the complete invocation and any private-context disclosure before a side effect.

## Verify the fixtures

With Python 3.11 or newer:

```sh
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
python reference/validate_documents.py examples/well-known/agents.json examples/well-known/ai-instructions.json
python reference/validate_documents.py examples/product-examples/settings-desktop/agents.json examples/product-examples/settings-desktop/ai-instructions.json
```

The reference validator adds action-ID uniqueness, action-root containment, Settings anchor consistency, and cross-document mode checks. Schema validation alone cannot prove those properties. A host must serve both documents from a trusted origin and an authorizing runtime must bind their exact digests.

## Examples

- [examples/well-known/](examples/well-known/) — generic site; HTTP `action_root`
- [examples/product-examples/settings-desktop/](examples/product-examples/settings-desktop/) — Settings surface; `action_root` is the string `none`

## Historical starter

The original Express demo that served `public/.well-known` lives under [reference/historical-starter/](reference/historical-starter/). See [reference/starter-runtime.md](reference/starter-runtime.md).

## License

MIT License. Copyright (c) 2026 Sierra Catalina. See [LICENSE](LICENSE).
