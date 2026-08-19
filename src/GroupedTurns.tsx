import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { TurnStatus, TurnSummary, UserTurnGroup } from "../server/types";
import { SECTION_COLOR, barSegments, clock, formatTokens, pct } from "./lib";

export function GroupedTurns(props: {
  groups: UserTurnGroup[];
  summaries: TurnSummary[];
  selectedId: string | null;
  selectedGroupId: string | null;
  onSelectTurn: (id: string) => void;
  onSelectGroup: (groupId: string, latestCallId: string) => void;
}): JSX.Element {
  const { groups, summaries, selectedId, selectedGroupId, onSelectTurn, onSelectGroup } = props;
  const byId = useMemo(() => {
    const m = new Map<string, TurnSummary>();
    for (const s of summaries) m.set(s.id, s);
    return m;
  }, [summaries]);

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  useEffect(() => {
    if (!selectedId) return;
    const gid = groupsRef.current.find((g) => g.callIds.includes(selectedId))?.id;
    if (!gid) return;
    setOverrides((prev) => (prev[gid] === true ? prev : { ...prev, [gid]: true }));
  }, [selectedId]);

  if (groups.length === 0) {
    return (
      <div className="px-3 py-6 text-xs leading-relaxed text-muted">
        No user turns yet. Housekeeping traffic (models, settings) is on the bottom strip — not here.
      </div>
    );
  }

  function isExpanded(group: UserTurnGroup): boolean {
    if (Object.hasOwn(overrides, group.id)) return overrides[group.id];
    if (group.status === "in_flight") return true;
    if (selectedId && group.callIds.includes(selectedId)) return true;
    return false;
  }

  function toggle(group: UserTurnGroup) {
    const next = !isExpanded(group);
    setOverrides((prev) => ({ ...prev, [group.id]: next }));
  }

  function selectGroup(group: UserTurnGroup) {
    const latest = group.callIds[group.callIds.length - 1];
    if (!latest) return;
    setOverrides((prev) => ({ ...prev, [group.id]: true }));
    onSelectGroup(group.id, latest);
  }

  return (
    <div>
      {groups.map((group) => {
        const open = isExpanded(group);
        const preview = (group.preview || group.model || "User turn").replace(/\s+/g, " ").trim();
        const selected = selectedGroupId === group.id;
        const segs = barSegments(group.latestTotals);
        const barTotal = Math.max(group.latestTotals.total, 1);
        return (
          <div key={group.id} className="border-b border-line">
            <div className={`flex px-3 py-2 ${selected ? "bg-panel-2" : "hover:bg-panel-2/60"}`}>
              <button
                type="button"
                aria-label={open ? "Collapse user turn" : "Expand user turn"}
                aria-expanded={open}
                onClick={() => toggle(group)}
                className="-ml-1 mr-1 shrink-0 px-1 text-[10px] text-muted hover:text-text"
              >
                {open ? "▾" : "▸"}
              </button>
              <button
                type="button"
                onClick={() => selectGroup(group)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px]" title={preview}>
                    {preview}
                  </span>
                  <StatusDot status={group.status} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
                  <span>
                    {group.callCount} calls · {formatTokens(group.billedTokens)} billed
                  </span>
                  <span className="text-text/80">{formatTokens(group.latestTokens)}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink">
                  <div className="flex h-full w-full">
                    {segs.map((s) => (
                      <span
                        key={s.id}
                        style={{
                          width: `${pct(s.tokens, barTotal)}%`,
                          background: SECTION_COLOR[s.id],
                        }}
                      />
                    ))}
                  </div>
                </div>
              </button>
            </div>
            {open && (
              <div className="bg-ink">
                {group.callIds.map((id, i) => {
                  const summary = byId.get(id);
                  if (!summary) return null;
                  const childSelected = selectedId === id;
                  const n = i + 1;
                  const nTotal = group.callIds.length;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelectTurn(id)}
                      className={`flex w-full items-center gap-2 border-t border-line px-3 py-1.5 pl-7 text-left ${
                        childSelected ? "bg-panel-2" : "hover:bg-panel-2/60"
                      }`}
                    >
                      <span className="w-8 shrink-0 font-mono text-[10px] text-muted">
                        {n}/{nTotal}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">
                        {clock(summary.timestamp)}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-text/80">
                        {formatTokens(summary.totals.total)}
                      </span>
                      <StatusDot status={summary.status} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusDot({ status }: { status: TurnStatus }) {
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        status === "in_flight"
          ? "live-dot bg-tools"
          : status === "error"
            ? "bg-response"
            : "bg-skills"
      }`}
    />
  );
}
