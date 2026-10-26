"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayPnlDto } from "@/lib/pnl/types";
import { type DayRange, inDayRange, isIdleDay, usd, usdCompact } from "@/lib/format";
import { api } from "./api";
import { IdleTip } from "./charts";

const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--text-muted)", fontSize: 11 },
  tickLine: false,
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const utcTime = (iso: string) => `${shortDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;

const COMPONENTS: [keyof DayPnlDto["components"], string][] = [
  ["priceEffect", "Price effect"],
  ["positionalChange", "IL change"],
  ["feeIncome", "Fee income"],
  ["feeReval", "Fee revaluation"],
  ["gasCost", "Gas"],
];

function Card({ title, subtitle, actions, children }: { title: string; subtitle: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-xs text-ink-2">{subtitle}</p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function DayTooltip({ d }: { d: DayPnlDto }) {
  return (
    <div className="min-w-56 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-ink">{shortDate(d.date)}</p>
      <p className="mb-1 text-muted">
        {d.openAt ? utcTime(d.openAt) : "mint"} → {utcTime(d.closeAt)} UTC
      </p>
      <table className="tnum w-full">
        <tbody>
          <tr>
            <td className="py-0.5 pr-3 text-ink-2">Total P&amp;L at open</td>
            <td className="py-0.5 text-right">{usd(d.openTotalPnl, true)}</td>
          </tr>
          <tr>
            <td className="py-0.5 pr-3 text-ink-2">Total P&amp;L at close</td>
            <td className="py-0.5 text-right">{usd(d.closeTotalPnl, true)}</td>
          </tr>
          <tr className="border-t border-line font-medium">
            <td className="py-0.5 pr-3">Day P&amp;L</td>
            <td className="py-0.5 text-right">{usd(d.pnl, true)}</td>
          </tr>
          {COMPONENTS.map(([key, label]) => (
            <tr key={key}>
              <td className="py-0.5 pl-2 pr-3 text-muted">{label}</td>
              <td className="py-0.5 text-right text-ink-2">{usd(d.components[key], true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const isIdle = (d: DayPnlDto) => isIdleDay(d.components);

/**
 * Two charts built from each day's opening and closing snapshot only (opening = previous day's
 * close): day-by-day P&L bars, and cumulative total P&L at each day's close.
 */
export function DayPnlCharts({ positionId, range, refreshKey }: { positionId: string; range: DayRange; refreshKey?: string }) {
  const [days, setDays] = useState<DayPnlDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<DayPnlDto[]>(`/api/positions/${positionId}/day-pnl`).then(
      (d) => alive && (setDays(d), setError(null)),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [positionId, refreshKey]);

  if (error) return <p className="text-sm text-negative">✕ {error}</p>;
  if (!days.length) return null;

  const shown = days
    .filter((d) => inDayRange(d.date, range))
    .map((d) => ({ ...d, idle: isIdle(d), label: isIdle(d) ? "no liq." : usdCompact(d.pnl) }));
  const labelBars = shown.length <= 31;
  const latest = days[days.length - 1];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="Day P&L (open → close snapshot)"
        subtitle="Each bar is the day's closing snapshot minus its opening snapshot (the previous day's close). Blue = gain, red = loss; “no liq.” = position held no tokens."
      >
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={shown} margin={{ top: labelBars ? 20 : 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps} />
              <YAxis tickFormatter={usdCompact} width={56} axisLine={false} {...axisProps} />
              <ReferenceLine y={0} stroke="var(--axis)" />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as DayPnlDto & { idle: boolean };
                  return d.idle ? <IdleTip title={shortDate(d.date)} /> : <DayTooltip d={d} />;
                }}
              />
              <Bar dataKey="pnl" maxBarSize={24} isAnimationActive={false}>
                {shown.map((d) => (
                  <Cell key={d.date} fill={d.pnl >= 0 ? "var(--gain)" : "var(--loss)"} />
                ))}
                {labelBars && (
                  <LabelList
                    dataKey="label"
                    position="top"
                    style={{ fill: "var(--text-secondary)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}
                  />
                )}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card
        title="Cumulative P&L (at each day's close)"
        subtitle={`Total P&L in the closing snapshot of every day · now ${usd(latest.cumulative.total, true)}`}
      >
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <AreaChart data={shown} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={32} {...axisProps} />
              <YAxis tickFormatter={usdCompact} width={56} axisLine={false} {...axisProps} />
              <ReferenceLine y={0} stroke="var(--axis)" />
              <Tooltip
                cursor={{ stroke: "var(--axis)" }}
                content={({ active, payload }) =>
                  active && payload?.length ? <DayTooltip d={payload[0].payload as DayPnlDto} /> : null
                }
              />
              <Area
                type="linear"
                dataKey="cumulative.total"
                stroke="var(--series-1)"
                strokeWidth={2}
                fill="var(--series-1)"
                fillOpacity={0.1}
                dot={shown.length <= 31 ? { r: 4, fill: "var(--series-1)", stroke: "var(--surface-1)", strokeWidth: 2 } : false}
                activeDot={{ r: 5, fill: "var(--series-1)", stroke: "var(--surface-1)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
