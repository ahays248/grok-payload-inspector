# Launch Grok Build through the payload inspector for this window only.
# The proxy must already be running (`npm run dev` in grok-payload-dashboard).
# When Grok exits, the env var is removed so this window is normal again.

$env:GROK_CLI_CHAT_PROXY_BASE_URL = "http://127.0.0.1:8787/v1"
Write-Host "Grok will send model traffic through $($env:GROK_CLI_CHAT_PROXY_BASE_URL)"
Write-Host "Dashboard: http://localhost:5173"
Write-Host ""
try {
  grok @args
} finally {
  Remove-Item Env:GROK_CLI_CHAT_PROXY_BASE_URL -ErrorAction SilentlyContinue
}
