// Drives the P&L engine for one position: replays history as daily checkpoints (split at every
// liquidity event), then appends a live POLL snapshot at the chain head. The same routine runs
// for the first backfill and for every 2-minute poll; it always resumes from Position.state.

import type { Address } from "viem";
import { db } from "@/lib/db";
import type { Pool, Position, SnapshotKind } from "@/lib/generated/prisma/client";
import { V3_DEPLOY_BLOCK } from "@/lib/chain/abis";
import { blockAtOrBefore, blockTimestamp } from "@/lib/chain/blocks";
import { type RawPositionEvent, fetchPositionEvents, txGas } from "@/lib/chain/events";
import { readPoolPosition } from "@/lib/chain/positions";
import { ETH, usdPrice } from "@/lib/prices/coingecko";
import { isWeth } from "@/lib/prices/reference";
import {
  type EngineState,
  type LiquidityEvent,
  type Observation,
  type PositionMeta,
  initialState,
  step,
} from "@/lib/pnl/engine";
import { deriveUsdPrices, sqrtPriceFromX96, toHuman } from "@/lib/uniswap/math";
import { snapshotRow } from "./snapshot";

type TrackedPosition = Position & { pool: Pool };

export const STEPS = ["Fetching liquidity events", "Fetching gas receipts", "Finding day boundaries", "Replaying snapshots"] as const;

/** Called as work progresses: `step` is an index into STEPS, `total` is null when unknown. */
export type ProgressFn = (step: number, done: number, total: number | null) => void | Promise<void>;

const noProgress: ProgressFn = () => {};

interface Checkpoint {
  kind: SnapshotKind;
  block: bigint; // block the snapshot is labelled with
  obsBlock: bigint; // block the pool/position is read at (block − 1 for events)
  events: RawPositionEvent[];
}

const metaOf = (p: TrackedPosition): PositionMeta => ({
  tickLower: p.tickLower,
  tickUpper: p.tickUpper,
  decimals0: p.pool.token0Decimals,
  decimals1: p.pool.token1Decimals,
});

async function observe(p: TrackedPosition, block: bigint) {
  const read = await readPoolPosition(
    p.pool.address as Address,
    BigInt(p.tokenId),
    p.tickLower,
    p.tickUpper,
    block,
  );
  const ts = await blockTimestamp(block);
  const ref = p.pool.refToken as 0 | 1;
  const refUsd = await usdPrice(ref === 0 ? p.pool.token0 : p.pool.token1, ts);
  const { usd0, usd1 } = deriveUsdPrices(
    sqrtPriceFromX96(read.sqrtPriceX96),
    p.pool.token0Decimals,
    p.pool.token1Decimals,
    ref,
    refUsd,
  );
  const ethUsd = isWeth(p.pool.token0) ? usd0 : isWeth(p.pool.token1) ? usd1 : await usdPrice(ETH, ts);

  const obs: Observation = {
    block: Number(block),
    timestamp: ts,
    sqrtPriceX96: read.sqrtPriceX96,
    tick: read.tick,
    liquidity: read.liquidity,
    owed0: toHuman(read.owed0, p.pool.token0Decimals),
    owed1: toHuman(read.owed1, p.pool.token1Decimals),
    usd0,
    usd1,
    ethUsd,
  };
  return { obs, read };
}

/** Engine events for one block; gas is charged once per transaction. */
async function toEngineEvents(p: TrackedPosition, raw: RawPositionEvent[]): Promise<LiquidityEvent[]> {
  const d0 = p.pool.token0Decimals;
  const d1 = p.pool.token1Decimals;
  const out: LiquidityEvent[] = [];
  const charged = new Set<string>();
  for (const e of raw) {
    const amount0 = toHuman(e.amount0, d0);
    const amount1 = toHuman(e.amount1, d1);
    if (e.type === "INCREASE") out.push({ kind: "increase", liquidity: e.liquidity ?? 0n, amount0, amount1 });
    else if (e.type === "DECREASE") out.push({ kind: "decrease", liquidity: e.liquidity ?? 0n, amount0, amount1 });
    else out.push({ kind: "collect", amount0, amount1 });

    if (!charged.has(e.txHash)) {
      charged.add(e.txHash);
      const stored = await db().positionEvent.findUnique({
        where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
      });
      const gasUsed = BigInt(stored?.gasUsed ?? 0);
      const price = BigInt(stored?.effectiveGasPrice ?? 0);
      out.push({ kind: "gas", gasEth: Number(gasUsed * price) / 1e18 });
    }
  }
  return out;
}

async function storeEvents(p: TrackedPosition, events: RawPositionEvent[], progress: ProgressFn) {
  const receipts = new Map<string, { gasUsed: bigint; effectiveGasPrice: bigint }>();
  const txCount = new Set(events.map((e) => e.txHash)).size;
  for (const e of events) {
    if (receipts.has(e.txHash)) continue;
    receipts.set(e.txHash, await txGas(e.txHash));
    await progress(1, receipts.size, txCount);
  }
  const data = [];
  for (const e of events) {
    const gas = receipts.get(e.txHash)!;
    data.push({
      positionId: p.id,
      type: e.type,
      block: e.block,
      logIndex: e.logIndex,
      txHash: e.txHash,
      timestamp: new Date((await blockTimestamp(e.block)) * 1000),
      liquidity: e.liquidity?.toString() ?? null,
      amount0: e.amount0.toString(),
      amount1: e.amount1.toString(),
      gasUsed: gas.gasUsed.toString(),
      effectiveGasPrice: gas.effectiveGasPrice.toString(),
    });
  }
  if (data.length) await db().positionEvent.createMany({ data, skipDuplicates: true });
}

/** Last block of each UTC day that ends in (fromTs, toTs]. */
async function dayEndBlocks(fromTs: number, toTs: number, head: bigint, progress: ProgressFn): Promise<bigint[]> {
  const blocks: bigint[] = [];
  const first = (Math.floor(fromTs / 86400) + 1) * 86400;
  const total = Math.max(0, Math.floor((toTs - first) / 86400) + 1);
  for (let midnight = first; midnight <= toTs; midnight += 86400) {
    blocks.push(await blockAtOrBefore(midnight - 1, head));
    await progress(2, blocks.length, total);
  }
  return blocks;
}

function buildCheckpoints(events: RawPositionEvent[], dayEnds: bigint[], head: bigint): Checkpoint[] {
  const byBlock = new Map<bigint, RawPositionEvent[]>();
  for (const e of events) byBlock.set(e.block, [...(byBlock.get(e.block) ?? []), e]);

  const cps: Checkpoint[] = [
    ...[...byBlock].map(([block, evs]) => ({ kind: "EVENT" as const, block, obsBlock: block - 1n, events: evs })),
    ...dayEnds.map((block) => ({ kind: "DAILY" as const, block, obsBlock: block, events: [] })),
  ];
  // At the same block the event goes first, so the day-end read sees post-event liquidity.
  cps.sort((a, b) => (a.block === b.block ? (a.kind === "EVENT" ? -1 : 1) : a.block < b.block ? -1 : 1));

  const last = cps[cps.length - 1];
  if (!last || last.block < head) cps.push({ kind: "POLL", block: head, obsBlock: head, events: [] });
  return cps;
}

/** Bring a tracked position up to `head`. Returns true when the position is fully closed. */
export async function advancePosition(
  positionId: string,
  head: bigint,
  progress: ProgressFn = noProgress,
): Promise<boolean> {
  const p = await db().position.findUniqueOrThrow({ where: { id: positionId }, include: { pool: true } });
  const tokenId = BigInt(p.tokenId);
  let state: EngineState = (p.state as unknown as EngineState | null) ?? initialState();
  let lastBlock = p.lastBlock;

  let events: RawPositionEvent[];
  if (lastBlock !== null && head <= lastBlock) return false;
  await progress(0, 0, null);
  if (lastBlock === null) {
    events = await fetchPositionEvents(tokenId, V3_DEPLOY_BLOCK, head);
    if (!events.length) throw new Error(`No liquidity events found for position #${p.tokenId}`);
    lastBlock = events[0].block - 1n;
    await db().position.update({ where: { id: p.id }, data: { mintBlock: events[0].block } });
  } else {
    events = await fetchPositionEvents(tokenId, lastBlock + 1n, head);
  }
  await progress(0, events.length, events.length);
  await storeEvents(p, events, progress);

  const dayEnds = await dayEndBlocks(await blockTimestamp(lastBlock), await blockTimestamp(head), head, progress);
  const checkpoints = buildCheckpoints(
    events,
    dayEnds.filter((b) => b > lastBlock!),
    head,
  );

  const meta = metaOf(p);
  let lastRead: Awaited<ReturnType<typeof observe>>["read"] | null = null;
  for (const [i, cp] of checkpoints.entries()) {
    await progress(3, i, checkpoints.length);
    const { obs, read } = await observe(p, cp.obsBlock);
    lastRead = read;
    const result = step(state, meta, obs, await toEngineEvents(p, cp.events));
    state = result.state;

    const ts = cp.block === cp.obsBlock ? obs.timestamp : await blockTimestamp(cp.block);
    const inRange = obs.tick >= p.tickLower && obs.tick < p.tickUpper;
    await db().$transaction([
      db().snapshot.create({ data: snapshotRow(p.id, cp.kind, cp.block, ts, inRange, result) }),
      db().position.update({
        where: { id: p.id },
        data: { state: state as object, lastBlock: cp.block, lastError: null },
      }),
    ]);
  }
  await progress(3, checkpoints.length, checkpoints.length);

  return state.liquidity === "0" && lastRead !== null && lastRead.owed0 === 0n && lastRead.owed1 === 0n;
}
