"use client";

import { useState } from "react";
import type { DailyRowDto } from "@/lib/pnl/types";
import { usd } from "@/lib/format";

type View = "daily" | "cumulative";

const signed = (v: number) => (
  <span className={v >= 0.005 ? "text-positive" : v <= -0.005 ? "text-negative" : "text-ink-2"}>{usd(v, true)}</span>
);

const DAILY_COLUMNS: [string, (r: DailyRowDto) => React.ReactNode][] = [
  ["Opening NAV", (r) => usd(r.openingNav)],
  ["Fee income (R)", (r) => signed(r.daily.feeIncome)],
  ["Gas (R)", (r) => signed(r.daily.gasCost)],
  ["Fee reval. (U)", (r) => signed(r.daily.feeReval)],
  ["Price effect (U)", (r) => signed(r.daily.priceEffect)],
  ["IL change (U)", (r) => signed(r.daily.ilChange)],
  ["Capital in", (r) => usd(r.daily.capitalIn)],
  ["Daily P&L", (r) => <strong>{signed(r.daily.pnl)}</strong>],
  ["Closing NAV", (r) => usd(r.closingNav)],
];

const CUMULATIVE_COLUMNS: [string, (r: DailyRowDto) => React.ReactNode][] = [
  ["Fee income", (r) => signed(r.cumulative.realised.feeIncome)],
  ["Gas", (r) => signed(r.cumulative.realised.gasCost)],
  ["Realised fee reval.", (r) => signed(r.cumulative.realised.feeReval)],
  ["Realised position P&L", (r) => signed(r.cumulative.realised.priceEffect + r.cumulative.realised.il)],
  ["Cum. realised", (r) => <strong>{signed(r.cumulative.realised.total)}</strong>],
  ["Price effect", (r) => signed(r.cumulative.unrealised.priceEffect)],
  ["IL", (r) => signed(r.cumulative.unrealised.il)],
  ["Fee reval.", (r) => signed(r.cumulative.unrealised.feeReval)],
  ["Cum. unrealised", (r) => <strong>{signed(r.cumulative.unrealised.total)}</strong>],
  ["Total P&L", (r) => <strong>{signed(r.cumulative.totalPnl)}</strong>],
];

/** Spec §8.2 (daily) and §8.4 (cumulative) layouts, newest day first. */
export function DailyTable({
  rows,
  selectedDate,
  onSelectDate,
}: {
  rows: DailyRowDto[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const [view, setView] = useState<View>("daily");
  const columns = view === "daily" ? DAILY_COLUMNS : CUMULATIVE_COLUMNS;

  return (
    <div>
      <div className="mb-3 inline-flex rounded-md border border-line p-0.5 text-sm" role="tablist">
        {(["daily", "cumulative"] as View[]).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded px-3 py-1 capitalize ${view === v ? "bg-surface-2 font-medium" : "text-ink-2"}`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <table className="tnum w-full text-sm">
          <thead className="sticky top-0 bg-surface text-xs text-muted">
            <tr>
              <th className="px-2 py-2 text-left font-normal">Date</th>
              {columns.map(([label]) => (
                <th key={label} className="whitespace-nowrap px-2 py-2 text-right font-normal">
                  {label}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-normal">Checks</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr
                key={r.date}
                onClick={() => onSelectDate(r.date)}
                className={`cursor-pointer border-t border-line hover:bg-surface-2 ${r.date === selectedDate ? "bg-surface-2" : ""}`}
              >
                <td className="whitespace-nowrap px-2 py-1.5">{r.date}</td>
                {columns.map(([label, cell]) => (
                  <td key={label} className="whitespace-nowrap px-2 py-1.5 text-right">
                    {cell(r)}
                  </td>
                ))}
                <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs">
                  {r.checksOk ? <span className="text-good">✓ OK</span> : <span className="text-critical">▲ Mismatch</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
