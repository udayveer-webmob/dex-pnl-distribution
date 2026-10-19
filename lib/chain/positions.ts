import { getAddress, hexToString, type Address } from "viem";
import { chain } from "./client";
import { FACTORY_ADDRESS, NPM_ADDRESS, erc20Abi, erc20Bytes32Abi, factoryAbi, npmAbi, poolAbi } from "./abis";
import { feeGrowthInside, owedRaw } from "@/lib/uniswap/math";

export interface OnchainPosition {
  tokenId: bigint;
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

export async function readPosition(tokenId: bigint, blockNumber?: bigint): Promise<OnchainPosition | null> {
  try {
    const p = await chain().readContract({
      address: NPM_ADDRESS,
      abi: npmAbi,
      functionName: "positions",
      args: [tokenId],
      blockNumber,
    });
    return {
      tokenId,
      token0: p[2],
      token1: p[3],
      fee: p[4],
      tickLower: p[5],
      tickUpper: p[6],
      liquidity: p[7],
    };
  } catch {
    return null; // not minted yet, or burned
  }
}

/** All position NFTs held by `owner` that still have liquidity. */
export async function listActivePositions(owner: Address): Promise<OnchainPosition[]> {
  const c = chain();
  const balance = await c.readContract({ address: NPM_ADDRESS, abi: npmAbi, functionName: "balanceOf", args: [owner] });
  const ids = await Promise.all(
    Array.from({ length: Number(balance) }, (_, i) =>
      c.readContract({ address: NPM_ADDRESS, abi: npmAbi, functionName: "tokenOfOwnerByIndex", args: [owner, BigInt(i)] }),
    ),
  );
  const positions = await Promise.all(ids.map((id) => readPosition(id)));
  return positions.filter((p): p is OnchainPosition => p !== null && p.liquidity > 0n);
}

export async function poolAddress(token0: Address, token1: Address, fee: number): Promise<Address> {
  return chain().readContract({ address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "getPool", args: [token0, token1, fee] });
}

export async function tokenInfo(address: Address): Promise<TokenInfo> {
  const c = chain();
  const decimals = await c.readContract({ address, abi: erc20Abi, functionName: "decimals" });
  let symbol: string;
  try {
    symbol = await c.readContract({ address, abi: erc20Abi, functionName: "symbol" });
  } catch {
    try {
      const raw = await c.readContract({ address, abi: erc20Bytes32Abi, functionName: "symbol" });
      symbol = hexToString(raw).replace(/\0/g, "");
    } catch {
      symbol = `${address.slice(0, 6)}…`;
    }
  }
  return { address: getAddress(address), symbol, decimals: Number(decimals) };
}

export interface PoolPositionRead {
  block: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  /** tokensOwed + accrued fees, raw units (includes withdrawn-but-uncollected principal). */
  owed0: bigint;
  owed1: bigint;
}

/** Pool price and the position's liquidity and owed tokens, all at the same block (spec §3). */
export async function readPoolPosition(
  pool: Address,
  tokenId: bigint,
  tickLower: number,
  tickUpper: number,
  blockNumber: bigint,
): Promise<PoolPositionRead> {
  const c = chain();
  const call = <const F extends "slot0" | "feeGrowthGlobal0X128" | "feeGrowthGlobal1X128">(functionName: F) =>
    c.readContract({ address: pool, abi: poolAbi, functionName, blockNumber });
  const tick = (t: number) => c.readContract({ address: pool, abi: poolAbi, functionName: "ticks", args: [t], blockNumber });

  const [slot0, g0, g1, lower, upper, pos] = await Promise.all([
    call("slot0"),
    call("feeGrowthGlobal0X128"),
    call("feeGrowthGlobal1X128"),
    tick(tickLower),
    tick(tickUpper),
    c
      .readContract({ address: NPM_ADDRESS, abi: npmAbi, functionName: "positions", args: [tokenId], blockNumber })
      .catch(() => null),
  ]);

  const [sqrtPriceX96, currentTick] = [slot0[0], slot0[1]];
  if (!pos) return { block: blockNumber, sqrtPriceX96, tick: currentTick, liquidity: 0n, owed0: 0n, owed1: 0n };

  const liquidity = pos[7];
  const inside0 = feeGrowthInside(currentTick, tickLower, tickUpper, g0, lower[2], upper[2]);
  const inside1 = feeGrowthInside(currentTick, tickLower, tickUpper, g1, lower[3], upper[3]);
  return {
    block: blockNumber,
    sqrtPriceX96,
    tick: currentTick,
    liquidity,
    owed0: owedRaw(liquidity, inside0, pos[8], pos[10]),
    owed1: owedRaw(liquidity, inside1, pos[9], pos[11]),
  };
}
