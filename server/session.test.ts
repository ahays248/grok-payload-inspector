import { describe, expect, it } from "vitest";
import { emptyTotals } from "./parse";
import { computeStats, diffTurns, groupUserTurns, previousTurnId, toSummary } from "./session";
import type { Turn, TurnSummary } from "./types";

function summary(over: Partial<TurnSummary> & { id: string; groupKey: string }): TurnSummary {
  const t = emptyTotals();
  t.messages = 10;
  t.tools = 80;
  t.total = 90;
  return {
    timestamp: "2026-08-19T00:00:00.000Z",
    model: "grok-4.6",
    status: "complete",
    path: "/v1/responses",
    statusCode: 200,
    preview: "Hello!",
    totals: t,
    durationMs: 100,
    toolCount: 2,
    mcpCount: 1,
    skillCount: 2,
    lastUserText: "Hello!",
    userMessageCount: 1,
    messageCount: 1,
    ...over,
  };
}

describe("groupUserTurns", () => {
  it("groups consecutive calls that share a groupKey (tool loop)", () => {
    const groups = groupUserTurns([
      summary({ id: "a", groupKey: "1::Hello!", timestamp: "2026-08-19T00:00:01.000Z" }),
      summary({ id: "b", groupKey: "1::Hello!", timestamp: "2026-08-19T00:00:02.000Z" }),
      summary({
        id: "c",
        groupKey: "2::add the dashboard",
        preview: "add the dashboard",
        lastUserText: "add the dashboard",
        userMessageCount: 2,
        timestamp: "2026-08-19T00:00:10.000Z",
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[1].callIds).toEqual(["a", "b"]);
    expect(groups[1].callCount).toBe(2);
    expect(groups[0].callIds).toEqual(["c"]);
    expect(groups[1].billedTokens).toBe(180);
  });

  it("treats a later identical Hello! as a new group because the count bumped", () => {
    const groups = groupUserTurns([
      summary({ id: "a", groupKey: "1::Hello!", timestamp: "2026-08-19T00:00:01.000Z" }),
      summary({
        id: "b",
        groupKey: "2::Hello!",
        userMessageCount: 2,
        timestamp: "2026-08-19T00:00:20.000Z",
      }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("folds empty-fingerprint and auto-title sidecars into the Hello! turn", () => {
    const groups = groupUserTurns([
      summary({
        id: "probe",
        groupKey: "0::",
        lastUserText: "",
        userMessageCount: 0,
        preview: "/v1/responses",
        toolCount: 0,
        mcpCount: 0,
        timestamp: "2026-08-19T00:00:01.000Z",
      }),
      summary({
        id: "hello",
        groupKey: "1::Hello!",
        timestamp: "2026-08-19T00:00:01.200Z",
      }),
      summary({
        id: "title",
        groupKey: "1::Write a 4-word title for this chat",
        lastUserText: "Write a 4-word title for this chat",
        preview: "Write a 4-word title for this chat",
        userMessageCount: 1,
        toolCount: 0,
        mcpCount: 0,
        messageCount: 1,
        timestamp: "2026-08-19T00:00:02.000Z",
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].callCount).toBe(3);
    expect(groups[0].preview).toBe("Hello!");
    expect(groups[0].callIds).toEqual(["probe", "hello", "title"]);
  });
});

describe("computeStats", () => {
  it("sums billed tokens and marks a message drop as compacted", () => {
    const stats = computeStats([
      summary({
        id: "a",
        groupKey: "1::Hello!",
        timestamp: "2026-08-19T00:00:01.000Z",
        totals: { ...emptyTotals(), messages: 100, tools: 50, total: 150 },
      }),
      summary({
        id: "b",
        groupKey: "1::Hello!",
        timestamp: "2026-08-19T00:00:02.000Z",
        totals: { ...emptyTotals(), messages: 20, tools: 50, total: 70 },
      }),
    ]);
    expect(stats.callCount).toBe(2);
    expect(stats.billedTokens).toBe(220);
    expect(stats.latestTokens).toBe(70);
    expect(stats.series[1].compacted).toBe(true);
    expect(stats.series[1].billedCumulative).toBe(220);
  });
});

describe("diffTurns", () => {
  it("flags unchanged catalogues and new messages", () => {
    const base = {
      timestamp: "2026-08-19T00:00:00.000Z",
      method: "POST",
      path: "/v1/responses",
      statusCode: 200,
      model: "grok-4.6",
      status: "complete" as const,
      bytesIn: 1,
      bytesOut: 1,
      durationMs: 1,
      systemSlices: [],
      mcpTools: [],
      skills: [],
      response: { text: "", reasoning: "", toolCalls: [], tokens: 0 },
      params: {},
      rawRequest: "{}",
      lastUserText: "Hello!",
      userMessageCount: 1,
      groupKey: "1::Hello!",
    };
    const prev: Turn = {
      ...base,
      id: "a",
      tools: [{ name: "read_file", kind: "native", type: "function", description: "", schema: {}, tokens: 40 }],
      messages: [{ role: "user", text: "Hello!", tokens: 2 }],
      totals: { ...emptyTotals(), tools: 40, messages: 2, total: 42 },
    };
    const next: Turn = {
      ...base,
      id: "b",
      timestamp: "2026-08-19T00:00:02.000Z",
      tools: prev.tools,
      messages: [
        { role: "user", text: "Hello!", tokens: 2 },
        { role: "assistant", text: "let me look", tokens: 4 },
        { role: "tool", text: "file contents…", tokens: 20 },
      ],
      totals: { ...emptyTotals(), tools: 40, messages: 26, total: 66 },
    };
    const d = diffTurns(prev, next);
    expect(d.unchanged.tools).toBe(true);
    expect(d.sectionDeltas.messages).toBe(24);
    expect(d.messagesAdded.map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect(d.toolsAdded).toEqual([]);
  });
});

describe("previousTurnId", () => {
  it("returns the chronologically previous call", () => {
    const list = [
      summary({ id: "b", groupKey: "1::x", timestamp: "2026-08-19T00:00:02.000Z" }),
      summary({ id: "a", groupKey: "1::x", timestamp: "2026-08-19T00:00:01.000Z" }),
    ];
    expect(previousTurnId(list, "b")).toBe("a");
    expect(previousTurnId(list, "a")).toBeNull();
  });
});

describe("toSummary", () => {
  it("copies grouping fields", () => {
    const turn = {
      id: "a",
      timestamp: "t",
      method: "POST",
      path: "/v1/responses",
      statusCode: 200,
      model: "grok-4.6",
      status: "complete" as const,
      bytesIn: 0,
      bytesOut: 0,
      durationMs: 1,
      totals: emptyTotals(),
      systemSlices: [],
      tools: [],
      mcpTools: [],
      skills: [],
      messages: [{ role: "user", text: "Hi", tokens: 1 }],
      response: { text: "", reasoning: "", toolCalls: [], tokens: 0 },
      params: {},
      rawRequest: "{}",
      lastUserText: "Hi",
      userMessageCount: 1,
      groupKey: "1::Hi",
    };
    expect(toSummary(turn).groupKey).toBe("1::Hi");
  });
});
