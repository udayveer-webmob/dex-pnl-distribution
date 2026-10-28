import { describe, expect, it } from "vitest";
import {
  type CompoundEvent,
  type CompoundObservation,
  type CompoundState,
  type CompoundStepResult,
  compoundNav,
  compoundRealisedTotal,
  compoundStep,
  compoundTotalPnl,
  compoundUnrealisedTotal,
  initialCompoundState,
} from "./compoundEngine";

// compound-v3-weth-supply-pnl-spec.md §8: $10,000 supplied at ETH $2,429.22, 2% supply APR,
// COMP ≈ $40. Day-end balances and unclaimed COMP from §8.1.
const obs = (day: number, eth: number, comp: number, balance: number, owedComp: number): CompoundObservation => ({
  block: day * 7200,
  timestamp: day * 86400,
  balance,
  owedComp,
  baseUsd: eth,
  compUsd: comp,
  ethUsd: eth,
});
const gas = (usd: number, eth: number): CompoundEvent => ({ kind: "gas", gasEth: usd / eth });

function replay() {
  const r: CompoundStepResult[] = [];
  let s: CompoundState = initialCompoundState();
  const push = (x: CompoundStepResult) => {
    r.push(x);
    s = x.state;
  };
  push(compoundStep(s, obs(0, 2429.22, 40, 0, 0), [{ kind: "supply", amount: 4.116555 }]));
  push(compoundStep(s, obs(1, 2420, 40, 4.11678, 0.003412), [gas(2, 2420)]));
  push(compoundStep(s, obs(2, 2300, 38, 4.117006, 0.006825)));
  push(compoundStep(s, obs(3, 2370, 39, 4.117231, 0.010252)));
  push(compoundStep(s, obs(4, 2450, 41, 4.117457, 0.013621), [{ kind: "claim", amount: 0.013621 }, gas(1.5, 2450)]));
  push(
    compoundStep(s, obs(5, 2400, 40, 4.117682, 0.003383), [
      { kind: "withdraw", amount: 4.117682 },
      { kind: "claim", amount: 0.003383 },
      gas(2, 2400),
    ]),
  );
  return r;
}

const near = (actual: number, expected: number, tol = 0.015) =>
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tol);

describe("Compound III engine – spec §8 worked example", () => {
  const r = replay();
  const [d0, d1, d2, d3, d4, d5] = r;

  it("passes every reconciliation check on every step", () => {
    for (const x of r) expect(x.checks).toEqual(Object.fromEntries(Object.keys(x.checks).map((k) => [k, true])));
  });

  it("matches §8.2 daily P&L", () => {
    near(d0.navClose, 10000, 0.02); // 4.116555 ETH is rounded in the spec
    // interest, comp, gas, interestReval, compReval, priceEffect, pnl
    const rows: [CompoundStepResult, number, number, number, number, number, number, number][] = [
      [d1, 0.55, 0.14, -2.0, 0, 0, -37.94, -39.25],
      [d2, 0.52, 0.13, 0, -0.03, -0.01, -493.99, -493.38],
      [d3, 0.53, 0.13, 0, 0.03, 0.01, 288.16, 288.86],
      [d4, 0.55, 0.14, -1.5, 0.05, 0.02, 329.32, 328.58],
      [d5, 0.54, 0.14, -2.0, -0.05, 0, -205.83, -207.2],
    ];
    for (const [x, interest, comp, g, ir, cr, pe, pnl] of rows) {
      near(x.interval.interestIncome, interest);
      near(x.interval.compIncome, comp);
      near(x.interval.gasCost, g);
      near(x.interval.interestReval, ir);
      near(x.interval.compReval, cr);
      near(x.interval.priceEffect, pe, 0.02);
      near(x.interval.pnl, pnl, 0.03);
    }
  });

  it("treats withdrawn ETH and claimed COMP as capital out", () => {
    near(d4.interval.capitalOut, 0.013621 * 41); // COMP sold on day 4: $0.56
    near(d5.interval.capitalOut, 4.117682 * 2400 + 0.003383 * 40, 0.02);
    near(compoundNav(d5.state), -5.5); // only the gas paid remains
  });

  it("matches §8.3 reclassifications and §8.4 cumulative totals", () => {
    near(d4.reclassified.compRevalToRealised, 0.02);
    near(d5.reclassified.priceEffectToRealised, -120.28, 0.02);
    near(compoundUnrealisedTotal(d4.state), 85.6, 0.03);
    near(compoundRealisedTotal(d4.state), -0.79, 0.03);
    const s = d5.state;
    near(s.realised.interestIncome, 2.69);
    near(s.realised.compIncome, 0.68);
    near(s.realised.gasCost, -5.5);
    near(s.realised.priceEffect, -120.28, 0.02);
    near(compoundUnrealisedTotal(s), 0);
    near(compoundTotalPnl(s), -122.39, 0.03);
    expect(s.balance).toBe(0);
  });
});
