// On-chain reads and events for a wallet's Compound III supply position. All reads for one
// observation use the same block (spec §3).

import type { Address, Hash } from "viem";
import { chain } from "@/lib/chain/client";
import { COMP_DECIMALS, type CometMarket, chainlinkAbi, cometAbi, cometRewardsAbi } from "./markets";

export interface SupplyRead {
  block: bigint;
  balance: number; // human units, incl. interest
  principalRaw: bigint; // userBasic.principal (negative = borrower)
  owedComp: number;
  claimedComp: number;
  baseUsd: number;
  compUsd: number;
}

async function chainlinkUsd(feed: Address, blockNumber: bigint): Promise<number> {
  const r = await chain().readContract({ address: feed, abi: chainlinkAbi, functionName: "latestRoundData", blockNumber });
  return Number(r[1]) / 1e8; // ETH/USD and COMP/USD feeds have 8 decimals
}

export async function readSupply(m: CometMarket, wallet: Address, blockNumber: bigint): Promise<SupplyRead> {
  const c = chain();
  const [balance, basic, owed, claimed, baseUsd, compUsd] = await Promise.all([
    c.readContract({ address: m.comet, abi: cometAbi, functionName: "balanceOf", args: [wallet], blockNumber }),
    c.readContract({ address: m.comet, abi: cometAbi, functionName: "userBasic", args: [wallet], blockNumber }),
    c.readContract({ address: m.rewards, abi: cometRewardsAbi, functionName: "getRewardOwed", args: [m.comet, wallet], blockNumber }),
    c.readContract({ address: m.rewards, abi: cometRewardsAbi, functionName: "rewardsClaimed", args: [m.comet, wallet], blockNumber }),
    chainlinkUsd(m.baseUsdFeed, blockNumber),
    chainlinkUsd(m.compUsdFeed, blockNumber),
  ]);
  return {
    block: blockNumber,
    balance: Number(balance) / 10 ** m.baseDecimals,
    principalRaw: basic[0],
    owedComp: Number(owed.owed) / 10 ** COMP_DECIMALS,
    claimedComp: Number(claimed) / 10 ** COMP_DECIMALS,
    baseUsd,
    compUsd,
  };
}

/** Current supply APR (display only; P&L uses measured balance changes). */
export async function supplyApr(m: CometMarket, blockNumber?: bigint): Promise<number> {
  const c = chain();
  const util = await c.readContract({ address: m.comet, abi: cometAbi, functionName: "getUtilization", blockNumber });
  const rate = await c.readContract({ address: m.comet, abi: cometAbi, functionName: "getSupplyRate", args: [util], blockNumber });
  return (Number(rate) / 1e18) * 31_536_000;
}

export type SupplyEventType = "SUPPLY" | "WITHDRAW" | "TRANSFER_IN" | "TRANSFER_OUT" | "REWARD_CLAIM";

export interface RawSupplyEvent {
  type: SupplyEventType;
  block: bigint;
  logIndex: number;
  txHash: Hash;
  amount: bigint; // base units, or COMP units for REWARD_CLAIM
}

const ZERO = "0x0000000000000000000000000000000000000000";
const isRangeError = (e: unknown) =>
  /range|limit|too many|exceed|10000|timeout|size/i.test(e instanceof Error ? e.message : String(e));

/**
 * Supply / Withdraw / balance transfers on the Comet, and RewardClaimed on CometRewards, for one
 * wallet, sorted by (block, logIndex). RewardClaimed has no market field, so a claim is only applied
 * if this market's rewardsClaimed counter actually moved (see the tracker).
 */
export async function fetchSupplyEvents(
  m: CometMarket,
  wallet: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawSupplyEvent[]> {
  if (fromBlock > toBlock) return [];
  const c = chain();
  try {
    const [supplies, withdraws, transfersIn, transfersOut, claims] = await Promise.all([
      c.getContractEvents({ address: m.comet, abi: cometAbi, eventName: "Supply", args: { dst: wallet }, fromBlock, toBlock }),
      c.getContractEvents({ address: m.comet, abi: cometAbi, eventName: "Withdraw", args: { src: wallet }, fromBlock, toBlock }),
      c.getContractEvents({ address: m.comet, abi: cometAbi, eventName: "Transfer", args: { to: wallet }, fromBlock, toBlock }),
      c.getContractEvents({ address: m.comet, abi: cometAbi, eventName: "Transfer", args: { from: wallet }, fromBlock, toBlock }),
      c.getContractEvents({ address: m.rewards, abi: cometRewardsAbi, eventName: "RewardClaimed", args: { src: wallet }, fromBlock, toBlock }),
    ]);
    const out: RawSupplyEvent[] = [];
    const push = (type: SupplyEventType, l: { blockNumber: bigint; logIndex: number; transactionHash: Hash }, amount: bigint) =>
      out.push({ type, block: l.blockNumber, logIndex: l.logIndex, txHash: l.transactionHash, amount });
    for (const l of supplies) push("SUPPLY", l, l.args.amount!);
    for (const l of withdraws) push("WITHDRAW", l, l.args.amount!);
    // Supply/Withdraw also emit Transfer to/from the zero address; only wallet-to-wallet moves count here.
    for (const l of transfersIn) if (l.args.from !== ZERO) push("TRANSFER_IN", l, l.args.amount!);
    for (const l of transfersOut) if (l.args.to !== ZERO) push("TRANSFER_OUT", l, l.args.amount!);
    for (const l of claims) push("REWARD_CLAIM", l, l.args.amount!);
    return out.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  } catch (e) {
    if (!isRangeError(e) || toBlock - fromBlock < 10n) throw e;
    const mid = (fromBlock + toBlock) / 2n;
    const [a, b] = await Promise.all([
      fetchSupplyEvents(m, wallet, fromBlock, mid),
      fetchSupplyEvents(m, wallet, mid + 1n, toBlock),
    ]);
    return [...a, ...b];
  }
}
