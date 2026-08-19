/**
 * Recordings live in the user's home directory, never inside the git clone.
 * Auth headers are not part of Turn and are never written.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Turn } from "./types";

const written = new Set<string>();

export function logDir(): string {
  if (process.env.PAYLOAD_INSPECTOR_LOG_DIR) {
    return process.env.PAYLOAD_INSPECTOR_LOG_DIR;
  }
  return path.join(os.homedir(), ".payload-inspector", "logs");
}

function recordingPath(): string {
  return path.join(logDir(), "recording.jsonl");
}

export function ensureLogDir(): string {
  const dir = logDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function appendTurn(turn: Turn): void {
  if (turn.status === "in_flight") return;
  if (written.has(turn.id)) return;
  try {
    ensureLogDir();
    fs.appendFileSync(recordingPath(), `${JSON.stringify({ turn })}\n`, "utf8");
    written.add(turn.id);
  } catch {
    // Persistence must never break the proxy path.
  }
}

export function loadTurns(limit: number): Turn[] {
  try {
    const file = recordingPath();
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, "utf8");
    const loaded: Turn[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const turn = turnFromLine(parsed);
        if (turn) {
          written.add(turn.id);
          loaded.push(turn);
        }
      } catch {
        // skip corrupt lines
      }
    }
    loaded.reverse();
    return loaded.slice(0, limit);
  } catch {
    return [];
  }
}

export function rotateRecording(): void {
  written.clear();
  const file = recordingPath();
  if (!fs.existsSync(file)) return;
  if (fs.statSync(file).size === 0) return;
  const stamp = new Date().toISOString().replace(/:/g, "-");
  const dest = path.join(ensureLogDir(), `recording-${stamp}.jsonl`);
  fs.renameSync(file, dest);
}

/** Drop the current file so a new process does not reload the last session. */
export function startFresh(): void {
  written.clear();
  try {
    const file = recordingPath();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

function turnFromLine(parsed: unknown): Turn | null {
  if (!parsed || typeof parsed !== "object" || !("turn" in parsed)) return null;
  const raw = (parsed as { turn: unknown }).turn;
  if (!raw || typeof raw !== "object") return null;
  const turn = raw as Turn;
  return {
    ...turn,
    lastUserText: turn.lastUserText ?? "",
    userMessageCount: turn.userMessageCount ?? 0,
    groupKey: turn.groupKey ?? "0::",
  };
}
