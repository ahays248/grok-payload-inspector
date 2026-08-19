#!/usr/bin/env bash
# Launch Grok Build through the payload inspector for this terminal only.
# The proxy must already be running (`npm run dev`).
set -euo pipefail
export GROK_CLI_CHAT_PROXY_BASE_URL="http://127.0.0.1:8787/v1"
echo "Grok will send model traffic through $GROK_CLI_CHAT_PROXY_BASE_URL"
echo "Dashboard: http://localhost:5173"
echo "Recordings stay in ~/.payload-inspector/logs (this machine only)"
echo ""
grok "$@"
