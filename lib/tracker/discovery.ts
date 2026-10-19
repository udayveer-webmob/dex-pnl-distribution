import type { Address } from "viem";
import { db } from "@/lib/db";
import { listActivePositions, poolAddress, tokenInfo, type OnchainPosition } from "@/lib/chain/positions";
import { chooseReferenceToken } from "@/lib/prices/reference";

/** Pool row for a position's (token0, token1, fee), created on first sight. */
async function ensurePool(p: OnchainPosition): Promise<string> {
  const address = (await poolAddress(p.token0, p.token1, p.fee)).toLowerCase();
  const existing = await db().pool.findUnique({ where: { address } });
  if (existing) return address;

  const [t0, t1] = await Promise.all([tokenInfo(p.token0), tokenInfo(p.token1)]);
  await db().pool.upsert({
    where: { address },
    update: {},
    create: {
      address,
      token0: t0.address.toLowerCase(),
      token0Symbol: t0.symbol,
      token0Decimals: t0.decimals,
      token1: t1.address.toLowerCase(),
      token1Symbol: t1.symbol,
      token1Decimals: t1.decimals,
      fee: p.fee,
      refToken: chooseReferenceToken(t0.address, t1.address),
    },
  });
  return address;
}

/**
 * Sync the wallet's active Uniswap v3 positions into the DB. Positions already known (e.g. tracked
 * ones that have since been closed) are kept as they are.
 */
export async function syncWalletPositions(walletId: string): Promise<void> {
  const wallet = await db().wallet.findUniqueOrThrow({ where: { id: walletId } });
  const active = await listActivePositions(wallet.address as Address);
  for (const p of active) {
    const poolAddr = await ensurePool(p);
    await db().position.upsert({
      where: { tokenId: p.tokenId.toString() },
      update: { walletId },
      create: {
        tokenId: p.tokenId.toString(),
        walletId,
        poolAddress: poolAddr,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
      },
    });
  }
}
