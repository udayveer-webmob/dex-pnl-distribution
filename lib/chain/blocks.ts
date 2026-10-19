import { chain } from "./client";

const timestamps = new Map<bigint, number>();

export async function blockTimestamp(block: bigint): Promise<number> {
  const cached = timestamps.get(block);
  if (cached !== undefined) return cached;
  const b = await chain().getBlock({ blockNumber: block });
  const ts = Number(b.timestamp);
  timestamps.set(block, ts);
  return ts;
}

/**
 * Last block with timestamp <= `ts` (unix seconds). Starts from a 12-second-slot estimate,
 * gallops outwards to bracket the answer, then binary-searches the bracket.
 */
export async function blockAtOrBefore(ts: number, head: bigint): Promise<bigint> {
  const headTs = await blockTimestamp(head);
  if (ts >= headTs) return head;

  const guess = head - BigInt(Math.ceil((headTs - ts) / 12));
  let lo = guess < 0n ? 0n : guess;
  let hi = lo;

  // Bracket: timestamp(lo) <= ts < timestamp(hi).
  let stepSize = 64n;
  while ((await blockTimestamp(lo)) > ts) {
    hi = lo;
    lo = lo > stepSize ? lo - stepSize : 0n;
    stepSize *= 2n;
  }
  if (hi === lo) {
    stepSize = 64n;
    hi = lo + 1n;
    while (hi <= head && (await blockTimestamp(hi)) <= ts) {
      lo = hi;
      hi = hi + stepSize > head ? head + 1n : hi + stepSize;
      stepSize *= 2n;
    }
  }

  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if ((await blockTimestamp(mid)) <= ts) lo = mid;
    else hi = mid;
  }
  return lo;
}
