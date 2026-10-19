// P&L engine (spec §1–§7), generalised to any token pair and valued in USD.
//
// The engine is a pure state machine. Each `step` takes the previous state, an observation of
// the pool and position at a block, and the liquidity events that happened right after it, and
// returns the new state plus the P&L of the interval.
//
// NAV is measured at the wallet level: tokens that leave the position (withdrawn principal and
// collected fees) stay in NAV at their exit value, and gas is paid from the wallet. Withdrawals
// therefore move P&L from unrealised to realised but are not capital outflows.

import { positionAmounts, sqrtPriceFromX96, valueUsd } from "@/lib/uniswap/math";

export interface PositionMeta {
  tickLower: number;
  tickUpper: number;
  decimals0: number;
  decimals1: number;
}

/** Pool and position as read on-chain at one block. */
export interface Observation {
  block: number;
  timestamp: number; // unix seconds
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint; // on-chain liquidity, used only as a sanity check
  /** tokensOwed + accrued fees, human units. Includes withdrawn principal not yet collected. */
  owed0: number;
  owed1: number;
  usd0: number;
  usd1: number;
  ethUsd: number; // for gas
}

/** Amounts are human units. */
export type LiquidityEvent =
  | { kind: "increase"; liquidity: bigint; amount0: number; amount1: number }
  | { kind: "decrease"; liquidity: bigint; amount0: number; amount1: number }
  | { kind: "collect"; amount0: number; amount1: number }
  | { kind: "gas"; gasEth: number };

export interface RealisedTotals {
  feeIncome: number;
  gasCost: number;
  feeReval: number;
  priceEffect: number;
  il: number;
}

export interface UnrealisedTotals {
  priceEffect: number;
  il: number;
  feeReval0: number;
  feeReval1: number;
}

/** JSON-serializable engine state (bigints stored as strings). */
export interface EngineState {
  initialized: boolean;
  block: number;
  timestamp: number;
  liquidity: string;
  sqrtPriceX96: string;
  tick: number;
  usd0: number;
  usd1: number;
  amount0: number;
  amount1: number;
  value: number;
  hodl0: number;
  hodl1: number;
  costBasis: number;
  heldFees0: number; // uncollected fees
  heldFees1: number;
  earnedFees0: number; // cumulative fees earned (never decreases)
  earnedFees1: number;
  owedPrincipal0: number; // withdrawn principal still sitting in tokensOwed
  owedPrincipal1: number;
  exitedValue: number; // USD value of tokens that left the position, at exit prices
  capitalIn: number;
  capitalOut: number;
  realised: RealisedTotals;
  unrealised: UnrealisedTotals;
}

export interface IntervalPnl {
  feeIncome: number;
  gasCost: number;
  feeReval: number;
  priceEffect: number;
  ilChange: number;
  capitalIn: number;
  capitalOut: number;
  pnl: number;
}

export interface Reclassified {
  feeRevalToRealised: number;
  priceEffectToRealised: number;
  ilToRealised: number;
}

export interface Checks {
  navReconciles: boolean;
  pnlReconciles: boolean;
  totalsReconcile: boolean;
  totalPnlMatchesNav: boolean;
  positionReconciles: boolean;
  ilMatchesHodl: boolean;
  liquidityMatches: boolean;
}

export interface StepResult {
  state: EngineState;
  navOpen: number;
  navClose: number;
  interval: IntervalPnl;
  reclassified: Reclassified;
  checks: Checks;
  checksOk: boolean;
}

export function initialState(): EngineState {
  return {
    initialized: false,
    block: 0,
    timestamp: 0,
    liquidity: "0",
    sqrtPriceX96: "0",
    tick: 0,
    usd0: 0,
    usd1: 0,
    amount0: 0,
    amount1: 0,
    value: 0,
    hodl0: 0,
    hodl1: 0,
    costBasis: 0,
    heldFees0: 0,
    heldFees1: 0,
    earnedFees0: 0,
    earnedFees1: 0,
    owedPrincipal0: 0,
    owedPrincipal1: 0,
    exitedValue: 0,
    capitalIn: 0,
    capitalOut: 0,
    realised: { feeIncome: 0, gasCost: 0, feeReval: 0, priceEffect: 0, il: 0 },
    unrealised: { priceEffect: 0, il: 0, feeReval0: 0, feeReval1: 0 },
  };
}

export const heldFeesValue = (s: EngineState) => s.heldFees0 * s.usd0 + s.heldFees1 * s.usd1;
export const hodlValue = (s: EngineState) => s.hodl0 * s.usd0 + s.hodl1 * s.usd1;
export const nav = (s: EngineState) => s.value + heldFeesValue(s) + s.exitedValue + s.realised.gasCost;
export const realisedTotal = (s: EngineState) =>
  s.realised.feeIncome + s.realised.gasCost + s.realised.feeReval + s.realised.priceEffect + s.realised.il;
export const unrealisedFeeReval = (s: EngineState) => s.unrealised.feeReval0 + s.unrealised.feeReval1;
export const unrealisedTotal = (s: EngineState) =>
  s.unrealised.priceEffect + s.unrealised.il + unrealisedFeeReval(s);
export const totalPnl = (s: EngineState) => realisedTotal(s) + unrealisedTotal(s);
export const netCapital = (s: EngineState) => s.capitalIn - s.capitalOut;

function revalue(s: EngineState, meta: PositionMeta) {
  const amounts = positionAmounts(
    BigInt(s.liquidity),
    sqrtPriceFromX96(BigInt(s.sqrtPriceX96)),
    meta.tickLower,
    meta.tickUpper,
    meta.decimals0,
    meta.decimals1,
  );
  s.amount0 = amounts.amount0;
  s.amount1 = amounts.amount1;
  s.value = valueUsd(amounts, s.usd0, s.usd1);
}

/**
 * Advance to `obs`, then apply `events` (all of one block, in log order) at the observed prices.
 * For an event checkpoint, `obs` should be read at the block before the events.
 */
export function step(
  prev: EngineState,
  meta: PositionMeta,
  obs: Observation,
  events: LiquidityEvent[] = [],
): StepResult {
  const s: EngineState = structuredClone(prev);
  const navOpen = nav(prev);
  const iv: IntervalPnl = {
    feeIncome: 0,
    gasCost: 0,
    feeReval: 0,
    priceEffect: 0,
    ilChange: 0,
    capitalIn: 0,
    capitalOut: 0,
    pnl: 0,
  };
  const rc: Reclassified = { feeRevalToRealised: 0, priceEffectToRealised: 0, ilToRealised: 0 };

  // On the first observation there is nothing to revalue yet.
  const prevUsd0 = s.initialized ? s.usd0 : obs.usd0;
  const prevUsd1 = s.initialized ? s.usd1 : obs.usd1;
  const liquidityMatches = BigInt(s.liquidity) === obs.liquidity;

  // ── 1. Mark to market (§4.5–4.7) ──────────────────────────────────────────
  s.block = obs.block;
  s.timestamp = obs.timestamp;
  s.sqrtPriceX96 = obs.sqrtPriceX96.toString();
  s.tick = obs.tick;
  s.usd0 = obs.usd0;
  s.usd1 = obs.usd1;
  s.initialized = true;

  const d0 = obs.usd0 - prevUsd0;
  const d1 = obs.usd1 - prevUsd1;

  const valueBefore = s.value;
  revalue(s, meta);
  iv.priceEffect = s.hodl0 * d0 + s.hodl1 * d1;
  iv.ilChange = s.value - valueBefore - iv.priceEffect;

  // Fees held at the previous checkpoint are revalued; new fees are income at today's price.
  const reval0 = s.heldFees0 * d0;
  const reval1 = s.heldFees1 * d1;
  iv.feeReval = reval0 + reval1;
  s.unrealised.feeReval0 += reval0;
  s.unrealised.feeReval1 += reval1;

  const held0 = obs.owed0 - s.owedPrincipal0;
  const held1 = obs.owed1 - s.owedPrincipal1;
  const new0 = held0 - s.heldFees0;
  const new1 = held1 - s.heldFees1;
  iv.feeIncome = new0 * obs.usd0 + new1 * obs.usd1;
  s.heldFees0 = held0;
  s.heldFees1 = held1;
  s.earnedFees0 += new0;
  s.earnedFees1 += new1;

  s.unrealised.priceEffect += iv.priceEffect;
  s.unrealised.il += iv.ilChange;

  // ── 2. Events at the observed prices (§4.8–4.10) ──────────────────────────
  for (const e of events) {
    if (e.kind === "increase") {
      const valueBeforeEvent = s.value;
      const deposit = e.amount0 * s.usd0 + e.amount1 * s.usd1;
      s.liquidity = (BigInt(s.liquidity) + e.liquidity).toString();
      revalue(s, meta);
      s.hodl0 += e.amount0;
      s.hodl1 += e.amount1;
      s.costBasis += deposit;
      s.capitalIn += deposit;
      iv.capitalIn += deposit;
      // Event amounts are priced at the tx, the engine at the observation; book the gap as IL.
      const slip = s.value - valueBeforeEvent - deposit;
      iv.ilChange += slip;
      s.unrealised.il += slip;
    } else if (e.kind === "decrease") {
      const before = BigInt(s.liquidity);
      if (before === 0n) continue;
      const f = Number(e.liquidity) / Number(before);
      const valueBeforeEvent = s.value;
      s.liquidity = (before - e.liquidity).toString();
      revalue(s, meta);

      const pe = f * s.unrealised.priceEffect;
      const il = f * s.unrealised.il;
      const withdrawn = e.amount0 * s.usd0 + e.amount1 * s.usd1;
      // Value that left vs. the position's mark: the difference is realised immediately as IL.
      const slip = withdrawn - (valueBeforeEvent - s.value);

      s.unrealised.priceEffect -= pe;
      s.unrealised.il -= il;
      s.realised.priceEffect += pe;
      s.realised.il += il + slip;
      iv.ilChange += slip;
      rc.priceEffectToRealised += pe;
      rc.ilToRealised += il;

      s.hodl0 *= 1 - f;
      s.hodl1 *= 1 - f;
      s.costBasis *= 1 - f;
      s.owedPrincipal0 += e.amount0;
      s.owedPrincipal1 += e.amount1;
      s.exitedValue += withdrawn;
    } else if (e.kind === "collect") {
      // Principal comes out first; anything above it is fees.
      const p0 = Math.min(e.amount0, Math.max(s.owedPrincipal0, 0));
      const p1 = Math.min(e.amount1, Math.max(s.owedPrincipal1, 0));
      s.owedPrincipal0 -= p0;
      s.owedPrincipal1 -= p1;
      collectFees(s, iv, rc, 0, e.amount0 - p0);
      collectFees(s, iv, rc, 1, e.amount1 - p1);
    } else {
      const cost = e.gasEth * obs.ethUsd;
      iv.gasCost -= cost;
      s.realised.gasCost -= cost;
    }
  }

  s.realised.feeIncome += iv.feeIncome;
  iv.pnl = iv.feeIncome + iv.gasCost + iv.feeReval + iv.priceEffect + iv.ilChange;

  const navClose = nav(s);
  const checks = runChecks(s, navOpen, navClose, iv, liquidityMatches);
  return {
    state: s,
    navOpen,
    navClose,
    interval: iv,
    reclassified: rc,
    checks,
    checksOk: Object.values(checks).every(Boolean),
  };
}

function collectFees(
  s: EngineState,
  iv: IntervalPnl,
  rc: Reclassified,
  token: 0 | 1,
  amount: number,
) {
  if (amount <= 0) return;
  const usd = token === 0 ? s.usd0 : s.usd1;
  const held = token === 0 ? s.heldFees0 : s.heldFees1;

  // Fees accrued between the observation and the collect tx: income at the observed price.
  const extra = Math.max(amount - held, 0);
  if (extra > 0) {
    iv.feeIncome += extra * usd;
    if (token === 0) s.earnedFees0 += extra;
    else s.earnedFees1 += extra;
  }

  const share = held > 0 ? Math.min((amount - extra) / held, 1) : 0;
  const key = token === 0 ? "feeReval0" : "feeReval1";
  const realised = share * s.unrealised[key];
  s.unrealised[key] -= realised;
  s.realised.feeReval += realised;
  rc.feeRevalToRealised += realised;

  if (token === 0) s.heldFees0 = held + extra - amount;
  else s.heldFees1 = held + extra - amount;
  s.exitedValue += amount * usd;
}

function runChecks(
  s: EngineState,
  navOpen: number,
  navClose: number,
  iv: IntervalPnl,
  liquidityMatches: boolean,
): Checks {
  // ±$0.01, scaled up for large positions so float rounding does not raise false alarms.
  const tol = Math.max(0.01, 1e-9 * Math.max(s.capitalIn, Math.abs(navClose)));
  const eq = (a: number, b: number) => Math.abs(a - b) <= tol;
  const total = totalPnl(s);
  return {
    navReconciles: eq(navClose, navOpen + iv.pnl + iv.capitalIn - iv.capitalOut),
    pnlReconciles: eq(iv.pnl, iv.feeIncome + iv.gasCost + iv.feeReval + iv.priceEffect + iv.ilChange),
    totalsReconcile: eq(realisedTotal(s) + unrealisedTotal(s), total),
    totalPnlMatchesNav: eq(total, navClose - netCapital(s)),
    positionReconciles: eq(s.unrealised.priceEffect + s.unrealised.il, s.value - s.costBasis),
    ilMatchesHodl: eq(s.unrealised.il, s.value - hodlValue(s)),
    liquidityMatches,
  };
}
