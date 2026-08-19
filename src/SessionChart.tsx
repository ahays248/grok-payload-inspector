import { useState, type JSX } from "react";
import type { SectionId, SessionPoint } from "../server/types";
import { SECTION_COLOR, SECTIONS, clock, formatTokens } from "./lib";

/** Bottom → top, matching SECTIONS then leftover. */
const STACK: SectionId[] = [...SECTIONS.map((s) => s.id), "other"];

const PLOT_H = 160;
const PAD_T = 14;
const PAD_B = 6;
const PAD_L = 40;
const PAD_R = 8;
const SVG_H = PLOT_H + PAD_T + PAD_B;
const SVG_W = 640;

export type SessionChartProps = {
  series: SessionPoint[];
  selectedId: string | null;
  onSelect: (turnId: string) => void;
};

export function SessionChart({
  series,
  selectedId,
  onSelect,
}: SessionChartProps): JSX.Element {
  const [hoverId, setHoverId] = useState<string | null>(null);

  if (series.length === 0) return <></>;

  const maxY = Math.max(
    1,
    ...series.map((p) => STACK.reduce((n, id) => n + p.totals[id], 0))
  );
  const n = series.length;
  const inner = SVG_W - PAD_L - PAD_R;
  const gap = n >= 40 ? 1 : n >= 20 ? 2 : n >= 8 ? 3 : 5;
  const maxBar = n <= 4 ? 36 : n <= 10 ? 28 : 22;
  const barW = Math.min(maxBar, Math.max(3, (inner - gap * (n - 1)) / n));
  const groupW = n * barW + (n - 1) * gap;
  const originX = PAD_L + (inner - groupW) / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const hover = series.find((p) => p.turnId === hoverId) ?? null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height={SVG_H}
        className="block overflow-visible"
        role="img"
        aria-label="Tokens per API call, stacked by section"
      >
        {ticks.map((t) => {
          const y = PAD_T + PLOT_H * (1 - t);
          return (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={SVG_W - PAD_R}
                y1={y}
                y2={y}
                className="stroke-line"
                strokeWidth={1}
                opacity={t === 0 ? 0.9 : 0.45}
              />
              {(t === 0 || t === 0.5 || t === 1) && (
                <text
                  x={PAD_L - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-muted font-mono"
                  fontSize={9}
                >
                  {formatTokens(Math.round(maxY * t))}
                </text>
              )}
            </g>
          );
        })}

        {series.map((p, i) => {
          const x = originX + i * (barW + gap);
          const cx = x + barW / 2;
          const selected = p.turnId === selectedId;
          const hovered = p.turnId === hoverId;
          let y = PAD_T + PLOT_H;
          const rects: { id: SectionId; y: number; h: number }[] = [];
          for (const id of STACK) {
            const tokens = p.totals[id];
            if (tokens <= 0) continue;
            const h = (tokens / maxY) * PLOT_H;
            y -= h;
            rects.push({ id, y, h });
          }
          const topY = rects.length ? rects[rects.length - 1].y : PAD_T + PLOT_H;
          const stackH = PAD_T + PLOT_H - topY;
          const title = tooltipText(p);

          return (
            <g
              key={p.turnId}
              role="button"
              tabIndex={0}
              className="cursor-pointer"
              opacity={selected ? 1 : hovered ? 0.92 : 0.72}
              onClick={() => onSelect(p.turnId)}
              onMouseEnter={() => setHoverId(p.turnId)}
              onMouseLeave={() => setHoverId(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p.turnId);
                }
              }}
            >
              <title>{title}</title>
              <rect
                x={x - gap / 2}
                y={PAD_T}
                width={barW + gap}
                height={PLOT_H}
                fill="transparent"
              />
              {rects.map((r) => (
                <rect
                  key={r.id}
                  x={x}
                  y={r.y}
                  width={barW}
                  height={Math.max(r.h, 0.5)}
                  fill={SECTION_COLOR[r.id]}
                />
              ))}
              {selected && (
                <rect
                  x={x - 0.75}
                  y={topY - 0.75}
                  width={barW + 1.5}
                  height={Math.max(stackH, 1) + 1.5}
                  fill="none"
                  stroke="#e8edf5"
                  strokeWidth={1.25}
                  rx={1}
                />
              )}
              {p.compacted && (
                <>
                  <line
                    x1={cx}
                    y1={2}
                    x2={cx}
                    y2={PAD_T - 1}
                    stroke="#8b95a8"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                  <polyline
                    points={`${cx - 3.5},${PAD_T - 8} ${cx},${PAD_T - 2} ${cx + 3.5},${PAD_T - 8}`}
                    fill="none"
                    stroke="#e8edf5"
                    strokeWidth={1.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              )}
            </g>
          );
        })}
      </svg>

      {hover && (
        <div className="pointer-events-none absolute top-1 right-2 max-w-[72%] rounded-md border border-line bg-panel-2/95 px-2 py-1.5 font-mono text-[10px] leading-snug text-text">
          <div className="flex items-baseline justify-between gap-3">
            <span>
              {clock(hover.timestamp)}
              {hover.compacted ? " · compact" : ""}
            </span>
            <span className="text-muted">
              billed Σ {formatTokens(hover.billedCumulative)}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
            {STACK.map((id) => (
              <span key={id}>
                <span style={{ color: SECTION_COLOR[id] }}>{id}</span>{" "}
                {formatTokens(hover.totals[id])}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
        {STACK.map((id) => (
          <span key={id} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-sm"
              style={{ background: SECTION_COLOR[id] }}
            />
            {id === "other" ? "Other" : SECTIONS.find((s) => s.id === id)?.short}
          </span>
        ))}
      </div>
    </div>
  );
}

function tooltipText(p: SessionPoint): string {
  const lines = [
    clock(p.timestamp) + (p.compacted ? " · compact" : ""),
    ...STACK.map((id) => `${id} ${formatTokens(p.totals[id])}`),
    `billed Σ ${formatTokens(p.billedCumulative)}`,
  ];
  return lines.join("\n");
}
