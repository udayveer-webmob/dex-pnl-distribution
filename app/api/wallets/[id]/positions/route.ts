import type { Address } from "viem";
import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { chain } from "@/lib/chain/client";
import { poolAbi } from "@/lib/chain/abis";
import { positionSummary } from "@/lib/queries";
import { syncWalletPositions } from "@/lib/tracker/discovery";

/** The wallet's positions. `?refresh=1` re-reads active positions from chain first. */
export async function GET(request: Request, ctx: RouteContext<"/api/wallets/[id]/positions">) {
  return handle(async () => {
    const { id } = await ctx.params;
    let syncError: string | null = null;
    if (new URL(request.url).searchParams.get("refresh")) {
      try {
        await syncWalletPositions(id);
      } catch (e) {
        syncError = e instanceof Error ? e.message : String(e);
      }
    }

    const positions = await db().position.findMany({
      where: { walletId: id },
      include: { pool: true, snapshots: { orderBy: { seq: "desc" }, take: 1 } },
      orderBy: { createdAt: "asc" },
    });

    // Current tick per pool, for in-range badges on positions that are not tracked yet.
    const ticks = new Map<string, number>();
    await Promise.all(
      [...new Set(positions.map((p) => p.poolAddress))].map(async (pool) => {
        try {
          const slot0 = await chain().readContract({ address: pool as Address, abi: poolAbi, functionName: "slot0" });
          ticks.set(pool, slot0[1]);
        } catch {
          // RPC not configured or unreachable: the badge is just omitted.
        }
      }),
    );

    return {
      syncError,
      positions: positions.map(({ snapshots, ...p }) =>
        positionSummary(p, snapshots[0] ?? null, ticks.get(p.poolAddress) ?? null),
      ),
    };
  });
}
