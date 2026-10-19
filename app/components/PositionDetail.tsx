"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyRowDto, IntradayPointDto, PositionPnlDto, PositionSummaryDto } from "@/lib/pnl/types";
import { feeTier, pairLabel, price, priceRange, usd } from "@/lib/format";
import { api } from "./api";
import {
  DailyLinesChart,
  DailyPnlChart,
  Legend,
  PNL_COMPONENTS,
  type SeriesDef,
  intradaySeriesData,
  timeOfDay,
} from "./charts";
import { DailyTable } from "./DailyTable";
import { Progress } from "./Progress";

const CUMULATIVE: SeriesDef[] = [
  { key: "realised", label: "Realised", color: "var(--series-1)" },
  { key: "unrealised", label: "Unrealised", color: "var(--series-2)" },
  { key: "totalPnl", label: "Total P&L", color: "var(--series-3)" },
];
const POSITION_HODL: SeriesDef[] = [
  { key: "position", label: "Position value", color: "var(--series-1)" },
  { key: "hodl", label: "HODL value (deposit held)", color: "var(--series-2)" },
];

function Tile({ label, value, tone, sub }: { label: string; value: string; tone?: "pos" | "neg"; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs text-ink-2">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === "pos" ? "text-positive" : tone === "neg" ? "text-negative" : ""}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

const tone = (v: number) => (v >= 0.005 ? "pos" : v <= -0.005 ? "neg" : undefined);

function Card({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{title}</h3>
          {subtitle && <p className="text-xs text-ink-2">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: DailyRowDto[]): string {
  const header = [
    "date", "openingNav", "closingNav", "feeIncome", "gasCost", "feeReval", "priceEffect", "ilChange", "capitalIn", "capitalOut", "pnl",
    "feeRevalToRealised", "priceEffectToRealised", "ilToRealised",
    "cumRealisedFeeIncome", "cumRealisedGas", "cumRealisedFeeReval", "cumRealisedPriceEffect", "cumRealisedIl", "cumRealised",
    "cumUnrealisedPriceEffect", "cumUnrealisedIl", "cumUnrealisedFeeReval", "cumUnrealised", "totalPnl",
    "positionValue", "hodlValue", "heldFeesValue", "costBasis", "checksOk",
  ];
  const lines = rows.map((r) =>
    [
      r.date, r.openingNav, r.closingNav, r.daily.feeIncome, r.daily.gasCost, r.daily.feeReval, r.daily.priceEffect, r.daily.ilChange,
      r.daily.capitalIn, r.daily.capitalOut, r.daily.pnl,
      r.reclassified.feeRevalToRealised, r.reclassified.priceEffectToRealised, r.reclassified.ilToRealised,
      r.cumulative.realised.feeIncome, r.cumulative.realised.gasCost, r.cumulative.realised.feeReval, r.cumulative.realised.priceEffect,
      r.cumulative.realised.il, r.cumulative.realised.total,
      r.cumulative.unrealised.priceEffect, r.cumulative.unrealised.il, r.cumulative.unrealised.feeReval, r.cumulative.unrealised.total,
      r.cumulative.totalPnl, r.positionValue, r.hodlValue, r.heldFeesValue, r.costBasis, r.checksOk,
    ].join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function PositionDetail({ summary }: { summary: PositionSummaryDto }) {
  const [data, setData] = useState<PositionPnlDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includePriceEffect, setIncludePriceEffect] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [intraday, setIntraday] = useState<IntradayPointDto[]>([]);

  const backfilling = summary.status === "BACKFILLING" || summary.progress !== null;
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<PositionPnlDto>(`/api/positions/${summary.id}/pnl`).then(
        (d) => alive && (setData(d), setError(null)),
        (e: Error) => alive && setError(e.message),
      );
    load();
    const t = setInterval(load, backfilling ? 5_000 : 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [summary.id, backfilling]);

  const rows = useMemo(() => data?.daily ?? [], [data]);
  const day = selectedDate ?? rows[rows.length - 1]?.date ?? null;
  const lastSnapshotAt = data?.position.latest?.timestamp;

  useEffect(() => {
    if (!day) return;
    let alive = true;
    api<IntradayPointDto[]>(`/api/positions/${summary.id}/snapshots?date=${day}`).then(
      (p) => alive && setIntraday(p),
      () => alive && setIntraday([]),
    );
    return () => {
      alive = false;
    };
  }, [summary.id, day, lastSnapshotAt]);

  const { base, quote } = pairLabel(summary.pool);
  const [lo, hi] = priceRange(summary.pool, summary.tickLower, summary.tickUpper);
  const last = rows[rows.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {base} / {quote} {feeTier(summary.pool.fee)} <span className="font-mono text-sm font-normal text-muted">#{summary.tokenId}</span>
        </h2>
        <p className="tnum text-xs text-muted">
          Range {price(lo)} – {price(hi)} {quote}
          {lastSnapshotAt && <> · last snapshot {new Date(lastSnapshotAt).toLocaleString()}</>}
        </p>
      </div>

      {error && <p className="text-sm text-negative">✕ {error}</p>}

      {(data?.position ?? summary).status === "BACKFILLING" && (
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="mb-2 text-sm font-medium">◔ Backfilling history from the mint block</p>
          <Progress progress={(data?.position ?? summary).progress} upTo={last?.date} />
          <p className="mt-2 text-xs text-muted">Days that are already processed appear below and are final.</p>
        </div>
      )}

      {!last ? (
        summary.status !== "BACKFILLING" && (
          <div className="rounded-lg border border-line bg-surface p-6 text-sm text-ink-2">
            No snapshots yet. Track this position to start.
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Tile label="NAV" value={usd(last.closingNav)} sub={`net deposited ${usd(last.cumulative.netCapital)}`} />
            <Tile label="Total P&L" value={usd(last.cumulative.totalPnl, true)} tone={tone(last.cumulative.totalPnl)} />
            <Tile label="Realised" value={usd(last.cumulative.realised.total, true)} tone={tone(last.cumulative.realised.total)} />
            <Tile label="Unrealised" value={usd(last.cumulative.unrealised.total, true)} tone={tone(last.cumulative.unrealised.total)} />
            <Tile label="Fees earned" value={usd(last.cumulative.realised.feeIncome, true)} tone={tone(last.cumulative.realised.feeIncome)} />
            <Tile
              label="Impermanent loss"
              value={usd(last.cumulative.realised.il + last.cumulative.unrealised.il, true)}
              tone={tone(last.cumulative.realised.il + last.cumulative.unrealised.il)}
              sub={`unrealised ${usd(last.cumulative.unrealised.il, true)}`}
            />
            <Tile label="Gas" value={usd(last.cumulative.realised.gasCost, true)} tone={tone(last.cumulative.realised.gasCost)} />
          </div>

          <Card
            title="Daily P&L by component"
            subtitle="Stacked bars split each day's P&L into its components; the line is the day's net. (R) realised · (U) unrealised. Click a day for its intraday detail."
            actions={
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <input type="checkbox" checked={includePriceEffect} onChange={(e) => setIncludePriceEffect(e.target.checked)} />
                Include price effect
              </label>
            }
          >
            <div className="mb-2">
              <Legend
                series={[
                  ...(includePriceEffect ? PNL_COMPONENTS : PNL_COMPONENTS.slice(1)),
                  { key: "net", label: "Daily P&L (net)", color: "var(--text-primary)" },
                ]}
              />
            </div>
            <DailyPnlChart rows={rows} includePriceEffect={includePriceEffect} selectedDate={day} onSelectDate={setSelectedDate} />
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Cumulative P&L" subtitle="Realised + unrealised = total">
              <div className="mb-2">
                <Legend series={CUMULATIVE} />
              </div>
              <DailyLinesChart
                zeroLine
                series={CUMULATIVE}
                data={rows.map((r) => ({
                  date: r.date,
                  realised: r.cumulative.realised.total,
                  unrealised: r.cumulative.unrealised.total,
                  totalPnl: r.cumulative.totalPnl,
                }))}
              />
            </Card>
            <Card title="Position vs HODL" subtitle="Liquidity value against holding the deposited tokens; the gap is unrealised IL">
              <div className="mb-2">
                <Legend series={POSITION_HODL} />
              </div>
              <DailyLinesChart
                series={POSITION_HODL}
                data={rows.map((r) => ({ date: r.date, position: r.positionValue, hodl: r.hodlValue }))}
              />
            </Card>
          </div>

          {day && (
            <Card title={`Intraday · ${day}`} subtitle={`${intraday.length} snapshots (UTC times)`}>
              <div className="mb-2">
                <Legend series={CUMULATIVE} />
              </div>
              <DailyLinesChart
                zeroLine
                series={CUMULATIVE}
                xKey="timestamp"
                xFormatter={timeOfDay}
                data={intradaySeriesData(intraday)}
              />
            </Card>
          )}

          <Card
            title="Day-wise P&L"
            actions={
              <div className="flex gap-2 text-sm">
                <button
                  className="rounded-md border border-line px-3 py-1 hover:bg-surface-2"
                  onClick={() => download(`position-${summary.tokenId}-daily.csv`, toCsv(rows), "text/csv")}
                >
                  Export CSV
                </button>
                <button
                  className="rounded-md border border-line px-3 py-1 hover:bg-surface-2"
                  onClick={() => download(`position-${summary.tokenId}-daily.json`, JSON.stringify(rows, null, 2), "application/json")}
                >
                  Export JSON
                </button>
              </div>
            }
          >
            <DailyTable rows={rows} selectedDate={day} onSelectDate={setSelectedDate} />
          </Card>
        </>
      )}
    </div>
  );
}
