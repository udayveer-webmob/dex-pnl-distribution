// Protocol dispatch for the worker and the live view.

import { db } from "@/lib/db";
import { advanceCompound } from "./compoundTracker";
import { type ProgressFn, STEPS, advanceUniswap } from "./tracker";

export { STEPS, type ProgressFn };

/** Bring a tracked position up to `head`. Returns true when the position is fully closed. */
export async function advancePosition(positionId: string, head: bigint, progress?: ProgressFn): Promise<boolean> {
  const { protocol } = await db().position.findUniqueOrThrow({ where: { id: positionId }, select: { protocol: true } });
  return protocol === "COMPOUND_V3" ? advanceCompound(positionId, head, progress) : advanceUniswap(positionId, head, progress);
}
