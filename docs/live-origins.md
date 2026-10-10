# Live-origin registry

Checked on **2026-10-10 (UTC)**. One external origin is observed serving a handshake; zero currently meet every [live-publication requirement](../spec/02-well-known.md#what-live-means). Repository examples are all `live: false` and do not appear as deployments here. A publisher's `live: true` claim or a successful lenient read does not establish strict conformance.

| Origin | Declared protocol / card version | Validator result | Checked date | Notes |
| --- | --- | --- | --- | --- |
| [Auny](https://aunysillyme.com) → [canonical www origin](https://www.aunysillyme.com) | `AAA/0.1` / `0.1.0` | Frozen 0.1: AI instructions invalid (5 extras), card invalid (2 extras). Current 0.2: AI instructions invalid (2 extras), card invalid (2 extras). Every strict invocation exits 1. | 2026-10-10 | Both JSON files return 200 with `application/json`; declared `/llms.txt` returns 200 with `text/plain; charset=utf-8`. AI `last_updated` is `2026-10-09`; the card omits it. Hosted lenient reader: `settings_profile`, exit 0. |

Sierra reported Auny as the first external implementer. That chronology is user-supplied and has not been independently established. This registry records the observed deployment and its differences; it does not modify the publisher's site.

## Files and transport

The apex origin returned a 301 redirect to `www` for both JSON files. Successful audit fetches were made at 20:37–20:38 UTC:

- `https://www.aunysillyme.com/.well-known/ai-instructions.json` — 200, `application/json`, 2,153 bytes
- `https://www.aunysillyme.com/.well-known/agents.json` — 200, `application/json`, 707 bytes
- `https://www.aunysillyme.com/llms.txt` — 200, `text/plain; charset=utf-8`, 13,292 bytes

`discovery.context` correctly points to `/llms.txt`. `/.well-known/llms.txt` returned 404; the declared root path is the one to read. `discovery.markdown_twin` is a human-readable rule, not a fetch URL. The reader does not automatically fetch `full_text` or Markdown twins.

Audit snapshot SHA-256 values:

```text
be5af962fd2a8ad4479ade863e79e419bd2ee6e373448cc60cfb4e603c3c1f53  ai-instructions.json
c076fa9fb451f8d3f5ba43030098b5191636fc62f2d37697483b76faab63ee05  agents.json
c98a3e1cedb38d34cfe005eed30f75b95a0baf8058be76c9dfe31c5dac349e8a  llms.txt
```

## Strict validation: baseline and current

The historical baseline uses the validator and schemas from main at `d5b6b5b806a6e68a5fe07af320dbc7ded9b31c29`. The preserved schemas under `schemas/0.1/` are byte-identical to that baseline.

`ai-instructions.json`, frozen 0.1: exit **1**, five additional-property errors:

```text
$.discovery: additional property 'full_text' is not allowed (use 'extensions' for extras)
$.discovery: additional property 'markdown_twin' is not allowed (use 'extensions' for extras)
$.policy: additional property 'read_freely' is not allowed (use 'extensions' for extras)
$: additional property 'actions' is not allowed (use 'extensions' for extras)
$.safety: additional property 'untrusted_regions' is not allowed (use 'extensions' for extras)
```

`ai-instructions.json`, current 0.2: exit **1**, two remaining errors:

```text
$: additional property 'actions' is not allowed (use 'extensions' for extras)
$.safety: additional property 'untrusted_regions' is not allowed (use 'extensions' for extras)
```

`agents.json`, both frozen 0.1 and current 0.2: exit **1**, two errors:

```text
$.agent_card: additional property 'description' is not allowed (use 'extensions' for extras)
$.agent_card.endpoints: additional property 'context' is not allowed (use 'extensions' for extras)
```

The additive fields absorb three historical AI errors; the old count of five is not a current-schema result. The card errors are separate and remain unabsorbed. Move vendor metadata to declared `extensions` objects; migrate experimental action and untrusted-region names using [the 0.2 mappings](migration-0.2.md#field-mappings). The missing card timestamp is an additional live-publication issue, not a retroactive required schema field.

## Reader check

Actual local invocation:

```sh
node reference/read.mjs https://aunysillyme.com --json
```

Local result: exit **1**, `outcome: "missing"`, `map: null`, warning `DNS lookup failed: EAI_AGAIN.` Native DNS in the audit environment was unavailable. The separate audit fetches above used its approved HTTPS proxy; they do not prove that the DNS-pinned reader completed a live network run. No proxy fallback or looser fetch policy was added to the reader.

The same invocation **succeeded on hosted Node v20.20.2 at 20:48:53 UTC**, at commit `69b479f8c665089f6a8703f727aaa3da2f2915e8`: exit **0**, `outcome: "settings_profile"`, canonical origin `https://www.aunysillyme.com`, `action_root: "none"`, and `grants_authority: false`. The [live-smoke job](https://github.com/sierracatalina/agent-aware-starter/actions/runs/38085198566/job/114310156395) completed successfully. Its four exact warnings were:

```text
$.actions: unknown field ignored.
$.safety.untrusted_regions: unknown field ignored.
$.agent_card.description: unknown field ignored.
$.agent_card.endpoints.context: unknown field ignored.
```

The fetched sequence was apex `/.well-known/ai-instructions.json`, canonical www `/.well-known/ai-instructions.json`, canonical `/.well-known/agents.json`, then canonical `/llms.txt`. Experimental actions were ignored, not migrated or executed. This successful lenient read does not erase the strict authoring or timestamp issues above.

The bounded `live-smoke` job is separate from deterministic fixture validation. Its result must be inspected separately; external availability cannot be inferred from an overall green workflow when that job is allowed to fail. The PR receipt records the final exact-head hosted result.

## Reproduce the strict audit

Run from a full repository checkout on a network-enabled machine. These are read-only audit fetches; the reference reader remains the bounded production-consumer path.

```sh
repo="$PWD"
audit="$(mktemp -d)"
mkdir -p "$audit/baseline/reference" "$audit/baseline/schemas"
for kind in agents ai-instructions; do
  curl --proto '=https' --proto-redir '=https' -fLsS --max-redirs 3 --max-time 15 \
    -D "$audit/$kind.headers" "https://aunysillyme.com/.well-known/$kind.json" \
    -o "$audit/$kind.json"
  git show d5b6b5b806a6e68a5fe07af320dbc7ded9b31c29:"schemas/$kind.schema.json" \
    > "$audit/baseline/schemas/$kind.schema.json"
done
git show d5b6b5b806a6e68a5fe07af320dbc7ded9b31c29:reference/validate.mjs \
  > "$audit/baseline/reference/validate.mjs"
for kind in agents ai-instructions; do
  node "$audit/baseline/reference/validate.mjs" "$audit/$kind.json" --kind "$kind"
  echo "frozen 0.1 $kind exit=$?"
  node "$repo/reference/validate.mjs" "$audit/$kind.json" --kind "$kind"
  echo "current 0.2 $kind exit=$?"
done
node "$repo/reference/read.mjs" https://aunysillyme.com --json
echo "lenient reader exit=$?"
```

A later result may differ if the publisher updates its files. Record the new time, bytes or hashes, exact errors, and exit codes rather than reusing this snapshot's verdict.
