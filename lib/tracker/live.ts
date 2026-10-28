// Live P&L, computed on demand and never stored: replays the engine from the position's last stored
// state through any events and day ends the worker hasn't recorded yet, then observes the chain head.

import { db } from "@/lib/db";
import { chain } from "@/lib/chain/client";
import { blockTimestamp } from "@/lib/chain/blocks";
import { fetchPositionEvents } from "@/lib/chain/events";
import {
  type EngineState,
  heldFeesValue,
  nav,
  netCapital,
  realisedTotal,
  totalPnl,
  unrealisedFeeReval,
  unrealisedTotal,
} from "@/lib/pnl/engine";
import type { LivePnlDto, PnlBreakdownDto } from "@/lib/pnl/types";
import { asUniswap, buildCheckpoints, dayEndBlocks, fetchGas, replay } from "./tracker";
import { asCompound, compoundCheckpoints, replayCompound } from "./compoundTracker";
import { supplyApr } from "@/lib/compound/chain";
import { marketByComet } from "@/lib/compound/markets";
import {
  type CompoundState,
  compoundNav,
  compoundNetCapital,
  compoundRealisedTotal,
  compoundTotalPnl,
  compoundUnrealisedTotal,
  owedCompValue,
  positionValue,
} from "@/lib/pnl/compoundEngine";

/** A position further behind than this must be caught up by the worker first. */
const MAX_DAYS_BEHIND = 7;

export class LiveUnavailable extends Error {}

function breakdown(s: EngineState): PnlBreakdownDto {
  return {
    total: totalPnl(s),
    feeIncome: s.realised.feeIncome,
    gasCost: s.realised.gasCost,
    feeReval: s.realised.feeReval + unrealisedFeeReval(s),
    priceEffect: s.realised.priceEffect + s.unrealised.priceEffect,
    il: s.realised.il + s.unrealised.il,
    rewardIncome: 0,
    rewardReval: 0,
  };
}

function compoundBreakdown(s: CompoundState): PnlBreakdownDto {
  return {
    total: compoundTotalPnl(s),
    feeIncome: s.realised.interestIncome,
    gasCost: s.realised.gasCost,
    feeReval: s.realised.interestReval + s.unrealised.interestReval,
    priceEffect: s.realised.priceEffect + s.unrealised.priceEffect,
    il: 0,
    rewardIncome: s.realised.compIncome,
    rewardReval: s.realised.compReval + s.unrealised.compReval,
  };
}

const minus = (a: PnlBreakdownDto, b: PnlBreakdownDto): PnlBreakdownDto =>
  Object.fromEntries(Object.keys(a).map((k) => [k, a[k as keyof PnlBreakdownDto] - b[k as keyof PnlBreakdownDto]])) as unknown as PnlBreakdownDto;

const ZERO_BREAKDOWN: PnlBreakdownDto = {
  total: 0,
  feeIncome: 0,
  gasCost: 0,
  feeReval: 0,
  priceEffect: 0,
  il: 0,
  rewardIncome: 0,
  rewardReval: 0,
};

/** Live P&L for any tracked position. */
export async function livePositionPnl(positionId: string): Promise<LivePnlDto> {
  const { protocol } = await db().position.findUniqueOrThrow({ where: { id: positionId }, select: { protocol: true } });
  return protocol === "COMPOUND_V3" ? liveCompoundPnl(positionId) : liveUniswapPnl(positionId);
}

async function liveCompoundPnl(positionId: string): Promise<LivePnlDto> {
  const p = asCompound(await db().position.findUniqueOrThrow({ where: { id: positionId }, include: { wallet: true } }));
  if (!p.state || p.lastBlock === null) throw new LiveUnavailable("Position has not been backfilled yet");
  const stored = p.state as unknown as CompoundState;

  const head = (await chain().getBlockNumber()) - 2n;
  const [fromTs, headTs] = await Promise.all([blockTimestamp(p.lastBlock), blockTimestamp(head)]);
  const daysBehind = Math.floor(headTs / 86400) - Math.floor(fromTs / 86400);
  if (daysBehind > MAX_DAYS_BEHIND) {
    throw new LiveUnavailable(`Last recorded ${daysBehind} days ago. Track the position so the worker catches up first.`);
  }

  const { events, gas, dayEnds, checkpoints } = await compoundCheckpoints(p, p.lastBlock, head);
  checkpoints.push({ kind: "POLL", block: head, obsBlock: head, events: [] });

  const todayStart = Math.floor(headTs / 86400) * 86400;
  let openState: CompoundState | null = null;
  if (fromTs < todayStart) {
    openState = stored;
  } else {
    const before = await db().snapshot.findFirst({
      where: { positionId, timestamp: { lt: new Date(todayStart * 1000) } },
      orderBy: { seq: "desc" },
      select: { state: true },
    });
    openState = (before?.state as unknown as CompoundState | null) ?? null;
  }

  let state = stored;
  let checksOk = true;
  for await (const s of replayCompound(p, stored, checkpoints, gas)) {
    state = s.result.state;
    checksOk &&= s.result.checksOk;
    if (s.ts < todayStart) openState = state;
  }

  const now = compoundBreakdown(state);
  const open = openState ? compoundBreakdown(openState) : ZERO_BREAKDOWN;
  return {
    asOf: new Date(headTs * 1000).toISOString(),
    block: head.toString(),
    status: p.status,
    unrecordedEvents: events.length,
    unrecordedDays: dayEnds.length,
    usd0: state.baseUsd,
    usd1: state.compUsd,
    inRange: true,
    amount0: state.balance,
    amount1: 0,
    positionValue: positionValue(state),
    heldFees0: state.owedComp,
    heldFees1: 0,
    heldFeesValue: owedCompValue(state),
    nav: compoundNav(state),
    netCapital: compoundNetCapital(state),
    realised: compoundRealisedTotal(state),
    unrealised: compoundUnrealisedTotal(state),
    totals: now,
    today: { date: new Date(todayStart * 1000).toISOString().slice(0, 10), ...minus(now, open) },
    sinceLastSnapshot: minus(now, compoundBreakdown(stored)),
    checksOk,
    supplyApr: await supplyApr(marketByComet(p.market), head),
  };
}

export async function liveUniswapPnl(positionId: string): Promise<LivePnlDto> {
  const p = asUniswap(await db().position.findUniqueOrThrow({ where: { id: positionId }, include: { pool: true } }));
  if (!p.state || p.lastBlock === null) throw new LiveUnavailable("Position has not been backfilled yet");
  const stored = p.state as unknown as EngineState;

  const head = (await chain().getBlockNumber()) - 2n;
  const from = p.lastBlock;
  const [fromTs, headTs] = await Promise.all([blockTimestamp(from), blockTimestamp(head)]);
  const daysBehind = Math.floor(headTs / 86400) - Math.floor(fromTs / 86400);
  if (daysBehind > MAX_DAYS_BEHIND) {
    throw new LiveUnavailable(`Last recorded ${daysBehind} days ago. Track the position so the worker catches up first.`);
  }

  const events = head > from ? await fetchPositionEvents(BigInt(p.tokenId), from + 1n, head) : [];
  const gas = await fetchGas(events);
  const dayEnds = (await dayEndBlocks(fromTs, headTs, head)).filter((b) => b > from);
  const checkpoints = buildCheckpoints(events, dayEnds);
  checkpoints.push({ kind: "POLL", block: head, obsBlock: head, events: [] });

  // Today's P&L so far is measured from the state at the end of yesterday (UTC).
  const todayStart = Math.floor(headTs / 86400) * 86400;
  let openState: EngineState | null = null;
  if (fromTs < todayStart) {
    openState = stored;
  } else {
    const before = await db().snapshot.findFirst({
      where: { positionId, timestamp: { lt: new Date(todayStart * 1000) } },
      orderBy: { seq: "desc" },
      select: { state: true },
    });
    openState = (before?.state as unknown as EngineState | null) ?? null;
  }

  let state = stored;
  let inRange = false;
  let checksOk = true;
  for await (const s of replay(p, stored, checkpoints, gas)) {
    state = s.result.state;
    inRange = s.inRange;
    checksOk &&= s.result.checksOk;
    if (s.ts < todayStart) openState = state;
  }

  const now = breakdown(state);
  const open = openState ? breakdown(openState) : ZERO_BREAKDOWN;
  return {
    asOf: new Date(headTs * 1000).toISOString(),
    block: head.toString(),
    status: p.status,
    unrecordedEvents: events.length,
    unrecordedDays: dayEnds.length,
    usd0: state.usd0,
    usd1: state.usd1,
    inRange,
    amount0: state.amount0,
    amount1: state.amount1,
    positionValue: state.value,
    heldFees0: state.heldFees0,
    heldFees1: state.heldFees1,
    heldFeesValue: heldFeesValue(state),
    nav: nav(state),
    netCapital: netCapital(state),
    realised: realisedTotal(state),
    unrealised: unrealisedTotal(state),
    totals: now,
    today: { date: new Date(todayStart * 1000).toISOString().slice(0, 10), ...minus(now, open) },
    sinceLastSnapshot: minus(now, breakdown(stored)),
    checksOk,
  };
}
