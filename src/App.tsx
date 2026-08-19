import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProxyInfo,
  SectionId,
  SessionStats,
  SsePayload,
  TrafficEvent,
  Turn,
  TurnDiff,
  TurnSummary,
  UserTurnGroup,
} from "../server/types";
import { clearRecording, fetchDiff, fetchTurn } from "./api";
import {
  MessagesPane,
  MetaLine,
  Offenders,
  PromptPane,
  RawPane,
  ResponsePane,
  SetupCard,
  SkillsPane,
  StackedBar,
  StatCards,
  ToolsPane,
  TrafficStrip,
} from "./components";
import { DiffPane } from "./DiffPane";
import { GroupedTurns } from "./GroupedTurns";
import { PROXY_ORIGIN, SECTION_COLOR, SECTIONS, formatTokens } from "./lib";
import { SessionOverview } from "./SessionOverview";

type Tab = "session" | "call" | "diff" | SectionId | "raw";

const emptyStats = (): SessionStats => ({
  callCount: 0,
  userTurnCount: 0,
  billedTokens: 0,
  latestTokens: 0,
  latestTotals: null,
  fixedTokens: 0,
  growingTokens: 0,
  series: [],
});

export default function App() {
  const [summaries, setSummaries] = useState<TurnSummary[]>([]);
  const [groups, setGroups] = useState<UserTurnGroup[]>([]);
  const [stats, setStats] = useState<SessionStats>(emptyStats);
  const [traffic, setTraffic] = useState<TrafficEvent[]>([]);
  const [proxy, setProxy] = useState<ProxyInfo | null>(null);
  const [live, setLive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [tab, setTab] = useState<Tab>("session");
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Turn | null>(null);
  const [diff, setDiff] = useState<TurnDiff | null>(null);
  const [diffEmpty, setDiffEmpty] = useState<string | undefined>();

  useEffect(() => {
    const es = new EventSource(`${PROXY_ORIGIN}/api/events`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as SsePayload;
        if (msg.type === "hello") {
          setSummaries(msg.summaries);
          setGroups(msg.groups);
          setStats(msg.stats);
          setTraffic(msg.traffic);
          setProxy(msg.proxy);
          setSelectedId((id) => {
            if (id && msg.summaries.some((s) => s.id === id)) return id;
            return newestId(msg.summaries);
          });
        } else if (msg.type === "turn") {
          setSummaries((prev) => {
            const rest = prev.filter((s) => s.id !== msg.summary.id);
            return [msg.summary, ...rest];
          });
          setGroups(msg.groups);
          setStats(msg.stats);
          setSelectedId((id) => {
            // follow is read via functional update on a ref-less state:
            // handled below with a separate effect on summaries+follow
            return id;
          });
        } else if (msg.type === "traffic") {
          setTraffic((prev) => [msg.event, ...prev].slice(0, 200));
        } else if (msg.type === "cleared") {
          setSummaries([]);
          setGroups([]);
          setStats(emptyStats());
          setTraffic([]);
          setSelectedId(null);
          setSelected(null);
          setDiff(null);
          setTab("session");
          setFollow(true);
        }
      } catch {
        // ignore malformed events
      }
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (!follow) return;
    const latest = newestId(summaries);
    if (latest && latest !== selectedId) setSelectedId(latest);
  }, [follow, summaries, selectedId]);

  const selectedGroupId = useMemo(() => {
    if (!selectedId) return null;
    return groups.find((g) => g.callIds.includes(selectedId))?.id ?? null;
  }, [groups, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setDiff(null);
      setDiffEmpty(undefined);
      return;
    }
    let cancelled = false;
    fetchTurn(selectedId)
      .then((t) => {
        if (!cancelled) setSelected(t);
      })
      .catch(() => {
        if (!cancelled) setSelected(null);
      });
    fetchDiff(selectedId)
      .then((d) => {
        if (!cancelled) {
          setDiff(d);
          setDiffEmpty(undefined);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiff(null);
          setDiffEmpty("This is the first call in the recording — nothing to diff.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const pinTurn = useCallback((id: string) => {
    setFollow(false);
    setSelectedId(id);
  }, []);

  const copyCmd = useCallback(async () => {
    const cmd =
      proxy?.grokCommand ??
      '$env:GROK_CLI_CHAT_PROXY_BASE_URL = "http://127.0.0.1:8787/v1"; grok';
    try {
      await navigator.clipboard.writeText(cmd.replace("; ", "\r\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [proxy]);

  const clear = useCallback(async () => {
    await clearRecording();
  }, []);

  const empty = summaries.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-2.5">
        <div className="flex items-center gap-3">
          <BarMark />
          <div>
            <div className="text-sm font-semibold tracking-tight">Payload Inspector</div>
            <div className="text-[11px] text-muted">Unofficial · local only</div>
          </div>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-muted">
          <span className="hidden items-center gap-1.5 sm:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-skills" : "bg-response"}`} />
            {live ? "proxy live" : "proxy offline"}
          </span>
          <span className="hidden md:inline">{proxy?.listen ?? "http://127.0.0.1:8787/v1"}</span>
          <button
            onClick={() => {
              setFollow(true);
              const latest = newestId(summaries);
              if (latest) setSelectedId(latest);
            }}
            className={`rounded border px-2 py-1 ${
              follow
                ? "border-skills/40 text-skills"
                : "border-line hover:border-text/40 hover:text-text"
            }`}
          >
            {follow ? "Following" : "Follow live"}
          </button>
          <button
            onClick={clear}
            className="rounded border border-line px-2 py-1 hover:border-response hover:text-response"
          >
            New recording
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
          <div className="border-b border-line px-3 py-2 text-[11px] uppercase tracking-wide text-muted">
            User turns {groups.length > 0 ? `· ${groups.length}` : ""}{" "}
            {stats.callCount > 0 ? `· ${stats.callCount} calls` : ""}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <GroupedTurns
              groups={groups}
              summaries={summaries}
              selectedId={selectedId}
              selectedGroupId={selectedGroupId}
              onSelectTurn={pinTurn}
              onSelectGroup={(_gid, latestCallId) => pinTurn(latestCallId)}
            />
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-ink">
          {empty ? (
            <SetupCard proxy={proxy} onCopy={copyCmd} copied={copied} />
          ) : (
            <div className="mx-auto max-w-6xl space-y-4 p-4 pb-16">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted">
                    {follow ? "Live recording" : "Pinned call"}
                  </div>
                  <h1 className="text-xl font-semibold">
                    {formatTokens(stats.billedTokens)}{" "}
                    <span className="text-muted">billed across {stats.callCount} calls</span>
                    <span className="mx-2 text-muted/50">·</span>
                    {formatTokens(stats.latestTokens)}{" "}
                    <span className="text-muted">latest window</span>
                  </h1>
                </div>
                <div className="text-right font-mono text-[11px] text-muted">
                  {selected?.model ?? summaries[0]?.model}
                  <div>
                    {stats.userTurnCount} user turns · {stats.callCount} calls
                  </div>
                </div>
              </div>

              <nav className="flex flex-wrap gap-1 border-b border-line pb-px">
                <TabBtn
                  active={tab === "session"}
                  onClick={() => setTab("session")}
                  label="Session"
                />
                <TabBtn
                  active={tab === "call"}
                  onClick={() => setTab("call")}
                  label="This call"
                  count={selected ? formatTokens(selected.totals.total) : undefined}
                />
                <TabBtn
                  active={tab === "diff"}
                  onClick={() => setTab("diff")}
                  label="Diff"
                />
                {SECTIONS.map((s) => (
                  <TabBtn
                    key={s.id}
                    active={tab === s.id}
                    onClick={() => setTab(s.id)}
                    label={s.short}
                    count={selected ? formatTokens(selected.totals[s.id]) : undefined}
                    color={SECTION_COLOR[s.id]}
                  />
                ))}
                <TabBtn active={tab === "raw"} onClick={() => setTab("raw")} label="Raw JSON" />
              </nav>

              {tab === "session" && (
                <SessionOverview
                  stats={stats}
                  selectedId={selectedId}
                  onSelectTurn={pinTurn}
                />
              )}

              {tab === "call" && selected && (
                <div className="space-y-4">
                  <StackedBar totals={selected.totals} onPick={(id) => setTab(id)} />
                  <MetaLine turn={selected} />
                  <StatCards
                    totals={selected.totals}
                    active="overview"
                    onPick={(id) => setTab(id)}
                  />
                  <p className="text-sm leading-relaxed text-muted">
                    Microscope on one request. Native tools and MCP are split so you can see which
                    integration is the hog —{" "}
                    <code className="font-mono text-text/80">/context</code> lumps them together.
                  </p>
                  <Offenders turn={selected} onOpenTool={() => setTab("tools")} />
                </div>
              )}
              {tab === "call" && !selected && (
                <p className="text-sm text-muted">Loading this call…</p>
              )}

              {tab === "diff" && <DiffPane diff={diff} emptyReason={diffEmpty} />}
              {tab === "system" && selected && <PromptPane slices={selected.systemSlices} />}
              {tab === "tools" && selected && (
                <ToolsPane
                  tools={selected.tools}
                  accent={SECTION_COLOR.tools}
                  empty="No native tools in this request."
                />
              )}
              {tab === "mcp" && selected && (
                <ToolsPane
                  tools={selected.mcpTools}
                  accent={SECTION_COLOR.mcp}
                  empty="No MCP tools in this request. If you expected some, they may be named without a server__ prefix — check Native tools."
                />
              )}
              {tab === "skills" && selected && <SkillsPane skills={selected.skills} />}
              {tab === "messages" && selected && <MessagesPane messages={selected.messages} />}
              {tab === "response" && selected && <ResponsePane turn={selected} />}
              {tab === "raw" && selected && <RawPane raw={selected.rawRequest} />}
              {tab !== "session" && tab !== "diff" && tab !== "call" && !selected && (
                <p className="text-sm text-muted">Loading this call…</p>
              )}
            </div>
          )}
        </main>
      </div>
      <TrafficStrip events={traffic} />
    </div>
  );
}

function newestId(summaries: TurnSummary[]): string | null {
  if (summaries.length === 0) return null;
  return chronologicalLast(summaries).id;
}

function chronologicalLast(summaries: TurnSummary[]): TurnSummary {
  return summaries.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1)!;
}

function TabBtn({
  active,
  onClick,
  label,
  count,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${
        active
          ? "border-current text-text"
          : "border-transparent text-muted hover:text-text"
      }`}
      style={active && color ? { color, borderColor: color } : undefined}
    >
      {label}
      {count && count !== "0" && (
        <span className="font-mono text-[10px] opacity-70">{count}</span>
      )}
    </button>
  );
}

function BarMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#14181f" />
      <rect x="5" y="18" width="4" height="9" rx="1" fill="#5b9fd4" />
      <rect x="11" y="8" width="4" height="19" rx="1" fill="#e6a23c" />
      <rect x="17" y="13" width="4" height="14" rx="1" fill="#a78bfa" />
      <rect x="23" y="16" width="4" height="11" rx="1" fill="#4ade80" />
    </svg>
  );
}
