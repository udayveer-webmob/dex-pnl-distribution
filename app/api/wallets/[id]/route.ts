import { handle } from "@/lib/api";
import { db } from "@/lib/db";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/wallets/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    await db().wallet.delete({ where: { id } });
    return { ok: true };
  });
}
