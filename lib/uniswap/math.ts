// Uniswap v3 maths for an arbitrary token0/token1 pair (spec §4.1–4.4, generalised).
//
// "Raw" prices are token1 base units per token0 base unit, as stored by the pool.
// Token amounts returned here are in human units (divided by 10^decimals).

const Q96 = 2 ** 96;
const Q128 = 2n ** 128n;
const UINT256 = 2n ** 256n;

/** √(raw price) from slot0.sqrtPriceX96. */
export function sqrtPriceFromX96(sqrtPriceX96: bigint): number {
  return Number(sqrtPriceX96) / Q96;
}

/** √(raw price) at a tick: √(1.0001^tick). */
export function sqrtPriceAtTick(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}

/** Human price of token0 expressed in token1 (e.g. WETH per USDC for the USDC/WETH pool). */
export function price0In1(sqrtPrice: number, decimals0: number, decimals1: number): number {
  return sqrtPrice * sqrtPrice * Math.pow(10, decimals0 - decimals1);
}

/** Human price of token0 in token1 at a tick. */
export function price0In1AtTick(tick: number, decimals0: number, decimals1: number): number {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

/** Inverse of sqrtPriceFromX96, for fixtures and tests. */
export function sqrtPriceX96FromPrice0In1(price: number, decimals0: number, decimals1: number): bigint {
  const raw = price * Math.pow(10, decimals1 - decimals0);
  return BigInt(Math.round(Math.sqrt(raw) * Q96));
}

export interface TokenAmounts {
  amount0: number;
  amount1: number;
}

/** Tokens held by `liquidity` at the given √price (spec §4.3). */
export function positionAmounts(
  liquidity: bigint,
  sqrtPrice: number,
  tickLower: number,
  tickUpper: number,
  decimals0: number,
  decimals1: number,
): TokenAmounts {
  if (liquidity === 0n) return { amount0: 0, amount1: 0 };
  const L = Number(liquidity);
  const sa = sqrtPriceAtTick(tickLower);
  const sb = sqrtPriceAtTick(tickUpper);
  const s = Math.min(Math.max(sqrtPrice, sa), sb);
  return {
    amount0: (L * (1 / s - 1 / sb)) / Math.pow(10, decimals0),
    amount1: (L * (s - sa)) / Math.pow(10, decimals1),
  };
}

/** USD value of token amounts. */
export function valueUsd(a: TokenAmounts, usd0: number, usd1: number): number {
  return a.amount0 * usd0 + a.amount1 * usd1;
}

/**
 * USD prices of both tokens from one reference USD price and the pool price, so every
 * valuation at a block is internally consistent.
 */
export function deriveUsdPrices(
  sqrtPrice: number,
  decimals0: number,
  decimals1: number,
  refToken: 0 | 1,
  refUsd: number,
): { usd0: number; usd1: number } {
  const p = price0In1(sqrtPrice, decimals0, decimals1);
  return refToken === 0 ? { usd0: refUsd, usd1: refUsd / p } : { usd0: refUsd * p, usd1: refUsd };
}

const mod256 = (x: bigint) => ((x % UINT256) + UINT256) % UINT256;

/** feeGrowthInside per token, with uint256 wrap-around (spec §4.4). */
export function feeGrowthInside(
  tickCurrent: number,
  tickLower: number,
  tickUpper: number,
  feeGrowthGlobal: bigint,
  lowerOutside: bigint,
  upperOutside: bigint,
): bigint {
  const below = tickCurrent >= tickLower ? lowerOutside : mod256(feeGrowthGlobal - lowerOutside);
  const above = tickCurrent < tickUpper ? upperOutside : mod256(feeGrowthGlobal - upperOutside);
  return mod256(feeGrowthGlobal - below - above);
}

/** tokensOwed plus fees accrued since the position was last touched, in raw units. */
export function owedRaw(
  liquidity: bigint,
  insideNow: bigint,
  insideLast: bigint,
  tokensOwed: bigint,
): bigint {
  return tokensOwed + (liquidity * mod256(insideNow - insideLast)) / Q128;
}

export function toHuman(raw: bigint, decimals: number): number {
  return Number(raw) / Math.pow(10, decimals);
}
