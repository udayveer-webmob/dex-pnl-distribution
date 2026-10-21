// Day P&L from two snapshots per day: the day's last snapshot (close) minus the previous day's last
// snapshot (open). Uses only cumulative totals, so intraday snapshots in between don't matter.

import type { DayPnlDto } from "./types";

/** Cumulative totals carried by every snapshot. */
export interface CloseSnapshot {
  date: string;
  timestamp: Date;
  rFeeIncome: number;
  rGasCost: number;
  rFeeReval: number;
  rPriceEffect: number;
  rIl: number;
  uPriceEffect: number;
  uIl: number;
  uFeeReval: number;
  realisedTotal: number;
  unrealisedTotal: number;
  totalPnl: number;
}

const ZERO: Omit<CloseSnapshot, "date" | "timestamp"> = {
  rFeeIncome: 0,
  rGasCost: 0,
  rFeeReval: 0,
  rPriceEffect: 0,
  rIl: 0,
  uPriceEffect: 0,
  uIl: 0,
  uFeeReval: 0,
  realisedTotal: 0,
  unrealisedTotal: 0,
  totalPnl: 0,
};

/** `closes` must be one snapshot per day, ordered by date. The first day opens from zero (before mint). */
export function buildDayPnl(closes: CloseSnapshot[]): DayPnlDto[] {
  return closes.map((close, i) => {
    const prev = i > 0 ? closes[i - 1] : null;
    const open = prev ?? ZERO;
    return {
      date: close.date,
      openAt: prev ? prev.timestamp.toISOString() : null,
      closeAt: close.timestamp.toISOString(),
      openTotalPnl: open.totalPnl,
      closeTotalPnl: close.totalPnl,
      pnl: close.totalPnl - open.totalPnl,
      components: {
        feeIncome: close.rFeeIncome - open.rFeeIncome,
        gasCost: close.rGasCost - open.rGasCost,
        feeReval: close.rFeeReval + close.uFeeReval - (open.rFeeReval + open.uFeeReval),
        priceEffect: close.rPriceEffect + close.uPriceEffect - (open.rPriceEffect + open.uPriceEffect),
        positionalChange: close.rIl + close.uIl - (open.rIl + open.uIl),
      },
      cumulative: {
        realised: close.realisedTotal,
        unrealised: close.unrealisedTotal,
        total: close.totalPnl,
      },
    };
  });
}
