"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyRowDto, IntradayPointDto, PositionPnlDto, PositionSummaryDto } from "@/lib/pnl/types";
import { bookedOf, DAY_RANGES, type DayRange, feeTier, inDayRange, pairLabel, price, priceRange, usd, usdCompact } from "@/lib/format";
import { api } from "./api";
import {
  DailyLinesChart,
  DailyPnlChart,
  Legend,
  type SeriesDef,
  intradaySeriesData,
  timeOfDay,
} from "./charts";
import { DailyTable } from "./DailyTable";
import { DayPnlCharts } from "./DayPnlCharts";
import { LivePanel } from "./LivePanel";
import { Progress } from "./Progress";
import { dailyComponents, incomeLabel } from "@/lib/protocol";

const CUMULATIVE: SeriesDef[] = [
  { key: "realised", label: "Realised", color: "var(--series-1)" },
  { key: "unrealised", label: "Unrealised", color: "var(--series-2)" },
  { key: "totalPnl", label: "Total P&L", color: "var(--series-3)" },
];
const POSITION_HODL: SeriesDef[] = [
  { key: "position", label: "Position value", color: "var(--series-1)" },
  { key: "hodl", label: "HODL value (deposit held)", color: "var(--series-2)" },
];

function Tile({ label, value, tone, sub }: { label: string; value: string; tone?: "pos" | "neg"; sub?: React.ReactNode }) {
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

function PositionHeader({ summary, lastSnapshotAt }: { summary: PositionSummaryDto; lastSnapshotAt?: string }) {
  const snapshot = lastSnapshotAt && <> · last snapshot {new Date(lastSnapshotAt).toLocaleString()}</>;
  if (summary.compound) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {summary.compound.name} supply{" "}
          <span className="font-mono text-sm font-normal text-muted">{summary.compound.comet}</span>
        </h2>
        <p className="tnum text-xs text-muted">Supplying {summary.compound.baseSymbol} for interest{snapshot}</p>
      </div>
    );
  }
  if (!summary.pool || summary.tickLower === null || summary.tickUpper === null) return null;
  const { base, quote } = pairLabel(summary.pool);
  const [lo, hi] = priceRange(summary.pool, summary.tickLower, summary.tickUpper);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold">
        {base} / {quote} {feeTier(summary.pool.fee)}{" "}
        <span className="font-mono text-sm font-normal text-muted">#{summary.tokenId}</span>
      </h2>
      <p className="tnum text-xs text-muted">
        Range {price(lo)} – {price(hi)} {quote}
        {snapshot}
      </p>
    </div>
  );
}

/** One card holding two signed figures, e.g. realised and unrealised. */
function SplitTile({ label, rows }: { label: string; rows: [string, number][] }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs text-ink-2">{label}</p>
      <dl className="tnum mt-1 space-y-0.5">
        {rows.map(([name, v]) => (
          <div key={name} className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-muted">{name}</dt>
            <dd className={`font-semibold ${tone(v) === "pos" ? "text-positive" : tone(v) === "neg" ? "text-negative" : ""}`}>
              {usd(v, true)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function RangePicker({ value, onChange }: { value: DayRange; onChange: (r: DayRange) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs text-ink-2">Days shown</span>
      <div className="inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="Days shown">
        {DAY_RANGES.map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={value === r}
            onClick={() => onChange(r)}
            className={`rounded px-3 py-1 ${value === r ? "bg-surface-2 font-medium" : "text-ink-2"}`}
          >
            {r === "all" ? "All" : `${r}d`}
          </button>
        ))}
      </div>
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
    "date", "openingNav", "closingNav", "feeIncome", "gasCost", "feeReval", "priceEffect", "ilChange", "rewardIncome", "rewardReval",
    "capitalIn", "capitalOut", "pnlBooked", "pnl",
    "feeRevalToRealised", "priceEffectToRealised", "ilToRealised",
    "cumRealisedFeeIncome", "cumRealisedGas", "cumRealisedFeeReval", "cumRealisedPriceEffect", "cumRealisedIl", "cumRealised",
    "cumUnrealisedPriceEffect", "cumUnrealisedIl", "cumUnrealisedFeeReval", "cumUnrealised", "totalPnl",
    "positionValue", "hodlValue", "heldFeesValue", "costBasis", "checksOk",
  ];
  const lines = rows.map((r) =>
    [
      r.date, r.openingNav, r.closingNav, r.daily.feeIncome, r.daily.gasCost, r.daily.feeReval, r.daily.priceEffect, r.daily.ilChange,
      r.daily.rewardIncome, r.daily.rewardReval,
      r.daily.capitalIn, r.daily.capitalOut, bookedOf(r).total, r.daily.pnl,
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
  const [range, setRange] = useState<DayRange>(15);
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
  const rangeRows = useMemo(() => rows.filter((r) => inDayRange(r.date, range)), [rows, range]);
  const day = selectedDate ?? rows[rows.length - 1]?.date ?? null;
  const lastSnapshotAt = data?.position.latest?.timestamp;

  // The worker no longer takes 2-minute POLL snapshots, so a day's points are its liquidity events
  // and its day-end snapshot (plus any POLL snapshots stored before they were disabled).
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

  const isCompound = summary.protocol === "COMPOUND_V3";
  const components = dailyComponents(summary.protocol);
  const income = incomeLabel(summary.protocol);
  const last = rows[rows.length - 1];
  const dayRow = rows.find((r) => r.date === day) ?? null;
  // Price effect is a hold-the-deposit benchmark; IL takes back what the range didn't capture.
  // Their sum is what the liquidity itself gained or lost.
  const pricePnl = last ? last.cumulative.realised.priceEffect + last.cumulative.unrealised.priceEffect : 0;
  const positionalPnl = last ? last.cumulative.realised.il + last.cumulative.unrealised.il : 0;
  const positionPnl = pricePnl + positionalPnl;
  const feeRevalPnl = last ? last.cumulative.realised.feeReval + last.cumulative.unrealised.feeReval : 0;
  const rewardRevalPnl = last ? last.cumulative.realised.rewardReval + last.cumulative.unrealised.rewardReval : 0;
  const bookedToDate = rows.filter((r) => !day || r.date <= day).reduce((sum, r) => sum + bookedOf(r).total, 0);
  const dayBooked = dayRow ? bookedOf(dayRow) : null;

  return (
    <div className="space-y-4">
      <PositionHeader summary={summary} lastSnapshotAt={lastSnapshotAt} />

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
          <LivePanel summary={summary} />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">Day-based charts show every UTC day in the range, including days without liquidity.</p>
            <RangePicker value={range} onChange={setRange} />
          </div>

          <Card
            title="Daily P&L by component"
            subtitle="One bar per day: gains stack above zero, losses below; the label is the day's net P&L. (R) realised · (U) unrealised. Hover for the breakdown, click a day for its summary and intraday detail."
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
                  ...(includePriceEffect ? components : components.slice(1)),
                  { key: "net", label: "Daily P&L (net)", color: "var(--text-primary)" },
                ]}
              />
            </div>
            <DailyPnlChart
              rows={rangeRows}
              components={components}
              includePriceEffect={includePriceEffect}
              selectedDate={day}
              onSelectDate={setSelectedDate}
            />
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label="NAV" value={usd(last.closingNav)} sub={`net capital in ${usd(last.cumulative.netCapital)}`} />
            <Tile label="Total P&L" value={usd(last.cumulative.totalPnl, true)} tone={tone(last.cumulative.totalPnl)} />
            <Tile
              label="Total P&L excl. price effect"
              value={usd(last.cumulative.totalPnl - pricePnl, true)}
              tone={tone(last.cumulative.totalPnl - pricePnl)}
              sub={`total ${usd(last.cumulative.totalPnl, true)} − price effect ${usd(pricePnl, true)}`}
            />
            <SplitTile
              label="Realised / unrealised"
              rows={[
                ["Realised", last.cumulative.realised.total],
                ["Realised excl. price", last.cumulative.realised.total - last.cumulative.realised.priceEffect],
                ["Unrealised", last.cumulative.unrealised.total],
                ["Unrealised excl. price", last.cumulative.unrealised.total - last.cumulative.unrealised.priceEffect],
              ]}
            />
            <Tile
              label={`Total ${income.toLowerCase()} income`}
              value={usd(last.cumulative.realised.feeIncome, true)}
              tone={tone(last.cumulative.realised.feeIncome)}
            />
            {isCompound && (
              <Tile
                label="COMP income"
                value={usd(last.cumulative.realised.rewardIncome, true)}
                tone={tone(last.cumulative.realised.rewardIncome)}
              />
            )}
            <Tile label="Total gas" value={usd(last.cumulative.realised.gasCost, true)} tone={tone(last.cumulative.realised.gasCost)} />
            <Tile
              label={`${income} revaluation`}
              value={usd(feeRevalPnl, true)}
              tone={tone(feeRevalPnl)}
              sub={`realised ${usd(last.cumulative.realised.feeReval, true)} · unrealised ${usd(last.cumulative.unrealised.feeReval, true)}`}
            />
            {isCompound ? (
              <Tile
                label="Price effect"
                value={usd(pricePnl, true)}
                tone={tone(pricePnl)}
                sub={
                  <>
                    <span className="block">on the ETH supplied · no IL</span>
                    <span className="block">COMP revaluation {usd(rewardRevalPnl, true)}</span>
                  </>
                }
              />
            ) : (
              <Tile
                label="Positional P&L"
                value={usd(positionPnl, true)}
                tone={tone(positionPnl)}
                sub={
                  <>
                    <span className="block">price effect {usd(pricePnl, true)}</span>
                    <span className="block">IL {usd(positionalPnl, true)}</span>
                  </>
                }
              />
            )}
            {data?.direct && (
              <Tile
                label="Position P&L (direct)"
                value={usd(data.direct.pnl, true)}
                tone={tone(data.direct.pnl)}
                sub={`withdrawn ${usdCompact(data.direct.withdrawn)} + value now ${usdCompact(data.direct.currentValue)} − deposited ${usdCompact(data.direct.deposited)}`}
              />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Cumulative P&L" subtitle="Realised + unrealised = total">
              <div className="mb-2">
                <Legend series={CUMULATIVE} />
              </div>
              <DailyLinesChart
                zeroLine
                series={CUMULATIVE}
                data={rangeRows.map((r) => ({
                  date: r.date,
                  realised: r.cumulative.realised.total,
                  unrealised: r.cumulative.unrealised.total,
                  totalPnl: r.cumulative.totalPnl,
                }))}
              />
            </Card>
            <Card
              title="Position vs HODL"
              subtitle={
                isCompound
                  ? "Supplied balance (incl. interest) against holding the ETH supplied; the gap is the interest earned"
                  : "Liquidity value against holding the deposited tokens; the gap is unrealised IL"
              }
            >
              <div className="mb-2">
                <Legend series={POSITION_HODL} />
              </div>
              <DailyLinesChart
                series={POSITION_HODL}
                data={rangeRows.map((r) => ({ date: r.date, position: r.positionValue, hodl: r.hodlValue }))}
              />
            </Card>
          </div>

          <DayPnlCharts positionId={summary.id} protocol={summary.protocol} range={range} refreshKey={lastSnapshotAt} />

          {dayRow && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">Day summary · {dayRow.date}</h3>
                <p className="text-xs text-ink-2">Click a bar or a table row to pick another day</p>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile
                  label="Capital in"
                  value={usd(dayRow.daily.capitalIn)}
                  sub={isCompound ? "ETH supplied" : "liquidity added (mint / increase)"}
                />
                <Tile
                  label="Withdrawn"
                  value={usd(dayRow.daily.capitalOut)}
                  sub={isCompound ? "ETH withdrawn + COMP claimed" : "principal + fees collected"}
                />
                <Tile
                  label="P&L booked"
                  value={usd(dayBooked!.total, true)}
                  tone={tone(dayBooked!.total)}
                  sub={`${isCompound ? "price" : "position"} ${usd(dayBooked!.position, true)} · ${isCompound ? "interest + COMP" : "fees"} ${usd(dayBooked!.fees, true)} · to date ${usd(bookedToDate, true)}`}
                />
                <Tile
                  label="Day P&L"
                  value={usd(dayRow.daily.pnl, true)}
                  tone={tone(dayRow.daily.pnl)}
                  sub={`incl. gas ${usd(dayRow.daily.gasCost, true)}`}
                />
              </div>
            </section>
          )}

          {day && (
            <Card title={`Intraday · ${day}`} subtitle={`${intraday.length} snapshots: liquidity events and day end (UTC times)`}>
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
            <DailyTable rows={rows} protocol={summary.protocol} selectedDate={day} onSelectDate={setSelectedDate} />
          </Card>
        </>
      )}
    </div>
  );
}
