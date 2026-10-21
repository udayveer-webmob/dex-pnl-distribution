import { describe, expect, it } from "vitest";
import {
  type EngineState,
  type LiquidityEvent,
  type Observation,
  type PositionMeta,
  type StepResult,
  heldFeesValue,
  hodlValue,
  initialState,
  realisedTotal,
  step,
  totalPnl,
  unrealisedFeeReval,
  unrealisedTotal,
} from "./engine";
import { positionAmounts, sqrtPriceFromX96, sqrtPriceX96FromPrice0In1 } from "@/lib/uniswap/math";

// Spec §8: USDC/WETH 0.05% (token0 = USDC, token1 = WETH), USDC fixed at $1.
const D0 = 6;
const D1 = 18;
const ethTick = (ethPrice: number) => Math.log(1e12 / ethPrice) / Math.log(1.0001);
const snap = (t: number) => Math.round(t / 10) * 10;
const meta: PositionMeta = {
  tickLower: snap(ethTick(2700)), // max ETH price
  tickUpper: snap(ethTick(2199.57)), // min ETH price
  decimals0: D0,
  decimals1: D1,
};
const L = 2030747838324900n; // 2,030.75 in human units (L_raw / 10^12)

const sqrtX96 = (ethPrice: number) => sqrtPriceX96FromPrice0In1(1 / ethPrice, D0, D1);
const amountsAt = (liquidity: bigint, ethPrice: number) =>
  positionAmounts(liquidity, sqrtPriceFromX96(sqrtX96(ethPrice)), meta.tickLower, meta.tickUpper, D0, D1);

function obs(day: number, ethPrice: number, liquidity: bigint, feesEth = 0, feesUsdc = 0): Observation {
  return {
    block: day * 7200,
    timestamp: day * 86400,
    sqrtPriceX96: sqrtX96(ethPrice),
    tick: Math.round(ethTick(ethPrice)),
    liquidity,
    owed0: feesUsdc,
    owed1: feesEth,
    usd0: 1,
    usd1: ethPrice,
    ethUsd: ethPrice,
  };
}

const gas = (usd: number, ethPrice: number): LiquidityEvent => ({ kind: "gas", gasEth: usd / ethPrice });

// Illustrative fee path chosen to reproduce §8.2 fee income and revaluation:
// cumulative uncollected (ETH, USDC) at the end of each day.
const fees = {
  d1: [0.000583, 1.58914],
  d2: [0.001429, 1.84334],
  d3: [0.0015, 3.75507],
  d4: [0.00174, 5.05707],
  d5: [0.0003, 0.9], // after the day-4 collect
} as const;

function replay() {
  const results: StepResult[] = [];
  let s: EngineState = initialState();
  const push = (r: StepResult) => {
    results.push(r);
    s = r.state;
  };

  // Day 0: mint at $2,429.22 (observation before the event has no liquidity).
  const dep = amountsAt(L, 2429.22);
  push(
    step(s, meta, obs(0, 2429.22, 0n), [
      { kind: "increase", liquidity: L, amount0: dep.amount0, amount1: dep.amount1 },
    ]),
  );
  push(step(s, meta, obs(1, 2420, L, ...fees.d1), [gas(2, 2420)]));
  push(step(s, meta, obs(2, 2300, L, ...fees.d2)));
  push(step(s, meta, obs(3, 2370, L, ...fees.d3)));
  push(
    step(s, meta, obs(4, 2450, L, ...fees.d4), [
      { kind: "collect", amount0: fees.d4[1], amount1: fees.d4[0] },
      gas(1.5, 2450),
    ]),
  );
  const out = amountsAt(L, 2400);
  push(
    step(s, meta, obs(5, 2400, L, ...fees.d5), [
      { kind: "decrease", liquidity: L, amount0: out.amount0, amount1: out.amount1 },
      { kind: "collect", amount0: out.amount0, amount1: out.amount1 },
      gas(2, 2400),
    ]),
  );
  return results;
}

const near = (actual: number, expected: number, tol = 0.015) =>
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tol);

describe("Uniswap v3 maths (spec §4)", () => {
  it("reproduces the deposit split and range", () => {
    const a = amountsAt(L, 2429.22);
    near(a.amount1, 2.1207, 0.0001);
    near(a.amount0, 4848.39, 0.1); // spec rounds L and the range bounds
    near(1e12 / Math.pow(1.0001, meta.tickUpper), 2199.57, 0.5);
    near(1e12 / Math.pow(1.0001, meta.tickLower), 2700, 1.5);
  });
});

describe("P&L engine – spec §8 worked example", () => {
  const r = replay();
  const [d0, d1, d2, d3, d4, d5] = r;

  it("passes every reconciliation check on every step", () => {
    for (const x of r) expect(x.checks).toEqual(Object.fromEntries(Object.keys(x.checks).map((k) => [k, true])));
  });

  it("matches §8.1 state", () => {
    near(d0.state.value, 10000, 0.05);
    const table: [StepResult, number, number, number, number][] = [
      [d1, 2.1991, 4658.34, 9980.09, 9980.46],
      [d2, 3.2623, 2150.0, 9653.23, 9725.97],
      [d3, 2.6322, 3620.94, 9859.37, 9874.42],
      [d4, 1.9456, 5275.65, 10042.25, 10044.08],
    ];
    for (const [x, eth, usdc, value, hodl] of table) {
      near(x.state.amount1, eth, 0.0001);
      near(x.state.amount0, usdc, 0.05);
      near(x.state.value, value, 0.05);
      near(hodlValue(x.state), hodl, 0.05);
    }
    near(heldFeesValue(d1.state), 3.0);
  });

  it("matches §8.2 daily P&L", () => {
    // The spec keeps exited tokens in NAV; here they leave as capital out, so from the day-4
    // collect onwards NAV is lower by the cumulative capital out (§8.2 + capitalOut).
    const rows: [StepResult, number, number, number, number, number, number, number, number, number][] = [
      // open, fee, gas, reval, priceEffect, il, pnl, capitalOut, close
      [d1, 10000, 3.0, -2.0, 0, -19.54, -0.36, -18.9, 0, 9981.1],
      [d2, 9981.1, 2.2, 0, -0.07, -254.48, -72.39, -324.74, 0, 9656.36],
      [d3, 9656.36, 2.08, 0, 0.1, 148.45, 57.69, 208.32, 0, 9864.68],
      [d4, 9864.68, 1.89, -1.5, 0.12, 169.66, 13.23, 183.4, 9.32, 10048.08 - 9.32],
      [d5, 10048.08 - 9.32, 1.62, -2.0, 0, -106.03, -1.82, -108.23, 9934.4, 9939.85 - 9.32 - 9934.4],
    ];
    for (const [x, open, fee, g, reval, pe, il, pnl, out, close] of rows) {
      near(x.interval.capitalOut, out, 0.05);
      near(x.navOpen, open, 0.05);
      near(x.interval.feeIncome, fee);
      near(x.interval.gasCost, g);
      near(x.interval.feeReval, reval);
      near(x.interval.priceEffect, pe);
      near(x.interval.ilChange, il, 0.05);
      near(x.interval.pnl, pnl, 0.05);
      near(x.navClose, close, 0.05);
    }
  });

  it("matches §8.3 reclassifications", () => {
    near(d4.reclassified.feeRevalToRealised, 0.15);
    // 2.1207 × (2400 − 2429.22) = −61.97; the spec sums rounded daily figures to −61.94.
    near(d5.reclassified.priceEffectToRealised, -61.94, 0.03);
    near(d5.reclassified.ilToRealised, -3.65, 0.05);
  });

  it("matches §8.4 cumulative totals", () => {
    near(d2.state.unrealised.priceEffect, -274.02);
    near(d3.state.unrealised.il, -15.06, 0.05);
    near(unrealisedFeeReval(d3.state), 0.03);
    near(unrealisedTotal(d4.state), 42.26, 0.05);
    near(realisedTotal(d4.state), 5.82);

    const s = d5.state;
    near(s.realised.feeIncome, 10.79);
    near(s.realised.gasCost, -5.5);
    near(s.realised.feeReval, 0.15);
    near(s.realised.priceEffect + s.realised.il, -65.59, 0.05);
    near(unrealisedTotal(s), 0);
    near(totalPnl(s), -60.15, 0.05);
    expect(s.liquidity).toBe("0");
    near(s.owedPrincipal0, 0, 1e-9);
    near(s.owedPrincipal1, 0, 1e-12);
  });
});
