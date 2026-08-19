import { useState, type JSX } from "react";
import type { ChatMessage, SectionId, TokenTotals, TurnDiff } from "../server/types";
import { SECTION_COLOR, SECTIONS, formatTokens } from "./lib";

const DELTA_SECTIONS: SectionId[] = ["system", "tools", "mcp", "skills", "messages", "response"];

export function DiffPane(props: {
  diff: TurnDiff | null;
  emptyReason?: string;
}): JSX.Element {
  const { diff, emptyReason } = props;

  if (!diff) {
    return (
      <div className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
        {emptyReason || "This is the first call in the recording — nothing to diff."}
      </div>
    );
  }

  const totalDelta = diff.sectionDeltas.total;
  const driver = largestMove(diff.sectionDeltas);
  const accent = driver ? SECTION_COLOR[driver] : undefined;
  const driverLabel = driver ? SECTIONS.find((s) => s.id === driver)?.short : null;

  const rows = DELTA_SECTIONS.map((id) => ({
    id,
    short: SECTIONS.find((s) => s.id === id)?.short ?? id,
    delta: diff.sectionDeltas[id],
  })).filter((r) => r.delta !== 0);

  const unchangedBits: string[] = [];
  if (diff.unchanged.tools) unchangedBits.push("Native tools");
  if (diff.unchanged.mcp) unchangedBits.push("MCP");
  if (diff.unchanged.skills) unchangedBits.push("skills");
  if (diff.unchanged.system) unchangedBits.push("system prompt");

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted">Since previous call</div>
        <div
          className="mt-1 font-mono text-2xl font-semibold tabular-nums"
          style={{ color: accent ?? undefined }}
        >
          {formatSigned(totalDelta)}
          <span className="ml-2 text-sm font-normal text-muted">tokens</span>
        </div>
        {driver && driverLabel && (
          <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: SECTION_COLOR[driver] }}
            />
            Driven by {driverLabel}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <table className="w-full text-[12px]">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line first:border-t-0">
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-sm"
                      style={{ background: SECTION_COLOR[r.id] }}
                    />
                    {r.short}
                  </span>
                </td>
                <td className="py-1.5 text-right font-mono tabular-nums" style={{ color: SECTION_COLOR[r.id] }}>
                  {formatSigned(r.delta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {unchangedBits.length > 0 && (
        <p className="text-[12px] leading-relaxed text-muted">
          {unchangedBits.join(" / ")} unchanged — collapsed.
        </p>
      )}

      <NameChanges label="Native tools" added={diff.toolsAdded} removed={diff.toolsRemoved} />
      <NameChanges label="MCP" added={diff.mcpAdded} removed={diff.mcpRemoved} />
      <NameChanges label="Skills" added={diff.skillsAdded} removed={diff.skillsRemoved} />

      {diff.messagesAdded.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[11px] uppercase tracking-wide text-muted">
              {diff.messagesAdded.length} new message{diff.messagesAdded.length === 1 ? "" : "s"}
            </h3>
            <span className="font-mono text-[11px] text-muted">
              {diff.prevMessageCount} → {diff.nextMessageCount}
            </span>
          </div>
          {diff.messagesAdded.map((m, i) => (
            <AddedMessage key={`${m.role}-${i}`} message={m} />
          ))}
        </section>
      )}
    </div>
  );
}

function NameChanges({
  label,
  added,
  removed,
}: {
  label: string;
  added: string[];
  removed: string[];
}) {
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <section>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {added.map((n) => (
          <span
            key={`+${n}`}
            className="rounded bg-skills/15 px-1.5 py-0.5 font-mono text-[11px] text-skills"
          >
            + {n}
          </span>
        ))}
        {removed.map((n) => (
          <span
            key={`−${n}`}
            className="rounded bg-response/15 px-1.5 py-0.5 font-mono text-[11px] text-response"
          >
            − {n}
          </span>
        ))}
      </div>
    </section>
  );
}

function AddedMessage({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const text = message.text || "∅";
  const long = text.length > 180;
  const shown = !long || open ? text : `${text.slice(0, 180)}…`;
  return (
    <article className="rounded-md border border-line bg-panel">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-messages">
          {message.role}
          {message.type ? ` · ${message.type}` : ""}
        </span>
        <span className="font-mono text-[11px] text-muted">{formatTokens(message.tokens)}</span>
      </header>
      <pre
        className={`p-3 text-[12px] leading-relaxed whitespace-pre-wrap text-text/90 ${
          long ? "cursor-pointer" : ""
        } ${open ? "max-h-72 overflow-auto" : ""}`}
        onClick={() => long && setOpen((v) => !v)}
        title={long ? (open ? "Click to collapse" : "Click to expand") : undefined}
      >
        {shown}
      </pre>
    </article>
  );
}

function largestMove(deltas: TokenTotals): SectionId | null {
  let best: SectionId | null = null;
  let bestAbs = 0;
  for (const id of DELTA_SECTIONS) {
    const a = Math.abs(deltas[id]);
    if (a > bestAbs) {
      bestAbs = a;
      best = id;
    }
  }
  return best;
}

function formatSigned(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  const sign = n > 0 ? "+" : "−";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000;
    return `${sign}${Number.isInteger(v) ? `${v}M` : `${v.toFixed(1)}M`}`;
  }
  if (abs >= 1000) {
    const v = abs / 1000;
    return `${sign}${Number.isInteger(v) ? `${v}k` : `${v.toFixed(1)}k`}`;
  }
  return `${sign}${Math.round(abs).toLocaleString("en-US")}`;
}
