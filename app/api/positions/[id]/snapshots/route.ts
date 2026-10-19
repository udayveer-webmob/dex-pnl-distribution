import { HttpError, handle } from "@/lib/api";
import { intradayPoints } from "@/lib/queries";

/** All snapshots of one UTC day (`?date=YYYY-MM-DD`), for the intraday chart. */
export async function GET(request: Request, ctx: RouteContext<"/api/positions/[id]/snapshots">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const date = new URL(request.url).searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "date must be YYYY-MM-DD");
    return intradayPoints(id, date);
  });
}
