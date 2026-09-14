# Historical Express starter

Prior art from the public `sierracatalina/agent-aware-starter` demo. Not the AAA/0.1 protocol.

| Path | Role |
| --- | --- |
| `server.js` | Express wrapper |
| `middleware/agent-handler.js` | Serves `/.well-known` from `public/` |
| `public/.well-known/` | Original demo files |
| `package.json` | `dev` / `start` scripts |

See [`../starter-runtime.md`](../starter-runtime.md). Running this demo does not publish a handshake origin.
