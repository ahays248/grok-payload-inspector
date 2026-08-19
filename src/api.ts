import type {
  ProxyInfo,
  SessionStats,
  TrafficEvent,
  Turn,
  TurnDiff,
  TurnSummary,
  UserTurnGroup,
} from "../server/types";
import { PROXY_ORIGIN } from "./lib";

export interface Snapshot {
  summaries: TurnSummary[];
  groups: UserTurnGroup[];
  stats: SessionStats;
  traffic: TrafficEvent[];
  proxy: ProxyInfo;
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const r = await fetch(`${PROXY_ORIGIN}/api/turns`);
  if (!r.ok) throw new Error(`snapshot ${r.status}`);
  return r.json();
}

export async function fetchTurn(id: string): Promise<Turn> {
  const r = await fetch(`${PROXY_ORIGIN}/api/turns/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`turn ${r.status}`);
  return r.json();
}

export async function fetchDiff(id: string, prevId?: string | null): Promise<TurnDiff> {
  const q = prevId ? `?prev=${encodeURIComponent(prevId)}` : "";
  const r = await fetch(
    `${PROXY_ORIGIN}/api/turns/${encodeURIComponent(id)}/diff${q}`
  );
  if (!r.ok) throw new Error(`diff ${r.status}`);
  return r.json();
}

export async function clearRecording(): Promise<void> {
  await fetch(`${PROXY_ORIGIN}/api/turns`, { method: "DELETE" });
}
