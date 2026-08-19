import type { SectionId, TokenTotals } from "../server/types";

export const PROXY_ORIGIN = "http://127.0.0.1:8787";

export const SECTIONS: {
  id: SectionId;
  label: string;
  short: string;
  hint: string;
}[] = [
  {
    id: "system",
    label: "System prompt",
    short: "System",
    hint: "Instructions, environment, and policy shipped on every turn",
  },
  {
    id: "tools",
    label: "Native tools",
    short: "Tools",
    hint: "Built-in tool schemas (read_file, bash, …)",
  },
  {
    id: "mcp",
    label: "MCP tools",
    short: "MCP",
    hint: "Integration tools that ride along whether you need them",
  },
  {
    id: "skills",
    label: "Skills catalogue",
    short: "Skills",
    hint: "Skill names and descriptions listed in the system prompt",
  },
  {
    id: "messages",
    label: "Messages",
    short: "Messages",
    hint: "The conversation and tool results — this is the part that grows",
  },
  {
    id: "response",
    label: "Response",
    short: "Response",
    hint: "What the model streamed back for this turn",
  },
];

export const SECTION_COLOR: Record<SectionId, string> = {
  system: "#5b9fd4",
  tools: "#e6a23c",
  mcp: "#a78bfa",
  skills: "#4ade80",
  messages: "#22d3d8",
  response: "#fb7185",
  other: "#6b7280",
};

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function clock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function pct(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}

export function barSegments(totals: TokenTotals): { id: SectionId; tokens: number }[] {
  return SECTIONS.map((s) => ({ id: s.id, tokens: totals[s.id] })).filter(
    (s) => s.tokens > 0
  );
}
