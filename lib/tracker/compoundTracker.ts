// Drives the Compound III supply engine for one position, mirroring the Uniswap tracker: day-end
// checkpoints split at every Supply / Withdraw / transfer / reward claim, resumed from Position.state.

import type { Address } from "viem";
import { db } from "@/lib/db";
import type { Position, Prisma, SnapshotKind, Wallet } from "@/lib/generated/prisma/client";
import { blockTimestamp } from "@/lib/chain/blocks";
import { chain } from "@/lib/chain/client";
import { type RawSupplyEvent, fetchSupplyEvents, readSupply, type SupplyRead } from "@/lib/compound/chain";
import { COMP_DECIMALS, type CometMarket, cometRewardsAbi, marketByComet } from "@/lib/compound/markets";
import {
  type CompoundEvent,
  type CompoundObservation,
  type CompoundState,
  type CompoundStepResult,
  compoundNetCapital,
  compoundRealisedTotal,
  compoundStep,
  compoundTotalPnl,
  compoundUnrealisedTotal,
  hodlValue,
  initialCompoundState,
  owedCompValue,
  positionValue,
} from "@/lib/pnl/compoundEngine";
import { utcDate } from "./snapshot";
import { type Checkpoint, type ProgressFn, buildCheckpoints, dayEndBlocks } from "./tracker";

export type CompoundPosition = Position & { wallet: Wallet; market: string };

export function asCompound(p: Position & { wallet: Wallet }): CompoundPosition {
  if (p.protocol !== "COMPOUND_V3" || !p.market) throw new Error(`Position ${p.id} is not a Compound III position`);
  return p as CompoundPosition;
}

const noProgress: ProgressFn = () => {};

/** Gas per tx, charged only when the wallet itself sent the transaction. */
type GasMap = Map<string, number>; // txHash → gas in ETH

async function fetchGas(events: RawSupplyEvent[], wallet: string, progress: ProgressFn = noProgress): Promise<GasMap> {
  const gas: GasMap = new Map();
  const txs = [...new Set(events.map((e) => e.txHash))];
  for (const [i, hash] of txs.entries()) {
    const r = await chain().getTransactionReceipt({ hash });
    gas.set(hash, r.from.toLowerCase() === wallet.toLowerCase() ? Number(r.gasUsed * r.effectiveGasPrice) / 1e18 : 0);
    await progress(1, i + 1, txs.length);
  }
  return gas;
}

async function observe(m: CometMarket, wallet: Address, block: bigint): Promise<{ obs: CompoundObservation; read: SupplyRead }> {
  const [read, ts] = await Promise.all([readSupply(m, wallet, block), blockTimestamp(block)]);
  if (read.principalRaw < 0n) throw new Error("Wallet is borrowing from this market; borrow positions are out of scope");
  return {
    read,
    obs: {
      block: Number(block),
      timestamp: ts,
      balance: read.balance,
      owedComp: read.owedComp,
      baseUsd: read.baseUsd,
      compUsd: read.compUsd,
      ethUsd: read.baseUsd, // WETH market
    },
  };
}

/** Engine events for one block. A reward claim counts only if this market's claimed counter moved. */
async function toEngineEvents(
  m: CometMarket,
  wallet: Address,
  cp: Checkpoint<RawSupplyEvent>,
  claimedBefore: number,
  gas: GasMap,
): Promise<CompoundEvent[]> {
  const out: CompoundEvent[] = [];
  const charged = new Set<string>();
  let claimedInBlock: number | null = null;
  for (const e of cp.events) {
    const amount = Number(e.amount) / 10 ** m.baseDecimals;
    let applied = true;
    if (e.type === "SUPPLY" || e.type === "TRANSFER_IN") out.push({ kind: "supply", amount });
    else if (e.type === "WITHDRAW" || e.type === "TRANSFER_OUT") out.push({ kind: "withdraw", amount });
    else {
      // RewardClaimed has no market field; take this market's share from its rewardsClaimed counter.
      if (claimedInBlock === null) {
        const after = await chain().readContract({
          address: m.rewards,
          abi: cometRewardsAbi,
          functionName: "rewardsClaimed",
          args: [m.comet, wallet],
          blockNumber: cp.block,
        });
        claimedInBlock = Number(after) / 10 ** COMP_DECIMALS - claimedBefore;
        if (claimedInBlock > 1e-12) out.push({ kind: "claim", amount: claimedInBlock });
      }
      applied = claimedInBlock > 1e-12;
    }
    if (applied && !charged.has(e.txHash)) {
      charged.add(e.txHash);
      const g = gas.get(e.txHash) ?? 0;
      if (g > 0) out.push({ kind: "gas", gasEth: g });
    }
  }
  return out;
}

export interface CompoundReplayStep {
  cp: Checkpoint<RawSupplyEvent>;
  ts: number;
  read: SupplyRead;
  result: CompoundStepResult;
}

export async function* replayCompound(
  p: CompoundPosition,
  state: CompoundState,
  checkpoints: Checkpoint<RawSupplyEvent>[],
  gas: GasMap,
  progress: ProgressFn = noProgress,
): AsyncGenerator<CompoundReplayStep> {
  const m = marketByComet(p.market);
  const wallet = p.wallet.address as Address;
  for (const [i, cp] of checkpoints.entries()) {
    await progress(3, i, checkpoints.length);
    const { obs, read } = await observe(m, wallet, cp.obsBlock);
    const events = await toEngineEvents(m, wallet, cp, read.claimedComp, gas);
    const result = compoundStep(state, obs, events);
    state = result.state;
    const ts = cp.block === cp.obsBlock ? obs.timestamp : await blockTimestamp(cp.block);
    yield { cp, ts, read, result };
  }
  await progress(3, checkpoints.length, checkpoints.length);
}

/** Events and checkpoints from `lastBlock` (or the first supply) up to `head`. */
export async function compoundCheckpoints(
  p: CompoundPosition,
  lastBlock: bigint | null,
  head: bigint,
  progress: ProgressFn = noProgress,
) {
  const m = marketByComet(p.market);
  const wallet = p.wallet.address as Address;
  await progress(0, 0, null);
  let events: RawSupplyEvent[];
  let from: bigint;
  if (lastBlock === null) {
    events = await fetchSupplyEvents(m, wallet, m.deployBlock, head);
    const first = events.find((e) => e.type === "SUPPLY" || e.type === "TRANSFER_IN");
    if (!first) throw new Error("No supply found for this wallet in the market");
    events = events.filter((e) => e.block >= first.block);
    from = first.block - 1n;
  } else {
    events = await fetchSupplyEvents(m, wallet, lastBlock + 1n, head);
    from = lastBlock;
  }
  await progress(0, events.length, events.length);
  const gas = await fetchGas(events, wallet, progress);
  const dayEnds = (await dayEndBlocks(await blockTimestamp(from), await blockTimestamp(head), head, progress)).filter(
    (b) => b > from,
  );
  return { events, gas, from, dayEnds, checkpoints: buildCheckpoints(events, dayEnds) };
}

export function compoundSnapshotRow(
  positionId: string,
  kind: SnapshotKind,
  block: bigint,
  timestamp: number,
  r: CompoundStepResult,
): Prisma.SnapshotCreateManyInput {
  const s = r.state;
  return {
    positionId,
    kind,
    block,
    timestamp: new Date(timestamp * 1000),
    date: utcDate(timestamp),
    sqrtPriceX96: "0",
    tick: 0,
    liquidity: s.balance.toString(),
    inRange: true,
    usd0: s.baseUsd,
    usd1: s.compUsd,
    amount0: s.balance,
    amount1: 0,
    positionValue: positionValue(s),
    hodl0: s.principal,
    hodl1: 0,
    hodlValue: hodlValue(s),
    heldFees0: s.owedComp,
    heldFees1: 0,
    heldFeesValue: owedCompValue(s),
    costBasis: s.costBasis,
    navOpen: r.navOpen,
    nav: r.navClose,
    // Interest maps onto the fee fields, COMP onto the reward fields; no impermanent loss.
    feeIncome: r.interval.interestIncome,
    gasCost: r.interval.gasCost,
    feeReval: r.interval.interestReval,
    priceEffect: r.interval.priceEffect,
    ilChange: 0,
    capitalIn: r.interval.capitalIn,
    capitalOut: r.interval.capitalOut,
    pnl: r.interval.pnl,
    rewardIncome: r.interval.compIncome,
    rewardReval: r.interval.compReval,
    feeRevalToRealised: r.reclassified.interestRevalToRealised,
    priceEffectToRealised: r.reclassified.priceEffectToRealised,
    ilToRealised: 0,
    rewardRevalToRealised: r.reclassified.compRevalToRealised,
    rFeeIncome: s.realised.interestIncome,
    rGasCost: s.realised.gasCost,
    rFeeReval: s.realised.interestReval,
    rPriceEffect: s.realised.priceEffect,
    rIl: 0,
    rRewardIncome: s.realised.compIncome,
    rRewardReval: s.realised.compReval,
    realisedTotal: compoundRealisedTotal(s),
    uPriceEffect: s.unrealised.priceEffect,
    uIl: 0,
    uFeeReval: s.unrealised.interestReval,
    uRewardReval: s.unrealised.compReval,
    unrealisedTotal: compoundUnrealisedTotal(s),
    totalPnl: compoundTotalPnl(s),
    netCapital: compoundNetCapital(s),
    checksOk: r.checksOk,
    checks: { ...r.checks },
    state: s as unknown as Prisma.InputJsonValue,
  };
}

async function storeEvents(p: CompoundPosition, events: RawSupplyEvent[]) {
  const data = [];
  for (const e of events) {
    data.push({
      positionId: p.id,
      type: e.type,
      block: e.block,
      logIndex: e.logIndex,
      txHash: e.txHash,
      timestamp: new Date((await blockTimestamp(e.block)) * 1000),
      liquidity: null,
      amount0: e.amount.toString(),
      amount1: "0",
      gasUsed: null,
      effectiveGasPrice: null,
    });
  }
  if (data.length) await db().positionEvent.createMany({ data, skipDuplicates: true });
}

/** Bring a tracked Compound III position up to `head`. Returns true when fully withdrawn and claimed. */
export async function advanceCompound(positionId: string, head: bigint, progress: ProgressFn = noProgress): Promise<boolean> {
  const p = asCompound(await db().position.findUniqueOrThrow({ where: { id: positionId }, include: { wallet: true } }));
  if (p.lastBlock !== null && head <= p.lastBlock) return false;
  let state = (p.state as unknown as CompoundState | null) ?? initialCompoundState();

  const { events, gas, from, checkpoints } = await compoundCheckpoints(p, p.lastBlock, head, progress);
  if (p.lastBlock === null) await db().position.update({ where: { id: p.id }, data: { mintBlock: from + 1n } });
  await storeEvents(p, events);

  let lastRead: SupplyRead | null = null;
  for await (const { cp, ts, read, result } of replayCompound(p, state, checkpoints, gas, progress)) {
    lastRead = read;
    state = result.state;
    await db().$transaction([
      db().snapshot.create({ data: compoundSnapshotRow(p.id, cp.kind, cp.block, ts, result) }),
      db().position.update({ where: { id: p.id }, data: { state: state as object, lastBlock: cp.block, lastError: null } }),
    ]);
  }
  return lastRead !== null && lastRead.balance < 1e-12 && lastRead.owedComp < 1e-9;
}
