import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { missingEnv } from "@/lib/env";

/** Setup status for the dashboard banner: missing env vars and database reachability. */
export async function GET() {
  return handle(async () => {
    const missing = missingEnv();
    let dbError: string | null = null;
    if (!missing.includes("DATABASE_URL")) {
      try {
        await db().$queryRaw`SELECT 1`;
      } catch (e) {
        dbError = e instanceof Error ? e.message.split("\n").slice(-1)[0] : String(e);
      }
    }
    return { missingEnv: missing, dbError };
  });
}
