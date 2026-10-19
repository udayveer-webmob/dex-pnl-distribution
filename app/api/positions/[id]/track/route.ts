import { handle } from "@/lib/api";
import { db } from "@/lib/db";

/** Start (`{ track: true }`) or pause (`{ track: false }`) tracking. The worker picks it up. */
export async function POST(request: Request, ctx: RouteContext<"/api/positions/[id]/track">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { track } = (await request.json().catch(() => ({}))) as { track?: boolean };
    const p = await db().position.findUniqueOrThrow({ where: { id } });
    if (p.status === "CLOSED") return p;
    return db().position.update({
      where: { id },
      data: { status: track ? (p.state ? "TRACKING" : "BACKFILLING") : "DISCOVERED", lastError: null },
    });
  });
}
