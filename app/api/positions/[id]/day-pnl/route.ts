import { handle } from "@/lib/api";
import { buildDayPnl } from "@/lib/pnl/dayPnl";
import type { DayPnlDto } from "@/lib/pnl/types";
import { dayCloseSnapshots } from "@/lib/queries";

/** Day P&L from each day's opening and closing snapshot only. */
export async function GET(_request: Request, ctx: RouteContext<"/api/positions/[id]/day-pnl">) {
  return handle(async (): Promise<DayPnlDto[]> => {
    const { id } = await ctx.params;
    return buildDayPnl(await dayCloseSnapshots(id));
  });
}
