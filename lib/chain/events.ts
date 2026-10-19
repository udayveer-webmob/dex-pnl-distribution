import type { Hash } from "viem";
import { chain } from "./client";
import { NPM_ADDRESS, npmAbi } from "./abis";

export interface RawPositionEvent {
  type: "INCREASE" | "DECREASE" | "COLLECT";
  block: bigint;
  logIndex: number;
  txHash: Hash;
  liquidity: bigint | null;
  amount0: bigint;
  amount1: bigint;
}

const EVENT_TYPES = {
  IncreaseLiquidity: "INCREASE",
  DecreaseLiquidity: "DECREASE",
  Collect: "COLLECT",
} as const;

const isRangeError = (e: unknown) =>
  /range|limit|too many|exceed|10000|timeout|size/i.test(e instanceof Error ? e.message : String(e));

/**
 * All NonfungiblePositionManager liquidity events for one tokenId in [fromBlock, toBlock],
 * sorted by (block, logIndex). Splits the range when the provider rejects it as too large.
 */
export async function fetchPositionEvents(
  tokenId: bigint,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawPositionEvent[]> {
  if (fromBlock > toBlock) return [];
  try {
    const logs = (
      await Promise.all(
        (Object.keys(EVENT_TYPES) as (keyof typeof EVENT_TYPES)[]).map((eventName) =>
          chain().getContractEvents({
            address: NPM_ADDRESS,
            abi: npmAbi,
            eventName,
            args: { tokenId },
            fromBlock,
            toBlock,
          }),
        ),
      )
    ).flat();
    return logs
      .map((log) => {
        const args = log.args as { liquidity?: bigint; amount0: bigint; amount1: bigint };
        return {
          type: EVENT_TYPES[log.eventName as keyof typeof EVENT_TYPES],
          block: log.blockNumber,
          logIndex: log.logIndex,
          txHash: log.transactionHash,
          liquidity: args.liquidity ?? null,
          amount0: args.amount0,
          amount1: args.amount1,
        };
      })
      .filter((e) => e.type !== undefined)
      .sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  } catch (e) {
    if (!isRangeError(e) || toBlock - fromBlock < 10n) throw e;
    const mid = (fromBlock + toBlock) / 2n;
    const [a, b] = await Promise.all([
      fetchPositionEvents(tokenId, fromBlock, mid),
      fetchPositionEvents(tokenId, mid + 1n, toBlock),
    ]);
    return [...a, ...b];
  }
}

export async function txGas(txHash: Hash): Promise<{ gasUsed: bigint; effectiveGasPrice: bigint }> {
  const r = await chain().getTransactionReceipt({ hash: txHash });
  return { gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice };
}
