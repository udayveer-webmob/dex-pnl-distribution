import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { dailyRows, directPositionPnl, latestSnapshot, positionSummary } from "@/lib/queries";
import type { PositionPnlDto } from "@/lib/pnl/types";

/** Day-wise P&L rows for one position (spec §6.2). */
export async function GET(_request: Request, ctx: RouteContext<"/api/positions/[id]/pnl">) {
  return handle(async (): Promise<PositionPnlDto> => {
    const { id } = await ctx.params;
    const p = await db().position.findUniqueOrThrow({ where: { id }, include: { pool: true } });
    const latest = await latestSnapshot(id);
    return {
      position: positionSummary(p, latest, latest?.tick ?? null),
      daily: await dailyRows(id),
      // Direct (in − out) position P&L is defined for Uniswap liquidity only.
      direct: p.pool
        ? await directPositionPnl(id, p.pool.token0Decimals, p.pool.token1Decimals, latest?.positionValue ?? 0)
        : null,
    };
  });
}
