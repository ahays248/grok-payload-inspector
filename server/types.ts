export type TurnStatus = "in_flight" | "complete" | "error";

export type SectionId =
  | "system"
  | "tools"
  | "mcp"
  | "skills"
  | "messages"
  | "response"
  | "other";

export interface TokenTotals {
  system: number;
  tools: number;
  mcp: number;
  skills: number;
  messages: number;
  response: number;
  other: number;
  total: number;
}

export interface PromptSlice {
  id: string;
  title: string;
  text: string;
  tokens: number;
}

export interface ToolSlice {
  name: string;
  kind: "native" | "mcp";
  type: string;
  description: string;
  schema: unknown;
  tokens: number;
  server?: string;
}

export interface SkillSlice {
  name: string;
  description: string;
  path?: string;
  tokens: number;
}

export interface ChatMessage {
  role: string;
  type?: string;
  text: string;
  tokens: number;
}

export interface ParsedResponse {
  text: string;
  reasoning: string;
  toolCalls: { name: string; arguments: string }[];
  tokens: number;
}

export interface Turn {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number | null;
  model: string;
  status: TurnStatus;
  bytesIn: number;
  bytesOut: number;
  durationMs: number | null;
  error?: string;
  totals: TokenTotals;
  systemSlices: PromptSlice[];
  tools: ToolSlice[];
  mcpTools: ToolSlice[];
  skills: SkillSlice[];
  messages: ChatMessage[];
  response: ParsedResponse;
  params: Record<string, string>;
  /** Pretty-printed request JSON, secrets stripped. */
  rawRequest: string;
  /** Last user message in this request (used to group a tool-loop). */
  lastUserText: string;
  /** How many user messages are in the conversation so far. */
  userMessageCount: number;
  /** `${userMessageCount}::${lastUserText}` — consecutive calls with the same key are one user turn. */
  groupKey: string;
}

export interface TurnSummary {
  id: string;
  timestamp: string;
  model: string;
  status: TurnStatus;
  path: string;
  statusCode: number | null;
  preview: string;
  totals: TokenTotals;
  durationMs: number | null;
  toolCount: number;
  mcpCount: number;
  skillCount: number;
  lastUserText: string;
  userMessageCount: number;
  groupKey: string;
  messageCount: number;
}

/** One thing the user typed, plus every model call until they type again. */
export interface UserTurnGroup {
  id: string;
  groupKey: string;
  preview: string;
  timestamp: string;
  lastTimestamp: string;
  callCount: number;
  billedTokens: number;
  latestTokens: number;
  latestTotals: TokenTotals;
  callIds: string[];
  status: TurnStatus;
  model: string;
}

export interface SessionPoint {
  turnId: string;
  timestamp: string;
  totals: TokenTotals;
  billedCumulative: number;
  groupId: string;
  compacted: boolean;
}

export interface SessionStats {
  callCount: number;
  userTurnCount: number;
  billedTokens: number;
  latestTokens: number;
  latestTotals: TokenTotals | null;
  /** system + tools + mcp + skills on the latest call — the always-on tax. */
  fixedTokens: number;
  /** messages on the latest call — the part that should grow. */
  growingTokens: number;
  series: SessionPoint[];
}

export interface TurnDiff {
  prevId: string;
  nextId: string;
  sectionDeltas: TokenTotals;
  toolsAdded: string[];
  toolsRemoved: string[];
  mcpAdded: string[];
  mcpRemoved: string[];
  skillsAdded: string[];
  skillsRemoved: string[];
  messagesAdded: ChatMessage[];
  prevMessageCount: number;
  nextMessageCount: number;
  unchanged: {
    tools: boolean;
    mcp: boolean;
    skills: boolean;
    system: boolean;
  };
}

export interface TrafficEvent {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number | null;
  logged: boolean;
  note?: string;
}

export type SsePayload =
  | {
      type: "hello";
      summaries: TurnSummary[];
      groups: UserTurnGroup[];
      stats: SessionStats;
      traffic: TrafficEvent[];
      proxy: ProxyInfo;
    }
  | {
      type: "turn";
      summary: TurnSummary;
      groups: UserTurnGroup[];
      stats: SessionStats;
    }
  | { type: "traffic"; event: TrafficEvent }
  | { type: "cleared" };

export interface ProxyInfo {
  listen: string;
  upstream: string;
  grokCommand: string;
}
