"use client";

import {
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyRowDto, IntradayPointDto } from "@/lib/pnl/types";
import { isIdleDaily, usd, usdCompact } from "@/lib/format";

// ── Shared chrome ──────────────────────────────────────────────────────────

const axisProps = {
  stroke: "var(--axis)",
  tick: { fill: "var(--text-muted)", fontSize: 11 },
  tickLine: false,
} as const;

const shortDate = (d: string) => {
  const [, m, day] = d.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${Number(day)}`;
};

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export function Legend({ series }: { series: SeriesDef[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

interface TipRow {
  label: string;
  color?: string;
  value: number;
  strong?: boolean;
}

function TipBox({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="min-w-48 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{title}</p>
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.strong ? "border-t border-line font-medium" : ""}>
              <td className="py-0.5 pr-3 text-ink-2">
                {r.color && (
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: r.color }} />
                )}
                {r.label}
              </td>
              <td className="tnum py-0.5 text-right text-ink">{usd(r.value, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IdleTip({ title }: { title: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-ink">{title}</p>
      <p className="text-ink-2">○ No liquidity: the position held no tokens, so P&amp;L is $0.</p>
    </div>
  );
}

// ── Day-wise P&L breakdown (stacked by component, net P&L line) ────────────

export const PNL_COMPONENTS: SeriesDef[] = [
  { key: "priceEffect", label: "Price effect (U)", color: "var(--series-1)" },
  { key: "ilChange", label: "IL change (U)", color: "var(--series-2)" },
  { key: "feeIncome", label: "Fee income (R)", color: "var(--series-3)" },
  { key: "feeReval", label: "Fee revaluation (U)", color: "var(--series-4)" },
  { key: "gasCost", label: "Gas (R)", color: "var(--series-5)" },
];

export function DailyPnlChart({
  rows,
  includePriceEffect,
  selectedDate,
  onSelectDate,
}: {
  rows: DailyRowDto[];
  includePriceEffect: boolean;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const series = includePriceEffect ? PNL_COMPONENTS : PNL_COMPONENTS.filter((s) => s.key !== "priceEffect");
  const data = rows.map((r) => {
    const idle = isIdleDaily(r.daily);
    const net = includePriceEffect ? r.daily.pnl : r.daily.pnl - r.daily.priceEffect;
    return { date: r.date, ...r.daily, net, idle, netLabel: idle ? "no liq." : usdCompact(net) };
  });

  // Net labels only while they have room; with more days the tooltip carries the value.
  const labelNet = data.length <= 31;

  return (
    <div className="h-96 w-full">
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          stackOffset="sign"
          margin={{ top: labelNet ? 24 : 8, right: 8, bottom: 0, left: 8 }}
          onClick={(state) => {
            const label = (state as { activeLabel?: string } | null)?.activeLabel;
            if (label) onSelectDate(String(label));
          }}
        >
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps} />
          <YAxis tickFormatter={usdCompact} width={56} axisLine={false} {...axisProps} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          {selectedDate && <ReferenceLine x={selectedDate} stroke="var(--text-muted)" />}
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, label, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number> & { idle: boolean };
              if (p.idle) return <IdleTip title={shortDate(String(label))} />;
              return (
                <TipBox
                  title={shortDate(String(label))}
                  rows={[
                    ...series.map((s) => ({ label: s.label, color: s.color, value: p[s.key] })),
                    { label: includePriceEffect ? "Daily P&L" : "Daily P&L excl. price", value: p.net, strong: true },
                  ]}
                />
              );
            }}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="pnl"
              fill={s.color}
              stroke="var(--surface-1)"
              strokeWidth={1}
              maxBarSize={24}
              isAnimationActive={false}
            />
          ))}
          <Line
            dataKey="net"
            name="Daily P&L"
            stroke="var(--text-primary)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--text-primary)", stroke: "var(--surface-1)", strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: "var(--surface-1)", strokeWidth: 2 }}
            isAnimationActive={false}
          >
            {labelNet && (
              <LabelList
                dataKey="netLabel"
                position="top"
                offset={10}
                style={{ fill: "var(--text-secondary)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}
              />
            )}
          </Line>
          {data.length > 60 && (
            <Brush dataKey="date" height={20} stroke="var(--axis)" fill="var(--surface-1)" tickFormatter={shortDate} startIndex={data.length - 60} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Generic multi-line chart over days ─────────────────────────────────────

export function DailyLinesChart({
  data,
  series,
  xKey = "date",
  xFormatter = shortDate,
  zeroLine = false,
}: {
  data: Record<string, number | string>[];
  series: SeriesDef[];
  xKey?: string;
  xFormatter?: (v: string) => string;
  zeroLine?: boolean;
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey={xKey} tickFormatter={xFormatter} minTickGap={32} {...axisProps} />
          <YAxis tickFormatter={usdCompact} width={56} axisLine={false} domain={["auto", "auto"]} {...axisProps} />
          {zeroLine && <ReferenceLine y={0} stroke="var(--axis)" />}
          <Tooltip
            cursor={{ stroke: "var(--axis)" }}
            content={({ active, label, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Record<string, number>;
              return <TipBox title={xFormatter(String(label))} rows={series.map((s) => ({ label: s.label, color: s.color, value: p[s.key] }))} />;
            }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={data.length <= 31 ? { r: 4, fill: s.color, stroke: "var(--surface-1)", strokeWidth: 2 } : false}
              activeDot={{ r: 5, fill: s.color, stroke: "var(--surface-1)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export const timeOfDay = (iso: string) => new Date(iso).toISOString().slice(11, 16);

export function intradaySeriesData(points: IntradayPointDto[]) {
  return points.map((p) => ({
    timestamp: p.timestamp,
    totalPnl: p.totalPnl,
    realised: p.realisedTotal,
    unrealised: p.unrealisedTotal,
  }));
}
