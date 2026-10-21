import { price0In1AtTick } from "@/lib/uniswap/math";
import type { PoolDto } from "@/lib/pnl/types";

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function usd(v: number, signed = false): string {
  const s = usdFmt.format(Math.abs(v) < 0.005 ? 0 : v).replace("-", "−");
  return signed && v >= 0.005 ? `+${s}` : s;
}

export function usdCompact(v: number): string {
  if (Math.abs(v) < 1000) return `$${Math.round(v)}`.replace("$-", "−$");
  return `${v < 0 ? "−" : ""}$${compactFmt.format(Math.abs(v))}`;
}

export function num(v: number, digits = 4): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Pair label with the CoinGecko reference token as quote, e.g. "WETH / USDC". */
export function pairLabel(pool: PoolDto): { base: string; quote: string } {
  return pool.refToken === 0
    ? { base: pool.token1Symbol, quote: pool.token0Symbol }
    : { base: pool.token0Symbol, quote: pool.token1Symbol };
}

/** Price of the base token in the quote token at a tick. */
export function basePriceAtTick(pool: PoolDto, tick: number): number {
  const p = price0In1AtTick(tick, pool.token0Decimals, pool.token1Decimals);
  return pool.refToken === 0 ? 1 / p : p;
}

export function priceRange(pool: PoolDto, tickLower: number, tickUpper: number): [number, number] {
  const a = basePriceAtTick(pool, tickLower);
  const b = basePriceAtTick(pool, tickUpper);
  return a < b ? [a, b] : [b, a];
}

export function price(v: number): string {
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return v.toPrecision(4);
}

/** Day range for the day-based charts: a number of UTC days ending today, or everything. */
export type DayRange = 15 | 30 | 90 | "all";
export const DAY_RANGES: DayRange[] = [15, 30, 90, "all"];

export function inDayRange(date: string, range: DayRange): boolean {
  if (range === "all") return true;
  const from = new Date(Date.now() - (range - 1) * 86400_000).toISOString().slice(0, 10);
  return date >= from;
}

/** True when a day has no P&L at all, i.e. the position held no liquidity that day. */
export const isIdleDay = (components: Record<string, number>) =>
  Object.values(components).every((v) => Math.abs(v) < 0.005);

/** isIdleDay for a DailyRowDto's interval figures (capital flows are not P&L). */
export const isIdleDaily = (d: { feeIncome: number; gasCost: number; feeReval: number; priceEffect: number; ilChange: number }) =>
  isIdleDay({ a: d.feeIncome, b: d.gasCost, c: d.feeReval, e: d.priceEffect, f: d.ilChange });

/** A row's booked P&L; zero when the row predates the field (e.g. data fetched before an update). */
export const bookedOf = (r: { booked?: { total: number; position: number; fees: number } }) =>
  r.booked ?? { total: 0, position: 0, fees: 0 };

export const feeTier =(fee: number) => `${(fee / 10000).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
