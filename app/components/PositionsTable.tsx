"use client";

import type { PositionStatus, PositionSummaryDto } from "@/lib/pnl/types";
import { feeTier, num, pairLabel, price, priceRange, shortAddress, usd } from "@/lib/format";
import { Progress } from "./Progress";

interface Props {
  positions: PositionSummaryDto[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onTrack: (id: string, track: boolean) => Promise<void>;
}

const STATUS: Record<PositionStatus, { label: string; icon: string; color: string }> = {
  DISCOVERED: { label: "Not tracked", icon: "○", color: "text-muted" },
  BACKFILLING: { label: "Backfilling", icon: "◔", color: "text-ink-2" },
  TRACKING: { label: "Tracking", icon: "●", color: "text-good" },
  CLOSED: { label: "Closed", icon: "■", color: "text-ink-2" },
  ERROR: { label: "Error", icon: "▲", color: "text-critical" },
};

export function PositionsTable({ positions, selectedId, loading, onSelect, onRefresh, onTrack }: Props) {
  return (
    <section className="mb-6 rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-medium">Positions</h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh from chain"}
        </button>
      </div>

      {positions.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-2">
          {loading ? "Reading positions from chain…" : "No active Uniswap v3 or Compound III positions found. Use “Refresh from chain” to look again."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-normal">Position</th>
                <th className="px-4 py-2 font-normal">Range / balance</th>
                <th className="px-4 py-2 font-normal">Status</th>
                <th className="px-4 py-2 text-right font-normal">NAV</th>
                <th className="px-4 py-2 text-right font-normal">Total P&amp;L</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const st = STATUS[p.status];
                const tracked = ["BACKFILLING", "TRACKING", "ERROR"].includes(p.status);
                const selected = p.id === selectedId;
                return (
                  <tr
                    key={p.id}
                    onClick={() => p.latest && onSelect(p.id)}
                    className={`border-t border-line ${p.latest ? "cursor-pointer hover:bg-surface-2" : ""} ${selected ? "bg-surface-2" : ""}`}
                  >
                    <PositionCells p={p} />
                    <td className="px-4 py-3">
                      <span className={st.color}>
                        {st.icon} {st.label}
                      </span>
                      {(p.status === "BACKFILLING" || p.progress) && (
                        <div className="mt-1">
                          <Progress progress={p.progress} upTo={p.latest?.date} compact />
                        </div>
                      )}
                      {p.lastError && (
                        <div className="max-w-xs truncate text-xs text-critical" title={p.lastError}>
                          {p.lastError}
                        </div>
                      )}
                    </td>
                    <td className="tnum px-4 py-3 text-right">{p.latest ? usd(p.latest.nav) : "—"}</td>
                    <td
                      className={`tnum px-4 py-3 text-right ${p.latest ? (p.latest.totalPnl >= 0 ? "text-positive" : "text-negative") : ""}`}
                    >
                      {p.latest ? usd(p.latest.totalPnl, true) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {p.status !== "CLOSED" && (
                        <button
                          onClick={() => onTrack(p.id, !tracked)}
                          className={`rounded-md px-3 py-1 text-sm ${tracked ? "border border-line hover:bg-surface-2" : "bg-accent font-medium text-white"}`}
                        >
                          {tracked ? "Pause" : "Track"}
                        </button>
                      )}
                      {p.latest && (
                        <button onClick={() => onSelect(p.id)} className="ml-2 rounded-md px-3 py-1 text-sm text-accent hover:underline">
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Name and range (Uniswap v3) or supplied balance (Compound III). */
function PositionCells({ p }: { p: PositionSummaryDto }) {
  if (p.compound) {
    return (
      <>
        <td className="px-4 py-3">
          <div className="font-medium">
            {p.compound.name} <span className="font-normal text-muted">supply</span>
          </div>
          <div className="font-mono text-xs text-muted">{shortAddress(p.compound.comet)}</div>
        </td>
        <td className="tnum px-4 py-3">
          {p.compound.balance !== null ? (
            <div>
              {num(p.compound.balance)} <span className="text-muted">{p.compound.baseSymbol} supplied</span>
            </div>
          ) : (
            <div className="text-muted">—</div>
          )}
          <div className="text-xs text-ink-2">Earning interest</div>
        </td>
      </>
    );
  }
  if (!p.pool || p.tickLower === null || p.tickUpper === null) return <td colSpan={2} className="px-4 py-3">—</td>;
  const { base, quote } = pairLabel(p.pool);
  const [lo, hi] = priceRange(p.pool, p.tickLower, p.tickUpper);
  const inRange =
    p.currentTick !== null ? p.currentTick >= p.tickLower && p.currentTick < p.tickUpper : (p.latest?.inRange ?? null);
  return (
    <>
      <td className="px-4 py-3">
        <div className="font-medium">
          {base} / {quote} <span className="font-normal text-muted">{feeTier(p.pool.fee)}</span>
        </div>
        <div className="font-mono text-xs text-muted">#{p.tokenId}</div>
      </td>
      <td className="tnum px-4 py-3">
        <div>
          {price(lo)} – {price(hi)} <span className="text-muted">{quote}</span>
        </div>
        {inRange !== null && (
          <div className={`text-xs ${inRange ? "text-good" : "text-ink-2"}`}>{inRange ? "✓ In range" : "○ Out of range"}</div>
        )}
      </td>
    </>
  );
}
