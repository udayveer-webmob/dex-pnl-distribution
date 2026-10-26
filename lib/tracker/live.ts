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
import { buildCheckpoints, dayEndBlocks, fetchGas, replay } from "./tracker";

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
  };
}

const minus = (a: PnlBreakdownDto, b: PnlBreakdownDto): PnlBreakdownDto => ({
  total: a.total - b.total,
  feeIncome: a.feeIncome - b.feeIncome,
  gasCost: a.gasCost - b.gasCost,
  feeReval: a.feeReval - b.feeReval,
  priceEffect: a.priceEffect - b.priceEffect,
  il: a.il - b.il,
});

export async function livePositionPnl(positionId: string): Promise<LivePnlDto> {
  const p = await db().position.findUniqueOrThrow({ where: { id: positionId }, include: { pool: true } });
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
  const open = openState ? breakdown(openState) : breakdown({ ...state, ...zeroTotals });
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

const zeroTotals: Pick<EngineState, "realised" | "unrealised"> = {
  realised: { feeIncome: 0, gasCost: 0, feeReval: 0, priceEffect: 0, il: 0 },
  unrealised: { priceEffect: 0, il: 0, feeReval0: 0, feeReval1: 0 },
};
