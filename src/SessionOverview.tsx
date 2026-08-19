import type { JSX } from "react";
import type { SessionStats } from "../server/types";
import { SECTION_COLOR, formatTokens, pct } from "./lib";
import { SessionChart } from "./SessionChart";

export type SessionOverviewProps = {
  stats: SessionStats;
  selectedId: string | null;
  onSelectTurn: (id: string) => void;
};

export function SessionOverview({
  stats,
  selectedId,
  onSelectTurn,
}: SessionOverviewProps): JSX.Element | null {
  if (stats.callCount === 0) return null;

  const barMax = Math.max(stats.fixedTokens, stats.growingTokens, 1);

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-line bg-panel px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-muted">
            Billed this recording
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
            {formatTokens(stats.billedTokens)}
          </div>
          <div className="text-[11px] text-muted">
            {stats.callCount} calls · {stats.userTurnCount} user turns
          </div>
        </div>
        <div className="rounded-md border border-line bg-panel px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-muted">
            Latest call
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
            {formatTokens(stats.latestTokens)}
          </div>
          <div className="text-[11px] text-muted">what /context is looking at</div>
        </div>
      </div>

      {stats.latestTotals && (
        <div className="rounded-md border border-line bg-panel px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-muted">
            Always-on tax vs conversation
          </div>
          <div className="mt-2 space-y-2">
            <TaxRow
              label="Fixed tax"
              value={stats.fixedTokens}
              color={SECTION_COLOR.tools}
              max={barMax}
            />
            <TaxRow
              label="Growing"
              value={stats.growingTokens}
              color={SECTION_COLOR.messages}
              max={barMax}
            />
          </div>
        </div>
      )}

      <div className="rounded-md border border-line bg-panel px-3 py-2.5">
        <SessionChart
          series={stats.series}
          selectedId={selectedId}
          onSelect={onSelectTurn}
        />
      </div>

      <p className="text-[11px] text-muted">
        Tools/MCP/skills should stay flat. Messages should climb until compact. A
        drop with a compaction mark is /compact, not a cheaper agent.
      </p>
    </section>
  );
}

function TaxRow({
  label,
  value,
  color,
  max,
}: {
  label: string;
  value: number;
  color: string;
  max: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-muted">{label}</span>
        <span className="font-mono text-sm tabular-nums" style={{ color }}>
          {formatTokens(value)}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct(value, max)}%`, background: color }}
        />
      </div>
    </div>
  );
}
