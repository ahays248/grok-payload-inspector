import zlib from "node:zlib";
import { estimateJson, estimateTokens } from "./tokens";
import type {
  ChatMessage,
  ParsedResponse,
  PromptSlice,
  SkillSlice,
  TokenTotals,
  ToolSlice,
  Turn,
} from "./types";

const PARAM_KEYS = [
  "max_tokens",
  "max_output_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "stream",
  "tool_choice",
  "reasoning",
  "reasoning_effort",
  "store",
  "truncation",
  "parallel_tool_calls",
  "stream_options",
] as const;

export function emptyTotals(): TokenTotals {
  return {
    system: 0,
    tools: 0,
    mcp: 0,
    skills: 0,
    messages: 0,
    response: 0,
    other: 0,
    total: 0,
  };
}

export function emptyResponse(): ParsedResponse {
  return { text: "", reasoning: "", toolCalls: [], tokens: 0 };
}

export function isGenerationPath(method: string, path: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  const p = path.toLowerCase();
  return (
    p.includes("/responses") ||
    p.includes("/chat/completions") ||
    p.includes("/messages")
  );
}

export function decodeRequestBody(body: Buffer, encoding?: string): string {
  const kind = (encoding ?? "").trim().toLowerCase();
  try {
    if (kind === "gzip") return zlib.gunzipSync(body).toString("utf8");
    if (kind === "br") return zlib.brotliDecompressSync(body).toString("utf8");
    if (kind === "deflate") return zlib.inflateSync(body).toString("utf8");
  } catch {
    // fall through
  }
  return body.toString("utf8");
}

export function parseTurnFromRequest(args: {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  requestText: string;
}): Pick<
  Turn,
  | "model"
  | "systemSlices"
  | "tools"
  | "mcpTools"
  | "skills"
  | "messages"
  | "params"
  | "rawRequest"
  | "totals"
  | "lastUserText"
  | "userMessageCount"
  | "groupKey"
> {
  let json: unknown = null;
  try {
    json = JSON.parse(args.requestText);
  } catch {
    json = null;
  }

  if (!json || typeof json !== "object") {
    const tokens = estimateTokens(args.requestText);
    const messages: ChatMessage[] = [
      {
        role: "raw",
        text: args.requestText.slice(0, 20_000),
        tokens,
      },
    ];
    const fp = conversationFingerprint(messages);
    return {
      model: "unknown",
      systemSlices: [],
      tools: [],
      mcpTools: [],
      skills: [],
      messages,
      params: {},
      rawRequest: args.requestText.slice(0, 200_000),
      totals: {
        ...emptyTotals(),
        other: tokens,
        messages: tokens,
        total: tokens,
      },
      ...fp,
    };
  }

  const j = json as Record<string, unknown>;
  const model = typeof j.model === "string" ? j.model : modelFromPath(args.path);

  const systemText = collectSystemText(j);
  const { skills, blockTokens: skillTokens, rest: systemRest } =
    extractSkills(systemText);

  const systemSlices = splitSystemPrompt(systemRest);
  const systemTokens = systemSlices.reduce((n, s) => n + s.tokens, 0);

  const allTools = collectTools(j);
  const tools = allTools.filter((t) => t.kind === "native");
  const mcpTools = allTools.filter((t) => t.kind === "mcp");

  const messages = collectMessages(j);
  const messageTokens = messages.reduce((n, m) => n + m.tokens, 0);

  const params = collectParams(j);

  const toolTokens = tools.reduce((n, t) => n + t.tokens, 0);
  const mcpTokens = mcpTools.filter((t) => t.kind === "mcp").reduce((n, t) => n + t.tokens, 0);

  const rawRequest = JSON.stringify(j, null, 2);
  const accounted = systemTokens + skillTokens + toolTokens + mcpTokens + messageTokens;
  const other = Math.max(0, estimateJson(j) - accounted);

  return {
    model,
    systemSlices,
    tools,
    mcpTools,
    skills,
    messages,
    params,
    rawRequest,
    totals: {
      system: systemTokens,
      tools: toolTokens,
      mcp: mcpTokens,
      skills: skillTokens,
      messages: messageTokens,
      response: 0,
      other,
      total: accounted + other,
    },
    ...conversationFingerprint(messages),
  };
}

export function isUserMessage(m: { role?: string; type?: string }): boolean {
  const role = (m.role ?? "").toLowerCase();
  const type = (m.type ?? "").toLowerCase();
  if (role === "user" || role === "human") return true;
  if (
    role === "assistant" ||
    role === "tool" ||
    role === "system" ||
    role === "developer" ||
    role === "function"
  ) {
    return false;
  }
  if (
    type === "function_call" ||
    type === "function_call_output" ||
    type === "tool_use" ||
    type === "tool_result"
  ) {
    return false;
  }
  // Responses API sometimes omits role on message / input_text items.
  return type === "message" || type === "input_text";
}

const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/gi;

export function extractUserQueries(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(USER_QUERY_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const q = m[1].replace(/\s+/g, " ").trim();
    if (q) out.push(q);
  }
  return out;
}

function isInjectedBlob(text: string): boolean {
  const t = text.trim();
  return (
    t.startsWith("<system-reminder>") ||
    t.startsWith("<user_info>") ||
    t.startsWith("<environment") ||
    t.startsWith("<agent_info")
  );
}

export function conversationFingerprint(messages: ChatMessage[]): {
  lastUserText: string;
  userMessageCount: number;
  groupKey: string;
} {
  const queries: string[] = [];
  for (const m of messages) queries.push(...extractUserQueries(m.text ?? ""));
  if (queries.length > 0) {
    const lastUserText = queries[queries.length - 1].slice(0, 240);
    return {
      lastUserText,
      userMessageCount: queries.length,
      groupKey: `${queries.length}::${lastUserText}`,
    };
  }
  const users = messages.filter(
    (m) => isUserMessage(m) && !isInjectedBlob(m.text ?? "")
  );
  const lastUserText = (users[users.length - 1]?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  return {
    lastUserText,
    userMessageCount: users.length,
    groupKey: `${users.length}::${lastUserText}`,
  };
}

export function parseResponseStream(raw: string): ParsedResponse {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCalls: { name: string; arguments: string }[] = [];
  const argBuf = new Map<number | string, { name: string; args: string }>();

  for (const payload of iterSsePayloads(raw)) {
    ingestPayload(payload, textParts, reasoningParts, argBuf, toolCalls);
  }

  if (textParts.length === 0 && reasoningParts.length === 0 && toolCalls.length === 0) {
    // Non-stream JSON body
    try {
      const j = JSON.parse(raw);
      ingestPayload(j, textParts, reasoningParts, argBuf, toolCalls);
    } catch {
      // leave empty — caller can show raw
    }
  }

  for (const buf of argBuf.values()) {
    if (buf.name || buf.args) {
      toolCalls.push({ name: buf.name || "(tool)", arguments: buf.args });
    }
  }

  const text = textParts.join("");
  const reasoning = reasoningParts.join("");
  return {
    text,
    reasoning,
    toolCalls,
    tokens: estimateTokens(text) + estimateTokens(reasoning),
  };
}

export function applyResponse(turn: Turn, raw: string): Turn {
  const response = parseResponseStream(raw);
  if (
    !response.text &&
    !response.reasoning &&
    response.toolCalls.length === 0 &&
    raw.trim()
  ) {
    response.text = raw.slice(0, 50_000);
    response.tokens = estimateTokens(response.text);
  }
  const totals = { ...turn.totals };
  totals.response = response.tokens;
  totals.total = totals.system + totals.tools + totals.mcp + totals.skills +
    totals.messages + totals.response + totals.other;
  return { ...turn, response, totals };
}

export function summarizePreview(turn: Pick<Turn, "messages" | "path">): string {
  const queries: string[] = [];
  for (const m of turn.messages) queries.push(...extractUserQueries(m.text ?? ""));
  if (queries.length > 0) {
    const line = queries[queries.length - 1];
    return line.length > 80 ? `${line.slice(0, 77)}…` : line;
  }
  const user = [...turn.messages]
    .reverse()
    .find((m) => isUserMessage(m) && !isInjectedBlob(m.text ?? ""));
  if (user?.text) {
    const line = user.text.replace(/\s+/g, " ").trim();
    return line.length > 80 ? `${line.slice(0, 77)}…` : line;
  }
  return turn.path;
}

function modelFromPath(path: string): string {
  const m = path.match(/models\/([^/?]+)/);
  return m?.[1] ?? "unknown";
}

function collectSystemText(j: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof j.instructions === "string") parts.push(j.instructions);
  if (typeof j.system === "string") parts.push(j.system);
  if (Array.isArray(j.system)) {
    parts.push(flattenContent(j.system));
  }
  if (j.systemInstruction && typeof j.systemInstruction === "object") {
    const si = j.systemInstruction as { parts?: unknown };
    parts.push(flattenContent(si.parts ?? j.systemInstruction));
  }
  const msgs = Array.isArray(j.messages) ? j.messages : [];
  for (const msg of msgs) {
    if (msg && typeof msg === "object" && (msg as { role?: string }).role === "system") {
      parts.push(flattenContent((msg as { content?: unknown }).content));
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

function collectMessages(j: Record<string, unknown>): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (Array.isArray(j.messages)) {
    for (const msg of j.messages) {
      if (!msg || typeof msg !== "object") continue;
      const m = msg as { role?: string; content?: unknown; type?: string };
      if (m.role === "system") continue;
      const text = flattenContent(m.content);
      out.push({
        role: m.role ?? "unknown",
        type: m.type,
        text,
        tokens: Math.max(estimateTokens(text), estimateJson(msg)),
      });
    }
  }
  if (typeof j.input === "string") {
    out.push({ role: "user", text: j.input, tokens: estimateTokens(j.input) });
  } else if (Array.isArray(j.input)) {
    for (const item of j.input) {
      if (!item || typeof item !== "object") continue;
      const it = item as {
        type?: string;
        role?: string;
        content?: unknown;
        text?: string;
        name?: string;
        arguments?: string;
        output?: unknown;
      };
      if (it.role === "system" || it.type === "system" || it.role === "developer") continue;
      let text = itemText(it);
      if (it.type === "function_call") {
        text = `${it.name ?? "tool"}(${it.arguments ?? ""})`;
      } else if (it.type === "function_call_output") {
        text = typeof it.output === "string" ? it.output : JSON.stringify(it.output, null, 2);
      }
      const role = it.role ?? (it.type === "message" || it.type === "input_text" ? "user" : it.type) ?? "item";
      out.push({
        role,
        type: it.type,
        text,
        tokens: estimateJson(item),
      });
    }
  }
  return out;
}

function collectTools(j: Record<string, unknown>): ToolSlice[] {
  if (!Array.isArray(j.tools)) return [];
  return j.tools.map((tool) => toolSlice(tool));
}

function toolSlice(tool: unknown): ToolSlice {
  if (!tool || typeof tool !== "object") {
    return {
      name: "(invalid tool)",
      kind: "native",
      type: "unknown",
      description: "",
      schema: tool,
      tokens: estimateJson(tool),
    };
  }
  const t = tool as {
    type?: string;
    name?: string;
    description?: string;
    parameters?: unknown;
    input_schema?: unknown;
    function?: { name?: string; description?: string; parameters?: unknown };
  };
  const fn = t.function ?? t;
  const name = fn.name ?? t.name ?? t.type ?? "(unnamed)";
  const description = String(fn.description ?? t.description ?? "");
  const schema = fn.parameters ?? t.parameters ?? t.input_schema ?? null;
  const mcp = isMcpName(name);
  const server = mcp ? name.split("__")[0] : undefined;
  return {
    name,
    kind: mcp ? "mcp" : "native",
    type: t.type ?? "function",
    description,
    schema,
    tokens: estimateJson(tool),
    server,
  };
}

export function isMcpName(name: string): boolean {
  if (name.startsWith("mcp__")) return true;
  // Grok qualifies MCP tools as server__tool_name
  if (name.includes("__")) return true;
  return false;
}

function collectParams(j: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PARAM_KEYS) {
    if (j[key] === undefined) continue;
    const v = j[key];
    out[key] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

export function extractSkills(system: string): {
  skills: SkillSlice[];
  blockTokens: number;
  rest: string;
} {
  if (!system) return { skills: [], blockTokens: 0, rest: system };

  const startRe = /(?:the )?following skills are available[^\n]*:/i;
  const start = system.search(startRe);
  if (start < 0) return { skills: [], blockTokens: 0, rest: system };

  const from = system.slice(start);
  const endRel = from.search(
    /\n(?=#{1,3} |\*\*[A-Z]|<system-|MCP servers connected|You use tools via|## )/
  );
  const block = endRel >= 0 ? from.slice(0, endRel) : from;
  const rest = system.slice(0, start) + system.slice(start + block.length);

  const skills: SkillSlice[] = [];
  const itemRe = /^- ([a-zA-Z0-9_./-]+):\s*(.*(?:\n(?!- ).*)*)/gm;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(block))) {
    const name = m[1];
    const body = m[2].trim();
    const pathMatch = body.match(/Absolute path:\s*(.+)/i);
    const description = body.replace(/\s*Absolute path:\s*.+/i, "").trim();
    skills.push({
      name,
      description,
      path: pathMatch?.[1]?.trim(),
      tokens: estimateTokens(m[0]),
    });
  }

  const blockTokens = estimateTokens(block);
  return { skills, blockTokens, rest: rest.trim() };
}

export function splitSystemPrompt(text: string): PromptSlice[] {
  if (!text.trim()) return [];

  const slices: PromptSlice[] = [];
  // Split on markdown headings, XML-ish tags, and a few known labels.
  const parts = text.split(
    /(?=^#{1,3} |\n#{1,3} |^<[a-zA-Z][\w:-]*[>\s]|\n<[a-zA-Z][\w:-]*[>\s])/m
  );

  if (parts.length <= 1) {
    // Try labelled blocks inside a single blob
    const labeled = splitLabeled(text);
    if (labeled.length > 1) return labeled;
    return [
      {
        id: "system",
        title: "System prompt",
        text,
        tokens: estimateTokens(text),
      },
    ];
  }

  let i = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const title = sliceTitle(trimmed, i);
    slices.push({
      id: `sys-${i}`,
      title,
      text: trimmed,
      tokens: estimateTokens(trimmed),
    });
    i += 1;
  }
  return slices;
}

function splitLabeled(text: string): PromptSlice[] {
  const labels = [
    "Environment",
    "Context management",
    "Communication",
    "Tool use",
    "Work policy",
    "Formatting",
    "Safety",
  ];
  const idxs: { title: string; at: number }[] = [];
  for (const label of labels) {
    const re = new RegExp(`(?:^|\\n)(?:#{1,3} )?${label}\\b`, "i");
    const m = re.exec(text);
    if (m && m.index >= 0) idxs.push({ title: label, at: m.index === 0 ? 0 : m.index + 1 });
  }
  idxs.sort((a, b) => a.at - b.at);
  if (idxs.length === 0) return [];

  const slices: PromptSlice[] = [];
  if (idxs[0].at > 0) {
    const head = text.slice(0, idxs[0].at).trim();
    if (head) {
      slices.push({
        id: "sys-preamble",
        title: "Preamble",
        text: head,
        tokens: estimateTokens(head),
      });
    }
  }
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i].at;
    const end = i + 1 < idxs.length ? idxs[i + 1].at : text.length;
    const chunk = text.slice(start, end).trim();
    slices.push({
      id: `sys-${i}`,
      title: idxs[i].title,
      text: chunk,
      tokens: estimateTokens(chunk),
    });
  }
  return slices;
}

function sliceTitle(text: string, index: number): string {
  const heading = text.match(/^#{1,3}\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const tag = text.match(/^<\/?([a-zA-Z][\w:-]*)/);
  if (tag) return tag[1];
  const first = text.split("\n")[0].trim();
  if (first.length > 0 && first.length < 60) return first.replace(/[:#*]/g, "").trim();
  return `Section ${index + 1}`;
}

function itemText(it: { text?: unknown; content?: unknown }): string {
  if (typeof it.text === "string" && it.text.trim()) return it.text;
  return flattenContent(it.content);
}

function flattenContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (!block || typeof block !== "object") return "";
        const b = block as {
          type?: string;
          text?: string;
          content?: unknown;
        };
        if (typeof b.text === "string") return b.text;
        if (b.type === "image" || b.type === "image_url") return "[image]";
        if (b.content) return flattenContent(b.content);
        return JSON.stringify(block);
      })
      .filter(Boolean)
      .join("\n\n");
  }
  if (typeof content === "object") {
    const o = content as { text?: string; content?: unknown };
    if (typeof o.text === "string") return o.text;
    if (o.content) return flattenContent(o.content);
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function iterSsePayloads(raw: string): unknown[] {
  const payloads: unknown[] = [];
  const events = raw.split(/\n\n+/);
  for (const ev of events) {
    const dataLines = ev
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    if (dataLines.length === 0) continue;
    const data = dataLines.join("");
    if (!data || data === "[DONE]") continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // ignore malformed chunk
    }
  }
  return payloads;
}

function ingestPayload(
  payload: unknown,
  textParts: string[],
  reasoningParts: string[],
  argBuf: Map<number | string, { name: string; args: string }>,
  toolCalls: { name: string; arguments: string }[]
): void {
  if (!payload || typeof payload !== "object") return;
  const p = payload as Record<string, unknown>;

  // Responses API deltas
  if (typeof p.delta === "string") {
    const t = String(p.type ?? "");
    if (t.includes("reasoning") || t.includes("thought")) reasoningParts.push(p.delta);
    else textParts.push(p.delta);
  }
  if (p.delta && typeof p.delta === "object") {
    const d = p.delta as { content?: string; reasoning?: string; text?: string };
    if (typeof d.content === "string") textParts.push(d.content);
    if (typeof d.text === "string") textParts.push(d.text);
    if (typeof d.reasoning === "string") reasoningParts.push(d.reasoning);
  }

  // Chat Completions stream
  if (Array.isArray(p.choices)) {
    for (const choice of p.choices) {
      const c = choice as {
        delta?: {
          content?: string | unknown[];
          reasoning_content?: string;
          tool_calls?: unknown[];
        };
        message?: { content?: string; tool_calls?: unknown[] };
      };
      const delta = c.delta ?? {};
      const content = delta.content ?? c.message?.content;
      if (typeof content === "string") textParts.push(content);
      if (typeof delta.reasoning_content === "string") {
        reasoningParts.push(delta.reasoning_content);
      }
      const calls = delta.tool_calls ?? c.message?.tool_calls ?? [];
      for (const call of calls) {
        ingestToolCallDelta(call, argBuf);
      }
    }
  }

  // Completed Responses API message
  if (Array.isArray(p.output)) {
    for (const item of p.output) {
      ingestOutputItem(item, textParts, reasoningParts, toolCalls);
    }
  }
  if (p.response && typeof p.response === "object") {
    ingestPayload(p.response, textParts, reasoningParts, argBuf, toolCalls);
  }
}

function ingestToolCallDelta(
  call: unknown,
  argBuf: Map<number | string, { name: string; args: string }>
): void {
  if (!call || typeof call !== "object") return;
  const c = call as {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
    name?: string;
  };
  const key = c.index ?? c.id ?? 0;
  const cur = argBuf.get(key) ?? { name: "", args: "" };
  if (c.function?.name) cur.name = c.function.name;
  if (c.name) cur.name = c.name;
  if (typeof c.function?.arguments === "string") cur.args += c.function.arguments;
  argBuf.set(key, cur);
}

function ingestOutputItem(
  item: unknown,
  textParts: string[],
  reasoningParts: string[],
  toolCalls: { name: string; arguments: string }[]
): void {
  if (!item || typeof item !== "object") return;
  const it = item as {
    type?: string;
    name?: string;
    arguments?: string;
    content?: unknown;
  };
  if (it.type === "function_call" || it.type === "tool_use") {
    toolCalls.push({
      name: it.name ?? "(tool)",
      arguments: typeof it.arguments === "string" ? it.arguments : JSON.stringify(it.arguments ?? {}),
    });
    return;
  }
  const text = flattenContent(it.content);
  if (!text) return;
  if (it.type && /reason|think/i.test(it.type)) reasoningParts.push(text);
  else textParts.push(text);
}
