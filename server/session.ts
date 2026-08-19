import { summarizePreview } from "./parse";
import type {
  ChatMessage,
  SessionPoint,
  SessionStats,
  TokenTotals,
  Turn,
  TurnDiff,
  TurnSummary,
  UserTurnGroup,
} from "./types";

export function toSummary(turn: Turn): TurnSummary {
  return {
    id: turn.id,
    timestamp: turn.timestamp,
    model: turn.model,
    status: turn.status,
    path: turn.path,
    statusCode: turn.statusCode,
    preview: summarizePreview(turn),
    totals: turn.totals,
    durationMs: turn.durationMs,
    toolCount: turn.tools.length,
    mcpCount: turn.mcpTools.length,
    skillCount: turn.skills.length,
    lastUserText: turn.lastUserText,
    userMessageCount: turn.userMessageCount,
    groupKey: turn.groupKey,
    messageCount: turn.messages.length,
  };
}

/** Oldest first. */
export function chronological<T extends { timestamp: string }>(items: T[]): T[] {
  return items.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Consecutive API calls that share a groupKey are one user turn
 * (the tool-loop after one typed message). A new user message bumps
 * userMessageCount, so a later identical "Hello!" is a new group.
 */
export function groupUserTurns(summaries: TurnSummary[]): UserTurnGroup[] {
  const ordered = chronological(summaries);
  const groups: UserTurnGroup[] = [];
  for (const s of ordered) {
    const current = groups[groups.length - 1];
    if (current && current.groupKey === s.groupKey) {
      current.callIds.push(s.id);
      current.callCount += 1;
      current.billedTokens += s.totals.total;
      current.lastTimestamp = s.timestamp;
      current.latestTokens = s.totals.total;
      current.latestTotals = s.totals;
      current.model = s.model;
      if (s.status === "in_flight" || current.status === "in_flight") {
        current.status = "in_flight";
      } else if (s.status === "error") {
        current.status = "error";
      } else if (current.status !== "error") {
        current.status = s.status;
      }
      if (s.preview && s.preview !== s.path) current.preview = s.preview;
      continue;
    }
    groups.push({
      id: `g-${s.id}`,
      groupKey: s.groupKey,
      preview: s.preview || s.lastUserText || s.path,
      timestamp: s.timestamp,
      lastTimestamp: s.timestamp,
      callCount: 1,
      billedTokens: s.totals.total,
      latestTokens: s.totals.total,
      latestTotals: s.totals,
      callIds: [s.id],
      status: s.status,
      model: s.model,
    });
  }
  return groups.slice().reverse();
}

export function fixedTokens(totals: TokenTotals): number {
  return totals.system + totals.tools + totals.mcp + totals.skills;
}

export function computeStats(summaries: TurnSummary[]): SessionStats {
  const ordered = chronological(summaries);
  if (ordered.length === 0) {
    return {
      callCount: 0,
      userTurnCount: 0,
      billedTokens: 0,
      latestTokens: 0,
      latestTotals: null,
      fixedTokens: 0,
      growingTokens: 0,
      series: [],
    };
  }
  const groups = groupUserTurns(summaries);
  const series: SessionPoint[] = [];
  let billed = 0;
  let prevTotal = 0;
  for (const s of ordered) {
    billed += s.totals.total;
    const compacted = prevTotal > 0 && s.totals.messages < prevTotal * 0.7;
    const group = groups.find((g) => g.callIds.includes(s.id));
    series.push({
      turnId: s.id,
      timestamp: s.timestamp,
      totals: s.totals,
      billedCumulative: billed,
      groupId: group?.id ?? s.groupKey,
      compacted,
    });
    prevTotal = s.totals.messages;
  }
  const latest = ordered[ordered.length - 1];
  return {
    callCount: ordered.length,
    userTurnCount: groups.length,
    billedTokens: billed,
    latestTokens: latest.totals.total,
    latestTotals: latest.totals,
    fixedTokens: fixedTokens(latest.totals),
    growingTokens: latest.totals.messages,
    series,
  };
}

export function diffTurns(prev: Turn, next: Turn): TurnDiff {
  const sectionDeltas: TokenTotals = {
    system: next.totals.system - prev.totals.system,
    tools: next.totals.tools - prev.totals.tools,
    mcp: next.totals.mcp - prev.totals.mcp,
    skills: next.totals.skills - prev.totals.skills,
    messages: next.totals.messages - prev.totals.messages,
    response: next.totals.response - prev.totals.response,
    other: next.totals.other - prev.totals.other,
    total: next.totals.total - prev.totals.total,
  };

  const prevTools = new Set(prev.tools.map((t) => t.name));
  const nextTools = new Set(next.tools.map((t) => t.name));
  const prevMcp = new Set(prev.mcpTools.map((t) => t.name));
  const nextMcp = new Set(next.mcpTools.map((t) => t.name));
  const prevSkills = new Set(prev.skills.map((s) => s.name));
  const nextSkills = new Set(next.skills.map((s) => s.name));

  const toolsAdded = [...nextTools].filter((n) => !prevTools.has(n));
  const toolsRemoved = [...prevTools].filter((n) => !nextTools.has(n));
  const mcpAdded = [...nextMcp].filter((n) => !prevMcp.has(n));
  const mcpRemoved = [...prevMcp].filter((n) => !nextMcp.has(n));
  const skillsAdded = [...nextSkills].filter((n) => !prevSkills.has(n));
  const skillsRemoved = [...prevSkills].filter((n) => !nextSkills.has(n));

  const messagesAdded = addedMessages(prev.messages, next.messages);

  return {
    prevId: prev.id,
    nextId: next.id,
    sectionDeltas,
    toolsAdded,
    toolsRemoved,
    mcpAdded,
    mcpRemoved,
    skillsAdded,
    skillsRemoved,
    messagesAdded,
    prevMessageCount: prev.messages.length,
    nextMessageCount: next.messages.length,
    unchanged: {
      tools: toolsAdded.length === 0 && toolsRemoved.length === 0 &&
        Math.abs(sectionDeltas.tools) < 8,
      mcp: mcpAdded.length === 0 && mcpRemoved.length === 0 &&
        Math.abs(sectionDeltas.mcp) < 8,
      skills: skillsAdded.length === 0 && skillsRemoved.length === 0 &&
        Math.abs(sectionDeltas.skills) < 8,
      system: Math.abs(sectionDeltas.system) < 8,
    },
  };
}

function addedMessages(prev: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  if (next.length <= prev.length) return next.slice(prev.length);
  // Prefix equal? then tail is new. Otherwise return messages that weren't in prev text set.
  const prevTexts = new Set(prev.map((m) => `${m.role}:${m.text}`));
  const added = next.filter((m) => !prevTexts.has(`${m.role}:${m.text}`));
  return added.length > 0 ? added : next.slice(prev.length);
}

export function previousTurnId(summaries: TurnSummary[], id: string): string | null {
  const ordered = chronological(summaries);
  const idx = ordered.findIndex((s) => s.id === id);
  if (idx <= 0) return null;
  return ordered[idx - 1].id;
}
