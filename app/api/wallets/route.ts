import { isAddress } from "viem";
import { HttpError, handle } from "@/lib/api";
import { db } from "@/lib/db";
import { syncWalletPositions } from "@/lib/tracker/discovery";

export async function GET() {
  return handle(() => db().wallet.findMany({ orderBy: { createdAt: "asc" } }));
}

export async function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json().catch(() => ({}))) as { address?: string; label?: string };
    const address = body.address?.trim() ?? "";
    if (!isAddress(address, { strict: false })) throw new HttpError(400, "Not a valid Ethereum address");

    const wallet = await db().wallet.upsert({
      where: { address: address.toLowerCase() },
      update: body.label?.trim() ? { label: body.label.trim() } : {},
      create: { address: address.toLowerCase(), label: body.label?.trim() || null },
    });

    let syncError: string | null = null;
    try {
      await syncWalletPositions(wallet.id);
    } catch (e) {
      syncError = e instanceof Error ? e.message : String(e);
    }
    return { wallet, syncError };
  });
}
