"use client";

import { useState } from "react";
import type { DailyRowDto, ProtocolDto } from "@/lib/pnl/types";
import { bookedOf, isIdleDaily, usd } from "@/lib/format";

type View = "daily" | "cumulative";

const signed = (v: number) => (
  <span
    className={
      v >= 0.005
        ? "text-positive"
        : v <= -0.005
          ? "text-negative"
          : "text-ink-2"
    }
  >
    {usd(v, true)}
  </span>
);

type Column = [string, (r: DailyRowDto) => React.ReactNode];

function dailyColumns(protocol: ProtocolDto): Column[] {
  const compound = protocol === "COMPOUND_V3";
  return [
    ["Opening NAV", (r) => usd(r.openingNav)],
    [compound ? "Interest (R)" : "Fee income (R)", (r) => signed(r.daily.feeIncome)],
    ...(compound ? ([["COMP (R)", (r) => signed(r.daily.rewardIncome)]] as Column[]) : []),
    ["Gas (R)", (r) => signed(r.daily.gasCost)],
    [compound ? "Interest reval. (U)" : "Fee reval. (U)", (r) => signed(r.daily.feeReval)],
    ...(compound ? ([["COMP reval. (U)", (r) => signed(r.daily.rewardReval)]] as Column[]) : []),
    ["Price effect (U)", (r) => signed(r.daily.priceEffect)],
    ...(compound ? [] : ([["IL change (U)", (r) => signed(r.daily.ilChange)]] as Column[])),
    ["Capital in", (r) => usd(r.daily.capitalIn)],
    ["Capital out", (r) => usd(r.daily.capitalOut)],
    ["P&L booked", (r) => signed(bookedOf(r).total)],
    ["Daily P&L", (r) => <strong>{signed(r.daily.pnl)}</strong>],
    ["Closing NAV", (r) => usd(r.closingNav)],
  ];
}

function cumulativeColumns(protocol: ProtocolDto): Column[] {
  const compound = protocol === "COMPOUND_V3";
  return [
    [compound ? "Interest" : "Fee income", (r) => signed(r.cumulative.realised.feeIncome)],
    ...(compound ? ([["COMP", (r) => signed(r.cumulative.realised.rewardIncome)]] as Column[]) : []),
    ["Gas", (r) => signed(r.cumulative.realised.gasCost)],
    [
      compound ? "Realised interest + COMP reval." : "Realised fee reval.",
      (r) => signed(r.cumulative.realised.feeReval + r.cumulative.realised.rewardReval),
    ],
    [
      compound ? "Realised price effect" : "Realised position P&L",
      (r) => signed(r.cumulative.realised.priceEffect + r.cumulative.realised.il),
    ],
    ["Cum. realised", (r) => <strong>{signed(r.cumulative.realised.total)}</strong>],
    ["Price effect", (r) => signed(r.cumulative.unrealised.priceEffect)],
    ...(compound ? [] : ([["IL", (r) => signed(r.cumulative.unrealised.il)]] as Column[])),
    [compound ? "Interest reval." : "Fee reval.", (r) => signed(r.cumulative.unrealised.feeReval)],
    ...(compound ? ([["COMP reval.", (r) => signed(r.cumulative.unrealised.rewardReval)]] as Column[]) : []),
    ["Cum. unrealised", (r) => <strong>{signed(r.cumulative.unrealised.total)}</strong>],
    ["Total P&L", (r) => <strong>{signed(r.cumulative.totalPnl)}</strong>],
  ];
}

/** Spec §8.2 (daily) and §8.4 (cumulative) layouts, newest day first. */
export function DailyTable({
  rows,
  protocol,
  selectedDate,
  onSelectDate,
}: {
  rows: DailyRowDto[];
  protocol: ProtocolDto;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const [view, setView] = useState<View>("daily");
  const columns = view === "daily" ? dailyColumns(protocol) : cumulativeColumns(protocol);

  return (
    <div>
      <div
        className="mb-3 inline-flex rounded-md border border-line p-0.5 text-sm"
        role="tablist"
      >
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
                <th
                  key={label}
                  className="whitespace-nowrap px-2 py-2 text-right font-normal"
                >
                  {label}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-normal">Checks</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => {
              const idle = isIdleDaily(r.daily);
              return (
                <tr
                  key={r.date}
                  onClick={() => onSelectDate(r.date)}
                  className={`cursor-pointer border-t border-line hover:bg-surface-2 ${r.date === selectedDate ? "bg-surface-2" : ""} ${idle ? "text-muted" : ""}`}
                >
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {r.date}
                    {idle && (
                      <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">
                        ○ {protocol === "COMPOUND_V3" ? "nothing supplied" : "no liquidity"}
                      </span>
                    )}
                  </td>
                  {columns.map(([label, cell]) => (
                    <td
                      key={label}
                      className="whitespace-nowrap px-2 py-1.5 text-right"
                    >
                      {cell(r)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs">
                    {r.checksOk ? (
                      <span className="text-good">✓ OK</span>
                    ) : (
                      <span className="text-critical">▲ Mismatch</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
