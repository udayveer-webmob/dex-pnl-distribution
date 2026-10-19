import type { Prisma, SnapshotKind } from "@/lib/generated/prisma/client";
import {
  type StepResult,
  heldFeesValue,
  hodlValue,
  netCapital,
  realisedTotal,
  totalPnl,
  unrealisedFeeReval,
  unrealisedTotal,
} from "@/lib/pnl/engine";

export const utcDate = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

/** Flatten an engine step into a Snapshot row. */
export function snapshotRow(
  positionId: string,
  kind: SnapshotKind,
  block: bigint,
  timestamp: number,
  inRange: boolean,
  r: StepResult,
): Prisma.SnapshotCreateManyInput {
  const s = r.state;
  return {
    positionId,
    kind,
    block,
    timestamp: new Date(timestamp * 1000),
    date: utcDate(timestamp),
    sqrtPriceX96: s.sqrtPriceX96,
    tick: s.tick,
    liquidity: s.liquidity,
    inRange,
    usd0: s.usd0,
    usd1: s.usd1,
    amount0: s.amount0,
    amount1: s.amount1,
    positionValue: s.value,
    hodl0: s.hodl0,
    hodl1: s.hodl1,
    hodlValue: hodlValue(s),
    heldFees0: s.heldFees0,
    heldFees1: s.heldFees1,
    heldFeesValue: heldFeesValue(s),
    costBasis: s.costBasis,
    navOpen: r.navOpen,
    nav: r.navClose,
    ...r.interval,
    ...r.reclassified,
    rFeeIncome: s.realised.feeIncome,
    rGasCost: s.realised.gasCost,
    rFeeReval: s.realised.feeReval,
    rPriceEffect: s.realised.priceEffect,
    rIl: s.realised.il,
    realisedTotal: realisedTotal(s),
    uPriceEffect: s.unrealised.priceEffect,
    uIl: s.unrealised.il,
    uFeeReval: unrealisedFeeReval(s),
    unrealisedTotal: unrealisedTotal(s),
    totalPnl: totalPnl(s),
    netCapital: netCapital(s),
    checksOk: r.checksOk,
    checks: { ...r.checks },
    state: s as unknown as Prisma.InputJsonValue,
  };
}
