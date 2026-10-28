"use client";

import { useEffect, useState } from "react";
import type { LivePnlDto, PnlBreakdownDto, PositionSummaryDto } from "@/lib/pnl/types";
import { num, pairLabel, usd } from "@/lib/format";
import { api } from "./api";

const REFRESH_MS = 60_000;

const toneClass = (v: number) => (v >= 0.005 ? "text-positive" : v <= -0.005 ? "text-negative" : "");

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-page p-3">
      <p className="text-xs text-ink-2">{label}</p>
      {children}
    </div>
  );
}

function Rows({ rows }: { rows: [string, number][] }) {
  return (
    <dl className="tnum mt-1 space-y-0.5 text-xs">
      {rows.map(([name, v]) => (
        <div key={name} className="flex justify-between gap-2">
          <dt className="text-muted">{name}</dt>
          <dd className={toneClass(v)}>{usd(v, true)}</dd>
        </div>
      ))}
    </dl>
  );
}

const components = (b: PnlBreakdownDto, compound: boolean): [string, number][] =>
  compound
    ? [
        ["Interest income", b.feeIncome],
        ["COMP income", b.rewardIncome],
        ["Interest revaluation", b.feeReval],
        ["COMP revaluation", b.rewardReval],
        ["Price effect", b.priceEffect],
        ["Gas", b.gasCost],
      ]
    : [
        ["Fee income", b.feeIncome],
        ["Fee revaluation", b.feeReval],
        ["Price effect", b.priceEffect],
        ["IL", b.il],
        ["Gas", b.gasCost],
      ];

/** P&L at the chain head, computed on request (not stored) and refreshed every minute. */
export function LivePanel({ summary }: { summary: PositionSummaryDto }) {
  const positionId = summary.id;
  const [live, setLive] = useState<LivePnlDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<LivePnlDto>(`/api/positions/${positionId}/live`).then(
        (d) => alive && (setLive(d), setError(null), setLoading(false)),
        (e: Error) => alive && (setError(e.message), setLoading(false)),
      );
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [positionId]);

  const compound = summary.compound;
  // Uniswap: base/quote from the pool. Compound: the supplied asset is token "0" in the live figures.
  const { base, quote } = summary.pool ? pairLabel(summary.pool) : { base: compound?.baseSymbol ?? "", quote: "" };
  const baseIs0 = summary.pool ? summary.pool.refToken === 1 : true;

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">
          <span className="text-good">●</span> Live
        </h3>
        <p className="text-xs text-muted">
          {live
            ? `as of ${live.asOf.slice(11, 19)} UTC (block ${live.block}) · computed on request, not stored · refreshes every minute`
            : loading
              ? "computing…"
              : ""}
        </p>
      </div>

      {error && <p className="text-sm text-ink-2">○ Live view unavailable: {error}</p>}

      {live && (
        <>
          {(live.status === "DISCOVERED" || live.unrecordedEvents > 0 || live.unrecordedDays > 0) && (
            <p className="mb-3 text-xs text-ink-2">
              {live.status === "DISCOVERED" ? "○ Tracking is paused: these figures are computed live but nothing is saved. " : ""}
              {live.unrecordedEvents > 0 || live.unrecordedDays > 0
                ? `Includes ${live.unrecordedEvents} liquidity event(s) and ${live.unrecordedDays} day end(s) not yet recorded by the worker, so the charts below lag behind.`
                : ""}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Box label={`${base} price`}>
              <p className="mt-1 text-lg font-semibold">{usd(baseIs0 ? live.usd0 : live.usd1)}</p>
              {compound ? (
                <p className="text-xs text-ink-2">Chainlink ETH/USD</p>
              ) : (
                <p className={`text-xs ${live.inRange ? "text-good" : "text-ink-2"}`}>{live.inRange ? "✓ In range" : "○ Out of range"}</p>
              )}
            </Box>
            {compound ? (
              <Box label="Supplied now">
                <p className="mt-1 text-lg font-semibold">{usd(live.positionValue + live.heldFeesValue)}</p>
                <p className="tnum text-xs text-muted">
                  {num(live.amount0, 6)} {compound.baseSymbol}
                  {live.supplyApr !== undefined && <> · APR {(live.supplyApr * 100).toFixed(2)}%</>}
                </p>
                <p className="tnum text-xs text-muted">
                  unclaimed COMP {num(live.heldFees0, 6)} ({usd(live.heldFeesValue)})
                </p>
              </Box>
            ) : (
              <Box label="Position now">
                <p className="mt-1 text-lg font-semibold">{usd(live.positionValue + live.heldFeesValue)}</p>
                <p className="tnum text-xs text-muted">
                  {num(baseIs0 ? live.amount0 : live.amount1)} {base} + {num(baseIs0 ? live.amount1 : live.amount0, 2)} {quote}
                </p>
                <p className="tnum text-xs text-muted">incl. uncollected fees {usd(live.heldFeesValue)}</p>
              </Box>
            )}
            <Box label="Total P&L (live)">
              <p className={`mt-1 text-lg font-semibold ${toneClass(live.totals.total)}`}>{usd(live.totals.total, true)}</p>
              <p className="tnum text-xs text-muted">
                excl. price effect {usd(live.totals.total - live.totals.priceEffect, true)}
              </p>
              <p className="tnum text-xs text-muted">since last snapshot {usd(live.sinceLastSnapshot.total, true)}</p>
            </Box>
            <Box label={`Today so far · ${live.today.date}`}>
              <p className={`mt-1 text-lg font-semibold ${toneClass(live.today.total)}`}>{usd(live.today.total, true)}</p>
              <Rows rows={components(live.today, !!compound)} />
            </Box>
            {compound ? (
              <Box label="Earnings vs price (live)">
                <p className={`mt-1 text-lg font-semibold ${toneClass(live.totals.priceEffect)}`}>
                  {usd(live.totals.priceEffect, true)}
                </p>
                <Rows
                  rows={[
                    ["Interest + COMP", live.totals.feeIncome + live.totals.rewardIncome],
                    ["Revaluation", live.totals.feeReval + live.totals.rewardReval],
                    ["Gas", live.totals.gasCost],
                  ]}
                />
              </Box>
            ) : (
              <Box label="Positional P&L (live)">
                <p className={`mt-1 text-lg font-semibold ${toneClass(live.totals.priceEffect + live.totals.il)}`}>
                  {usd(live.totals.priceEffect + live.totals.il, true)}
                </p>
                <Rows
                  rows={[
                    ["Price effect", live.totals.priceEffect],
                    ["IL", live.totals.il],
                  ]}
                />
              </Box>
            )}
          </div>
          {!live.checksOk && <p className="mt-2 text-xs text-critical">▲ A reconciliation check failed in the live calculation.</p>}
        </>
      )}
    </section>
  );
}
