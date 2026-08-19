import http from "node:http";
import https from "node:https";
import { randomUUID } from "node:crypto";
import {
  applyResponse,
  decodeRequestBody,
  emptyResponse,
  emptyTotals,
  isGenerationPath,
  parseTurnFromRequest,
} from "./parse";
import { addTraffic, upsertTurn } from "./store";
import type { Turn } from "./types";

export const UPSTREAM_HOST =
  process.env.UPSTREAM_HOST ?? "cli-chat-proxy.grok.com";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function forwardHeaders(
  headers: http.IncomingHttpHeaders,
  body: Buffer
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (key.toLowerCase() === "accept-encoding") continue;
    if (value !== undefined) out[key] = value;
  }
  delete out["content-length"];
  if (body.length > 0) out["content-length"] = String(body.length);
  out.host = UPSTREAM_HOST;
  return out;
}

export function handleProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const reqPath = req.url ?? "/";
  const method = (req.method ?? "GET").toUpperCase();
  const chunks: Buffer[] = [];

  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const encoding = headerStr(req.headers["content-encoding"]);
    const started = Date.now();
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const logged = isGenerationPath(method, reqPath);

    let turn: Turn | null = null;
    if (logged) {
      const requestText = decodeRequestBody(body, encoding);
      const parsed = parseTurnFromRequest({
        id,
        timestamp,
        method,
        path: reqPath,
        requestText,
      });
      turn = {
        id,
        timestamp,
        method,
        path: reqPath,
        statusCode: null,
        status: "in_flight",
        bytesIn: body.length,
        bytesOut: 0,
        durationMs: null,
        response: emptyResponse(),
        ...parsed,
      };
      // Response tokens not known yet
      turn.totals = { ...turn.totals, response: 0 };
      upsertTurn(turn);
    }

    const upstream = https.request(
      {
        hostname: UPSTREAM_HOST,
        port: 443,
        path: reqPath,
        method,
        servername: UPSTREAM_HOST,
        headers: forwardHeaders(req.headers, body),
      },
      (up) => {
        const status = up.statusCode ?? 502;
        const outHeaders = { ...up.headers };
        delete outHeaders["connection"];
        res.writeHead(status, outHeaders);

        const responseChunks: Buffer[] = [];
        up.on("data", (chunk: Buffer) => {
          responseChunks.push(chunk);
          res.write(chunk);
        });
        up.on("end", () => {
          res.end();
          const raw = Buffer.concat(responseChunks);
          const durationMs = Date.now() - started;
          addTraffic({
            id,
            timestamp,
            method,
            path: reqPath,
            statusCode: status,
            logged,
            note: logged ? undefined : "forwarded, not a generation call",
          });
          if (turn) {
            const withRes = applyResponse(
              {
                ...turn,
                statusCode: status,
                status: status >= 400 ? "error" : "complete",
                bytesOut: raw.length,
                durationMs,
              },
              raw.toString("utf8")
            );
            upsertTurn(withRes);
          }
        });
      }
    );

    upstream.on("error", (err) => {
      console.error(`[proxy] upstream error: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: `payload-inspector upstream: ${err.message}` }));
      addTraffic({
        id,
        timestamp,
        method,
        path: reqPath,
        statusCode: 502,
        logged,
        note: err.message,
      });
      if (turn) {
        upsertTurn({
          ...turn,
          status: "error",
          statusCode: 502,
          error: err.message,
          durationMs: Date.now() - started,
          totals: turn.totals ?? emptyTotals(),
        });
      }
    });

    if (body.length > 0) upstream.write(body);
    upstream.end();
  });
}

function headerStr(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
