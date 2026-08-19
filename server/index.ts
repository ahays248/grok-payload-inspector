/**
 * Payload Inspector — proxy + API for the Grok Build dashboard.
 *
 * Listens on 127.0.0.1:8787
 *   /v1/*        → forwarded to cli-chat-proxy.grok.com (auth passed through)
 *   /api/*       → dashboard JSON / SSE
 *   /*           → built Vite app (after npm run build)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import { handleProxy, UPSTREAM_HOST } from "./proxy";
import { diffTurns, previousTurnId } from "./session";
import {
  clearAll,
  getProxyInfo,
  getTurn,
  listSummaries,
  listTraffic,
  sessionPayload,
  setProxyInfo,
  subscribe,
} from "./store";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, "..", "dist");

const dim = (s: string) => styleText("dim", s);
const bold = (s: string) => styleText("bold", s);
const cyan = (s: string) => styleText("cyan", s);

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  res.end(json);
}

function handleApi(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const p = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "OPTIONS" && p.startsWith("/api")) {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return true;
  }

  if (p === "/api/health" && method === "GET") {
    sendJson(res, 200, { ok: true, ...getProxyInfo() });
    return true;
  }

  if (p === "/api/turns" && method === "GET") {
    sendJson(res, 200, {
      ...sessionPayload(),
      traffic: listTraffic(),
      proxy: getProxyInfo(),
    });
    return true;
  }

  const diffMatch = p.match(/^\/api\/turns\/([^/]+)\/diff$/);
  if (diffMatch && method === "GET") {
    const id = decodeURIComponent(diffMatch[1]);
    const next = getTurn(id);
    if (!next) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }
    const prevParam = url.searchParams.get("prev");
    const prevId = prevParam || previousTurnId(listSummaries(), id);
    if (!prevId) {
      sendJson(res, 404, { error: "no previous call" });
      return true;
    }
    const prev = getTurn(prevId);
    if (!prev) {
      sendJson(res, 404, { error: "no previous call" });
      return true;
    }
    sendJson(res, 200, diffTurns(prev, next));
    return true;
  }

  const turnMatch = p.match(/^\/api\/turns\/([^/]+)$/);
  if (turnMatch && method === "GET") {
    const id = decodeURIComponent(turnMatch[1]);
    if (id === "diff") {
      sendJson(res, 404, { error: "not found" });
      return true;
    }
    const turn = getTurn(id);
    if (!turn) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }
    sendJson(res, 200, turn);
    return true;
  }

  if (p === "/api/turns" && method === "DELETE") {
    clearAll();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (p === "/api/events" && method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
      "x-accel-buffering": "no",
    });
    res.write(":\n\n");

    const send = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const unsub = subscribe(send);
    const ping = setInterval(() => {
      res.write(":\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(ping);
      unsub();
    });
    return true;
  }

  return false;
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html><body style="font-family:sans-serif;background:#0c0e12;color:#e8edf5;padding:3rem">
  <h1>Payload Inspector proxy is running</h1>
  <p>Open the dashboard at <a href="http://localhost:5173" style="color:#5b9fd4">http://localhost:5173</a></p>
  <p style="opacity:.6">This page is the proxy. In dev, Vite serves the UI on 5173.</p>
</body></html>`);
    return;
  }

  const url = new URL(req.url ?? "/", `http://${HOST}`);
  let filePath = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(DIST)) filePath = path.join(DIST, "index.html");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, "index.html");
  }
  const ext = path.extname(filePath);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
  };
  res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? "/";
  if (url.startsWith("/api/")) {
    if (!handleApi(req, res)) {
      sendJson(res, 404, { error: "not found" });
    }
    return;
  }
  // Grok API traffic — anything that looks like an API path, or any
  // non-GET (generation is POST). GET of / and assets is the dashboard.
  const method = (req.method ?? "GET").toUpperCase();
  const apiShaped =
    url.startsWith("/v1") ||
    url.startsWith("/backend-api") ||
    url.includes("/responses") ||
    url.includes("/chat/completions") ||
    url.includes("/models") ||
    url.includes("/messages");
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    handleProxy(req, res);
    return;
  }
  if (apiShaped) {
    handleProxy(req, res);
    return;
  }
  serveStatic(req, res);
}

function grokLaunchCommand(base: string): string {
  return process.platform === "win32"
    ? `$env:GROK_CLI_CHAT_PROXY_BASE_URL = "${base}"; grok`
    : `GROK_CLI_CHAT_PROXY_BASE_URL=${base} grok`;
}

function printBanner(): void {
  const listen = `http://${HOST}:${PORT}`;
  const base = `${listen}/v1`;
  const cmd = grokLaunchCommand(base);
  const rule = dim("─".repeat(72));
  console.log("");
  console.log(rule);
  console.log(`  ${bold("Payload Inspector")}  —  unofficial Grok Build request logger`);
  console.log(rule);
  console.log(`  ${dim("Proxy")}       ${cyan(base)}`);
  console.log(`  ${dim("Dashboard")}   ${cyan("http://localhost:5173")}  ${dim("(dev)")}`);
  console.log(`  ${dim("Upstream")}    https://${UPSTREAM_HOST}`);
  console.log(`  ${dim("Recordings")}  ${dim("~/.payload-inspector/logs  (this run only; not reloaded)")}`);
  console.log(rule);
  console.log("");
  console.log("  In another terminal:");
  console.log("");
  if (process.platform === "win32") {
    console.log(bold(`    $env:GROK_CLI_CHAT_PROXY_BASE_URL = "${base}"`));
    console.log(bold("    grok"));
  } else {
    console.log(bold(`    ${cmd}`));
  }
  console.log("");
  console.log(dim("  That env var lives only in that terminal. Other Grok sessions are unchanged."));
  console.log(dim("  Recordings never leave this computer. Do not commit or publish them."));
  console.log(dim("  Press Ctrl+C to stop the proxy."));
  console.log(rule);
  console.log("");
}

const server = http.createServer(onRequest);

server.listen(PORT, HOST, () => {
  setProxyInfo({
    listen: `http://${HOST}:${PORT}/v1`,
    upstream: `https://${UPSTREAM_HOST}`,
    grokCommand: grokLaunchCommand(`http://${HOST}:${PORT}/v1`),
  });
  printBanner();
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[payload-inspector] port ${PORT} is already in use. Set PORT=8788 or stop the other process.`);
  } else {
    console.error(`[payload-inspector] ${err.message}`);
  }
  process.exit(1);
});
