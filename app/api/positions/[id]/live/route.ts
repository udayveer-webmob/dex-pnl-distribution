import { HttpError, handle } from "@/lib/api";
import { LiveUnavailable, livePositionPnl } from "@/lib/tracker/live";

/** Live P&L at the chain head, computed on request from the last stored state. Nothing is written. */
export async function GET(_request: Request, ctx: RouteContext<"/api/positions/[id]/live">) {
  return handle(async () => {
    const { id } = await ctx.params;
    try {
      return await livePositionPnl(id);
    } catch (e) {
      if (e instanceof LiveUnavailable) throw new HttpError(409, e.message);
      throw e;
    }
  });
}
