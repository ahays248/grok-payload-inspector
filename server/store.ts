import { appendTurn, loadTurns, rotateRecording, startFresh } from "./persist";
import { computeStats, groupUserTurns, toSummary } from "./session";
import type {
  ProxyInfo,
  SessionStats,
  SsePayload,
  TrafficEvent,
  Turn,
  TurnSummary,
  UserTurnGroup,
} from "./types";

const MAX_TURNS = 500;
const MAX_TRAFFIC = 200;

const turns: Turn[] =
  process.env.PAYLOAD_INSPECTOR_RESUME === "1"
    ? loadTurns(MAX_TURNS)
    : (startFresh(), []);
const traffic: TrafficEvent[] = [];
const clients = new Set<(payload: SsePayload) => void>();

let proxyInfo: ProxyInfo = {
  listen: "http://127.0.0.1:8787/v1",
  upstream: "https://cli-chat-proxy.grok.com",
  grokCommand:
    process.platform === "win32"
      ? '$env:GROK_CLI_CHAT_PROXY_BASE_URL = "http://127.0.0.1:8787/v1"; grok'
      : "GROK_CLI_CHAT_PROXY_BASE_URL=http://127.0.0.1:8787/v1 grok",
};

export function setProxyInfo(info: ProxyInfo): void {
  proxyInfo = info;
}

export function getProxyInfo(): ProxyInfo {
  return proxyInfo;
}

export function listTurns(): Turn[] {
  return turns;
}

export function listSummaries(): TurnSummary[] {
  return listTurns().map(toSummary);
}

export function sessionPayload(): {
  summaries: TurnSummary[];
  groups: UserTurnGroup[];
  stats: SessionStats;
} {
  const summaries = listSummaries();
  return {
    summaries,
    groups: groupUserTurns(summaries),
    stats: computeStats(summaries),
  };
}

export function getTurn(id: string): Turn | undefined {
  return turns.find((t) => t.id === id);
}

export function upsertTurn(turn: Turn): Turn {
  const idx = turns.findIndex((t) => t.id === turn.id);
  if (idx >= 0) turns[idx] = turn;
  else {
    turns.unshift(turn);
    if (turns.length > MAX_TURNS) turns.pop();
  }
  if (turn.status === "complete" || turn.status === "error") {
    appendTurn(turn);
  }
  const { groups, stats } = sessionPayload();
  broadcast({ type: "turn", summary: toSummary(turn), groups, stats });
  return turn;
}

export function addTraffic(event: TrafficEvent): void {
  traffic.unshift(event);
  if (traffic.length > MAX_TRAFFIC) traffic.pop();
  broadcast({ type: "traffic", event });
}

export function listTraffic(): TrafficEvent[] {
  return traffic;
}

export function clearAll(): void {
  rotateRecording();
  turns.length = 0;
  traffic.length = 0;
  broadcast({ type: "cleared" });
}

export function subscribe(send: (payload: SsePayload) => void): () => void {
  clients.add(send);
  const { summaries, groups, stats } = sessionPayload();
  send({
    type: "hello",
    summaries,
    groups,
    stats,
    traffic: [...traffic],
    proxy: proxyInfo,
  });
  return () => {
    clients.delete(send);
  };
}

function broadcast(payload: SsePayload): void {
  for (const send of clients) {
    try {
      send(payload);
    } catch {
      clients.delete(send);
    }
  }
}
