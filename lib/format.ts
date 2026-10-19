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

export const feeTier = (fee: number) => `${(fee / 10000).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
