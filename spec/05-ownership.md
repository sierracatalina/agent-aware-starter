# AAA 05 — Scope of this handshake

AAA specifies how a site or Settings surface publishes intent to agents. It does not specify identity, grants, vault disclosure, or product routing.

| This handshake covers | This handshake does not cover |
| --- | --- |
| Well-known discovery files | Principals, grants, or recovery |
| Settings deep links and UI-intent markup | Vault bundles or disclosure policy |
| Safety lists on the handshake files | Multi-agent floor control |

Related work may exist elsewhere. Those documents are not imported here.

An integrating runtime can combine AAA with PCP, Context Layer, and Legatus. It must still prove that an authenticated actor may use the exact action invocation and that any Context Layer-derived value may flow to the invocation's destination and purpose. AAA discovery bytes and declared parameters do not make either decision.

The February 2026 field note is archival prior art for the handshake idea only.
