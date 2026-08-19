import { useMemo, useState, type ReactNode } from "react";
import type {
  ChatMessage,
  PromptSlice,
  ProxyInfo,
  SectionId,
  SkillSlice,
  TokenTotals,
  ToolSlice,
  TrafficEvent,
  Turn,
} from "../server/types";
import {
  SECTION_COLOR,
  SECTIONS,
  barSegments,
  clock,
  formatBytes,
  formatDuration,
  formatTokens,
  pct,
} from "./lib";

export function StackedBar({
  totals,
  onPick,
}: {
  totals: TokenTotals;
  onPick?: (id: SectionId) => void;
}) {
  const segs = barSegments(totals);
  const total = Math.max(totals.total, 1);
  return (
    <div className="space-y-2">
      <div className="flex h-4 w-full overflow-hidden rounded-sm bg-panel-2 ring-1 ring-line">
        {segs.map((s) => (
          <button
            key={s.id}
            title={`${s.id}: ${formatTokens(s.tokens)}`}
            onClick={() => onPick?.(s.id)}
            className="h-full transition-opacity hover:opacity-80"
            style={{
              width: `${pct(s.tokens, total)}%`,
              background: SECTION_COLOR[s.id],
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => onPick?.(s.id)}
            className="inline-flex items-center gap-1.5 hover:text-text"
          >
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: SECTION_COLOR[s.id] }}
            />
            {s.short}
            <span className="font-mono text-text/80">{formatTokens(totals[s.id])}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function StatCards({
  totals,
  active,
  onPick,
}: {
  totals: TokenTotals;
  active: SectionId | "overview";
  onPick: (id: SectionId) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
      {SECTIONS.map((s) => {
        const selected = active === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            className={`rounded-md border px-3 py-2.5 text-left transition ${
              selected
                ? "border-transparent bg-panel-2 ring-1"
                : "border-line bg-panel hover:border-text/20"
            }`}
            style={selected ? { boxShadow: `inset 0 0 0 1px ${SECTION_COLOR[s.id]}` } : undefined}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wide text-muted">{s.short}</span>
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: SECTION_COLOR[s.id] }}
              />
            </div>
            <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
              {formatTokens(totals[s.id])}
            </div>
            <div className="text-[11px] text-muted">{pct(totals[s.id], totals.total).toFixed(0)}% of payload</div>
          </button>
        );
      })}
    </div>
  );
}

export function FilterBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-line bg-ink px-3 py-1.5 font-mono text-xs text-text outline-none placeholder:text-muted/70 focus:border-system"
    />
  );
}

export function PromptPane({ slices }: { slices: PromptSlice[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(slices[0]?.id ?? null);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return slices;
    return slices.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) ||
        s.text.toLowerCase().includes(needle)
    );
  }, [q, slices]);

  if (slices.length === 0) {
    return <EmptyPane label="No system prompt in this request." />;
  }

  return (
    <div className="space-y-3">
      <FilterBox value={q} onChange={setQ} placeholder="Filter system prompt sections…" />
      <div className="space-y-2">
        {filtered
          .slice()
          .sort((a, b) => b.tokens - a.tokens)
          .map((s) => (
            <article key={s.id} className="overflow-hidden rounded-md border border-line bg-panel">
              <button
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-panel-2"
                onClick={() => setOpen(open === s.id ? null : s.id)}
              >
                <span
                  className="h-8 w-1 shrink-0 rounded-full"
                  style={{ background: SECTION_COLOR.system }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.title}</div>
                  <div className="text-[11px] text-muted">{s.text.split("\n").length} lines</div>
                </div>
                <span className="font-mono text-sm tabular-nums text-system">
                  {formatTokens(s.tokens)}
                </span>
              </button>
              {open === s.id && (
                <pre className="max-h-[28rem] overflow-auto border-t border-line bg-ink p-3 text-[12px] leading-relaxed whitespace-pre-wrap text-text/90">
                  {highlight(s.text, q)}
                </pre>
              )}
            </article>
          ))}
      </div>
    </div>
  );
}

export function ToolsPane({
  tools,
  accent,
  empty,
}: {
  tools: ToolSlice[];
  accent: string;
  empty: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const ranked = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tools
      .filter(
        (t) =>
          !needle ||
          t.name.toLowerCase().includes(needle) ||
          t.description.toLowerCase().includes(needle) ||
          (t.server ?? "").toLowerCase().includes(needle)
      )
      .slice()
      .sort((a, b) => b.tokens - a.tokens);
  }, [q, tools]);
  const max = ranked[0]?.tokens ?? 1;

  if (tools.length === 0) return <EmptyPane label={empty} />;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <FilterBox value={q} onChange={setQ} placeholder="Filter tools by name or description…" />
        <div className="shrink-0 pb-1 font-mono text-[11px] text-muted">
          {ranked.length} / {tools.length} · sorted by size
        </div>
      </div>
      <div className="space-y-1">
        {ranked.map((t) => {
          const isOpen = open === t.name;
          return (
            <article key={t.name} className="rounded-md border border-line bg-panel">
              <button
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-panel-2"
                onClick={() => setOpen(isOpen ? null : t.name)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-sm">{t.name}</span>
                    {t.server && (
                      <span className="rounded bg-mcp/15 px-1.5 py-0.5 font-mono text-[10px] text-mcp">
                        {t.server}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct(t.tokens, max)}%`, background: accent }}
                    />
                  </div>
                </div>
                <span className="shrink-0 font-mono text-sm tabular-nums" style={{ color: accent }}>
                  {formatTokens(t.tokens)}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-2 border-t border-line bg-ink p-3">
                  {t.description && (
                    <p className="text-sm leading-relaxed text-text/85">{t.description}</p>
                  )}
                  {t.schema != null && (
                    <pre className="max-h-80 overflow-auto text-[11px] leading-relaxed text-muted">
                      {JSON.stringify(t.schema, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function SkillsPane({ skills }: { skills: SkillSlice[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return skills
      .filter(
        (s) =>
          !needle ||
          s.name.toLowerCase().includes(needle) ||
          s.description.toLowerCase().includes(needle)
      )
      .slice()
      .sort((a, b) => b.tokens - a.tokens);
  }, [q, skills]);

  if (skills.length === 0) {
    return (
      <EmptyPane label="No skills catalogue found in the system prompt. Search the System pane for “skill” if Grok used a different heading." />
    );
  }

  return (
    <div className="space-y-3">
      <FilterBox value={q} onChange={setQ} placeholder="Filter skills…" />
      <div className="grid gap-2 md:grid-cols-2">
        {filtered.map((s) => (
          <article key={s.name} className="rounded-md border border-line bg-panel p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="font-mono text-sm text-skills">{s.name}</div>
              <div className="font-mono text-xs text-muted">{formatTokens(s.tokens)}</div>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-text/85">{s.description}</p>
            {s.path && (
              <div className="mt-2 truncate font-mono text-[11px] text-muted" title={s.path}>
                {s.path}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

export function MessagesPane({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) return <EmptyPane label="No messages in this request." />;
  return (
    <div className="space-y-2">
      {messages.map((m, i) => (
        <article key={i} className="rounded-md border border-line bg-panel">
          <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wide text-messages">
              {m.role}
              {m.type ? ` · ${m.type}` : ""}
            </span>
            <span className="font-mono text-[11px] text-muted">{formatTokens(m.tokens)}</span>
          </header>
          <pre className="max-h-72 overflow-auto p-3 text-[12px] leading-relaxed whitespace-pre-wrap text-text/90">
            {m.text || "∅"}
          </pre>
        </article>
      ))}
    </div>
  );
}

export function ResponsePane({ turn }: { turn: Turn }) {
  const r = turn.response;
  if (turn.status === "in_flight" && !r.text && !r.reasoning) {
    return (
      <div className="rounded-md border border-dashed border-line p-6 text-sm text-muted">
        Waiting for the model stream…
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {r.reasoning && (
        <details className="rounded-md border border-line bg-panel">
          <summary className="cursor-pointer px-3 py-2 text-sm text-muted">
            Reasoning · {formatTokens(Math.ceil(r.reasoning.length / 4))}
          </summary>
          <pre className="max-h-64 overflow-auto border-t border-line p-3 text-[12px] leading-relaxed whitespace-pre-wrap">
            {r.reasoning}
          </pre>
        </details>
      )}
      {r.toolCalls.length > 0 && (
        <div className="space-y-2">
          {r.toolCalls.map((c, i) => (
            <article key={i} className="rounded-md border border-line bg-panel p-3">
              <div className="font-mono text-sm text-tools">{c.name}</div>
              <pre className="mt-2 overflow-auto text-[11px] text-muted">{c.arguments}</pre>
            </article>
          ))}
        </div>
      )}
      <pre className="min-h-40 overflow-auto rounded-md border border-line bg-ink p-3 text-[13px] leading-relaxed whitespace-pre-wrap">
        {r.text || <span className="text-muted">No text in the response body.</span>}
      </pre>
    </div>
  );
}

export function RawPane({ raw }: { raw: string }) {
  const [q, setQ] = useState("");
  return (
    <div className="space-y-3">
      <FilterBox value={q} onChange={setQ} placeholder="Jump to a string in the raw JSON…" />
      <pre className="max-h-[40rem] overflow-auto rounded-md border border-line bg-ink p-3 text-[11px] leading-relaxed text-muted">
        {q ? highlight(raw, q) : raw}
      </pre>
    </div>
  );
}

export function EmptyPane({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
      {label}
    </div>
  );
}

export function Offenders({ turn, onOpenTool }: { turn: Turn; onOpenTool: () => void }) {
  const top = [...turn.tools, ...turn.mcpTools].sort((a, b) => b.tokens - a.tokens).slice(0, 8);
  if (top.length === 0) return null;
  const max = top[0].tokens;
  return (
    <section className="rounded-md border border-line bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Biggest tool schemas</h3>
        <button onClick={onOpenTool} className="text-[11px] text-muted hover:text-text">
          Open tools pane →
        </button>
      </div>
      <div className="space-y-2">
        {top.map((t) => (
          <div key={t.name} className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-xs">{t.name}</span>
                {t.kind === "mcp" && (
                  <span className="text-[10px] uppercase tracking-wide text-mcp">mcp</span>
                )}
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink">
                <div
                  className="h-full"
                  style={{
                    width: `${pct(t.tokens, max)}%`,
                    background: t.kind === "mcp" ? SECTION_COLOR.mcp : SECTION_COLOR.tools,
                  }}
                />
              </div>
            </div>
            <span className="font-mono text-xs tabular-nums text-muted">{formatTokens(t.tokens)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SetupCard({ proxy, onCopy, copied }: {
  proxy: ProxyInfo | null;
  onCopy: () => void;
  copied: boolean;
}) {
  const cmd = proxy?.grokCommand ??
    '$env:GROK_CLI_CHAT_PROXY_BASE_URL = "http://127.0.0.1:8787/v1"; grok';
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-16">
      <div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted">Waiting for a turn</div>
        <h2 className="mt-2 text-2xl font-semibold">Point Grok Build at this proxy</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          The env var only applies to the terminal you set it in. Other Grok sessions
          stay on the real API. Start this dashboard first, then Grok. Recordings stay
          on this machine under <code className="font-mono text-text/80">~/.payload-inspector</code> —
          nothing is uploaded.
        </p>
      </div>
      <ol className="space-y-3 text-sm">
        <li className="rounded-md border border-line bg-panel p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">1 · This window</div>
          <div className="mt-1">Leave the inspector running. You are here.</div>
        </li>
        <li className="rounded-md border border-line bg-panel p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">2 · Another terminal</div>
          <pre className="mt-2 overflow-x-auto rounded bg-ink p-3 font-mono text-[12px] text-system">
            {cmd.replace("; ", "\n")}
          </pre>
          <button
            onClick={onCopy}
            className="mt-3 rounded border border-line px-3 py-1 text-xs hover:border-system hover:text-system"
          >
            {copied ? "Copied" : "Copy command"}
          </button>
        </li>
        <li className="rounded-md border border-line bg-panel p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted">3 · Send a test</div>
          <div className="mt-1">
            In Grok, send <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-messages">Hello!</code>{" "}
            This pane fills in as the request goes by.
          </div>
        </li>
      </ol>
    </div>
  );
}

export function TrafficStrip({ events }: { events: TrafficEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="flex gap-3 overflow-x-auto border-t border-line bg-panel px-3 py-1.5 font-mono text-[10px] text-muted">
      {events.slice(0, 12).map((e) => (
        <span key={e.id} className="shrink-0">
          <span className={e.logged ? "text-skills" : ""}>
            {e.method} {e.path}
          </span>
          {e.statusCode != null ? ` → ${e.statusCode}` : ""}
          {e.logged ? " · turn" : ""}
        </span>
      ))}
    </div>
  );
}

export function TurnRow({
  turn,
  selected,
  onClick,
}: {
  turn: Turn;
  selected: boolean;
  onClick: () => void;
}) {
  const preview =
    [...turn.messages].reverse().find((m) => m.role === "user")?.text.replace(/\s+/g, " ").trim() ??
    turn.path;
  return (
    <button
      onClick={onClick}
      className={`w-full border-b border-line px-3 py-2.5 text-left ${
        selected ? "bg-panel-2" : "hover:bg-panel-2/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted">{clock(turn.timestamp)}</span>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            turn.status === "in_flight"
              ? "live-dot bg-tools"
              : turn.status === "error"
                ? "bg-response"
                : "bg-skills"
          }`}
        />
      </div>
      <div className="mt-1 truncate text-[13px]">{preview.slice(0, 72) || turn.model}</div>
      <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-muted">
        <span>{turn.model}</span>
        <span className="text-text/80">{formatTokens(turn.totals.total)}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink">
        <div className="flex h-full w-full">
          {barSegments(turn.totals).map((s) => (
            <span
              key={s.id}
              style={{
                width: `${pct(s.tokens, Math.max(turn.totals.total, 1))}%`,
                background: SECTION_COLOR[s.id],
              }}
            />
          ))}
        </div>
      </div>
    </button>
  );
}

function highlight(text: string, q: string): ReactNode {
  const needle = q.trim();
  if (!needle) return text;
  const parts = text.split(new RegExp(`(${escapeRe(needle)})`, "ig"));
  return parts.map((p, i) =>
    p.toLowerCase() === needle.toLowerCase() ? (
      <mark key={i} className="bg-tools/40 text-text">
        {p}
      </mark>
    ) : (
      p
    )
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function MetaLine({ turn }: { turn: Turn }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
      <span>{turn.method} {turn.path}</span>
      <span>{turn.statusCode ?? "…"}</span>
      <span>{formatBytes(turn.bytesIn)} in</span>
      <span>{formatBytes(turn.bytesOut)} out</span>
      <span>{formatDuration(turn.durationMs)}</span>
      {Object.entries(turn.params).slice(0, 6).map(([k, v]) => (
        <span key={k}>
          {k}={v.length > 24 ? `${v.slice(0, 21)}…` : v}
        </span>
      ))}
    </div>
  );
}
