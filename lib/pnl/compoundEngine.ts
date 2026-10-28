// P&L engine for a Compound III base-asset supply position (compound-v3-weth-supply-pnl-spec.md).
//
// Pure state machine, like the Uniswap engine: `step` advances to an observation (balance, unclaimed
// COMP, prices at one block), then applies the events that happened right after it.
//
// NAV is what the position holds: supplied balance plus unclaimed COMP, less the gas paid for it.
// ETH withdrawn and COMP claimed leave the position as capital out at their exit prices (the same
// rule as the Uniswap tracker), so re-supplying the same funds does not inflate NAV.
//
// There is no impermanent loss: the position is always 100% the base asset.

export interface CompoundObservation {
  block: number;
  timestamp: number; // unix seconds
  /** comet.balanceOf(wallet): supplied balance including interest, human units. */
  balance: number;
  /** CometRewards.getRewardOwed: unclaimed COMP. */
  owedComp: number;
  baseUsd: number; // base asset (ETH) price
  compUsd: number;
  ethUsd: number; // for gas; equals baseUsd in the WETH market
}

/** Amounts in human units. */
export type CompoundEvent =
  | { kind: "supply"; amount: number }
  | { kind: "withdraw"; amount: number }
  | { kind: "claim"; amount: number }
  | { kind: "gas"; gasEth: number };

export interface CompoundState {
  initialized: boolean;
  block: number;
  timestamp: number;
  baseUsd: number;
  compUsd: number;
  balance: number; // B
  principal: number; // p: deposited − principal withdrawn (also the HODL amount)
  owedComp: number; // K
  earnedComp: number; // cumulative COMP earned (owed + claimed)
  costBasis: number;
  capitalIn: number;
  capitalOut: number;
  realised: {
    interestIncome: number;
    compIncome: number;
    gasCost: number;
    priceEffect: number;
    interestReval: number;
    compReval: number;
  };
  unrealised: { priceEffect: number; interestReval: number; compReval: number };
}

export interface CompoundInterval {
  interestIncome: number;
  compIncome: number;
  gasCost: number;
  interestReval: number;
  compReval: number;
  priceEffect: number;
  capitalIn: number;
  capitalOut: number;
  pnl: number;
}

export interface CompoundReclassified {
  priceEffectToRealised: number;
  interestRevalToRealised: number;
  compRevalToRealised: number;
}

export interface CompoundChecks {
  navReconciles: boolean;
  pnlReconciles: boolean;
  totalsReconcile: boolean;
  totalPnlMatchesNav: boolean;
  priceEffectMatchesCost: boolean;
}

export interface CompoundStepResult {
  state: CompoundState;
  navOpen: number;
  navClose: number;
  interval: CompoundInterval;
  reclassified: CompoundReclassified;
  checks: CompoundChecks;
  checksOk: boolean;
}

export function initialCompoundState(): CompoundState {
  return {
    initialized: false,
    block: 0,
    timestamp: 0,
    baseUsd: 0,
    compUsd: 0,
    balance: 0,
    principal: 0,
    owedComp: 0,
    earnedComp: 0,
    costBasis: 0,
    capitalIn: 0,
    capitalOut: 0,
    realised: { interestIncome: 0, compIncome: 0, gasCost: 0, priceEffect: 0, interestReval: 0, compReval: 0 },
    unrealised: { priceEffect: 0, interestReval: 0, compReval: 0 },
  };
}

export const interestAccrued = (s: CompoundState) => s.balance - s.principal;
export const positionValue = (s: CompoundState) => s.balance * s.baseUsd;
export const owedCompValue = (s: CompoundState) => s.owedComp * s.compUsd;
export const hodlValue = (s: CompoundState) => s.principal * s.baseUsd;
export const compoundNav = (s: CompoundState) => positionValue(s) + owedCompValue(s) + s.realised.gasCost;
export const compoundRealisedTotal = (s: CompoundState) =>
  Object.values(s.realised).reduce((a, b) => a + b, 0);
export const compoundUnrealisedTotal = (s: CompoundState) =>
  s.unrealised.priceEffect + s.unrealised.interestReval + s.unrealised.compReval;
export const compoundTotalPnl = (s: CompoundState) => compoundRealisedTotal(s) + compoundUnrealisedTotal(s);
export const compoundNetCapital = (s: CompoundState) => s.capitalIn - s.capitalOut;

export function compoundStep(
  prev: CompoundState,
  obs: CompoundObservation,
  events: CompoundEvent[] = [],
): CompoundStepResult {
  const s: CompoundState = structuredClone(prev);
  const navOpen = compoundNav(prev);
  const iv: CompoundInterval = {
    interestIncome: 0,
    compIncome: 0,
    gasCost: 0,
    interestReval: 0,
    compReval: 0,
    priceEffect: 0,
    capitalIn: 0,
    capitalOut: 0,
    pnl: 0,
  };
  const rc: CompoundReclassified = { priceEffectToRealised: 0, interestRevalToRealised: 0, compRevalToRealised: 0 };

  const dP = s.initialized ? obs.baseUsd - s.baseUsd : 0;
  const dC = s.initialized ? obs.compUsd - s.compUsd : 0;
  s.block = obs.block;
  s.timestamp = obs.timestamp;
  s.initialized = true;

  // ── 1. Mark to market (§4.3–4.5) ──────────────────────────────────────────
  // Principal and interest held at the previous checkpoint are revalued at the new price.
  iv.priceEffect = s.principal * dP;
  iv.interestReval = interestAccrued(s) * dP;
  iv.compReval = s.owedComp * dC;
  s.unrealised.priceEffect += iv.priceEffect;
  s.unrealised.interestReval += iv.interestReval;
  s.unrealised.compReval += iv.compReval;

  // Interest is the balance growth (flows are applied after the observation, so none fall in between).
  iv.interestIncome = (obs.balance - s.balance) * obs.baseUsd;
  s.balance = obs.balance;

  const claimed = s.earnedComp - s.owedComp; // COMP claimed so far
  const earned = obs.owedComp + claimed;
  iv.compIncome = (earned - s.earnedComp) * obs.compUsd;
  s.earnedComp = earned;
  s.owedComp = obs.owedComp;

  s.baseUsd = obs.baseUsd;
  s.compUsd = obs.compUsd;

  // ── 2. Events at the observed prices (§4.6–4.9) ───────────────────────────
  for (const e of events) {
    if (e.kind === "supply") {
      const value = e.amount * s.baseUsd;
      s.balance += e.amount;
      s.principal += e.amount;
      s.costBasis += value;
      s.capitalIn += value;
      iv.capitalIn += value;
    } else if (e.kind === "withdraw") {
      // Interest accrued between the observation and the withdraw tx is income at the observed price.
      const extra = Math.max(e.amount - s.balance, 0);
      if (extra > 0) {
        s.balance += extra;
        iv.interestIncome += extra * s.baseUsd;
      }
      if (s.balance <= 0) continue;
      const f = Math.min(e.amount / s.balance, 1);
      const pe = f * s.unrealised.priceEffect;
      const ir = f * s.unrealised.interestReval;
      s.unrealised.priceEffect -= pe;
      s.unrealised.interestReval -= ir;
      s.realised.priceEffect += pe;
      s.realised.interestReval += ir;
      rc.priceEffectToRealised += pe;
      rc.interestRevalToRealised += ir;
      s.principal *= 1 - f;
      s.costBasis *= 1 - f;
      s.balance = f === 1 ? 0 : s.balance - e.amount;
      const value = e.amount * s.baseUsd;
      s.capitalOut += value;
      iv.capitalOut += value;
    } else if (e.kind === "claim") {
      const extra = Math.max(e.amount - s.owedComp, 0);
      if (extra > 0) {
        s.owedComp += extra;
        s.earnedComp += extra;
        iv.compIncome += extra * s.compUsd;
      }
      const share = s.owedComp > 0 ? Math.min(e.amount / s.owedComp, 1) : 0;
      const cr = share * s.unrealised.compReval;
      s.unrealised.compReval -= cr;
      s.realised.compReval += cr;
      rc.compRevalToRealised += cr;
      s.owedComp -= e.amount;
      const value = e.amount * s.compUsd;
      s.capitalOut += value;
      iv.capitalOut += value;
    } else {
      const cost = e.gasEth * obs.ethUsd;
      iv.gasCost -= cost;
      s.realised.gasCost -= cost;
    }
  }

  s.realised.interestIncome += iv.interestIncome;
  s.realised.compIncome += iv.compIncome;
  iv.pnl = iv.interestIncome + iv.compIncome + iv.gasCost + iv.interestReval + iv.compReval + iv.priceEffect;

  const navClose = compoundNav(s);
  const tol = Math.max(0.01, 1e-9 * Math.max(s.capitalIn, Math.abs(navClose)));
  const eq = (a: number, b: number) => Math.abs(a - b) <= tol;
  const checks: CompoundChecks = {
    navReconciles: eq(navClose, navOpen + iv.pnl + iv.capitalIn - iv.capitalOut),
    pnlReconciles: eq(
      iv.pnl,
      iv.interestIncome + iv.compIncome + iv.gasCost + iv.interestReval + iv.compReval + iv.priceEffect,
    ),
    totalsReconcile: eq(compoundRealisedTotal(s) + compoundUnrealisedTotal(s), compoundTotalPnl(s)),
    totalPnlMatchesNav: eq(compoundTotalPnl(s), navClose - compoundNetCapital(s)),
    priceEffectMatchesCost: eq(s.unrealised.priceEffect, s.principal * s.baseUsd - s.costBasis),
  };
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
