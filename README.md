# Payload Inspector

Unofficial local dashboard for [Grok Build](https://x.ai/build). **Not affiliated with, endorsed by, or part of xAI / SpaceXAI.**

It sits on your machine between Grok Build and `cli-chat-proxy.grok.com`, forwards the real request (auth included), and shows you what is eating context: system prompt, native tools, MCP tools, skills, messages, and the response.

Grok already documents `GROK_CLI_CHAT_PROXY_BASE_URL` for this kind of hop. This project is original viewer code. It does not bundle Grok Build, xAI trademarks, or anyone’s captured prompts.

## Quick start

You need Node.js 20+ and the `grok` CLI.

```bash
git clone https://github.com/ahays248/grok-payload-inspector.git
cd grok-payload-inspector
npm install
npm run dev
```

That starts:

- **Dashboard** — http://localhost:5173
- **Proxy** — `http://127.0.0.1:8787/v1`

Leave it running. In a **second** terminal, start Grok pointed at the proxy:

**Windows (PowerShell)**

```powershell
$env:GROK_CLI_CHAT_PROXY_BASE_URL = "http://127.0.0.1:8787/v1"
grok
```

**macOS / Linux**

```bash
GROK_CLI_CHAT_PROXY_BASE_URL=http://127.0.0.1:8787/v1 grok
```

Helpers: `.\start-grok.ps1` or `./start-grok.sh`.

Send `Hello!` in Grok. The dashboard fills in as the request goes by.

The env var lives only in that terminal. Close the window (or unset it) when you want a normal Grok session. Do not put it in `~/.grok/config.toml`.

## What you will see

| Pane | What it is |
|---|---|
| **Session** | Sum of every call (what you paid) vs the latest call (what `/context` shows), plus a chart over time |
| **This call** | One request, split by type |
| **Diff** | What changed since the previous call |
| **System / Tools / MCP / Skills / Messages / Response** | The payload, one kind at a time |

The sidebar groups **user turns** (one thing you typed) and expands into the model calls of that tool-loop.

Token counts are a chars÷4 **ranking**, not a bill. Compare a `Hello!` with `/context` in the same session if you want a sanity check.

## Privacy

- Runs at `127.0.0.1` only.
- Authorization headers are forwarded to xAI and **never written to disk or shown in the UI**.
- Recordings stay on **your** computer under `~/.payload-inspector/logs`. They are not in this repository and are not uploaded anywhere.
- Each `npm run dev` starts **empty**. The last session is not reloaded. Set `PAYLOAD_INSPECTOR_RESUME=1` if you explicitly want the previous file.
- **Do not commit, gist, or publish recordings.** They include Grok Build’s system prompt and tool schemas (xAI’s materials) plus your own conversation. That is the part that would get you in trouble, not this repo.
- Click **New recording** in the dashboard to archive the current file locally and start empty. You can also delete the `~/.payload-inspector` folder.

## What this repo does *not* contain

- No captured sessions
- No Grok system prompts or production tool schemas
- No API keys, tokens, or `auth.json`
- Tests use tiny synthetic fixtures only

## License

MIT. Use of Grok Build remains under [xAI’s Terms](https://x.ai/legal/terms-of-service) and [Acceptable Use Policy](https://x.ai/legal/acceptable-use-policy).
