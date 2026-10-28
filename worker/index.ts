// Background poller: brings every tracked position up to the chain head every POLL_INTERVAL_SECONDS.
// Newly tracked positions are picked up within a few seconds and backfilled first.
//
// Run with `npm run worker` (or `npm run dev`, which starts it next to Next.js).

import "dotenv/config";
import { db } from "@/lib/db";
import { chain } from "@/lib/chain/client";
import { ConfigError, missingEnv, pollIntervalMs } from "@/lib/env";
import { Prisma } from "@/lib/generated/prisma/client";
import { STEPS, advancePosition, type ProgressFn } from "@/lib/tracker";
import type { ProgressDto } from "@/lib/pnl/types";

const TICK_MS = 5_000;
const PROGRESS_WRITE_MS = 2_000;
const QUIET_RUN_MS = 3_000; // routine polls finish faster than this; don't flash progress for them
const CONFIRMATIONS = 2n; // stay a couple of blocks behind the tip to avoid reorgs
const lastRun = new Map<string, number>();

const log = (...args: unknown[]) => console.log(new Date().toISOString(), "[worker]", ...args);

/** Persists progress for the dashboard (throttled) and logs step changes and every 10% of long steps. */
function progressReporter(positionId: string, tokenId: string, backfilling: boolean): ProgressFn {
  const started = Date.now();
  let lastWrite = 0;
  let lastStep = -1;
  let lastDecile = -1;

  return async (step, done, total) => {
    const stepChanged = step !== lastStep;
    const finished = total !== null && done >= total;
    const decile = total ? Math.floor((done / total) * 10) : 0;
    const visible = backfilling || Date.now() - started >= QUIET_RUN_MS;
    if (stepChanged) lastDecile = -1;
    lastStep = step;

    if (stepChanged || (total !== null && total >= 50 && decile > lastDecile)) {
      lastDecile = decile;
      if (visible) {
        const pct = total ? ` ${done}/${total} (${Math.round((done / total) * 100)}%)` : "";
        log(`#${tokenId} [${step + 1}/${STEPS.length}] ${STEPS[step]}${pct}`);
      }
    }

    if (!visible) return;
    if (!stepChanged && !finished && Date.now() - lastWrite < PROGRESS_WRITE_MS) return;
    lastWrite = Date.now();
    const progress: ProgressDto = {
      step: step + 1,
      steps: STEPS.length,
      label: STEPS[step],
      done,
      total,
      updatedAt: new Date().toISOString(),
    };
    await db().position.update({ where: { id: positionId }, data: { progress: progress as object } });
  };
}

async function tick() {
  const due = (
    await db().position.findMany({
      where: { status: { in: ["BACKFILLING", "TRACKING", "ERROR"] } },
      select: { id: true, tokenId: true, status: true },
    })
  ).filter((p) => Date.now() - (lastRun.get(p.id) ?? 0) >= pollIntervalMs());
  if (!due.length) return;

  const head = (await chain().getBlockNumber()) - CONFIRMATIONS;
  for (const p of due) {
    lastRun.set(p.id, Date.now());
    const started = Date.now();
    try {
      const closed = await advancePosition(p.id, head, progressReporter(p.id, p.tokenId, p.status === "BACKFILLING"));
      // Untracked while running? Leave the user's choice alone.
      await db().position.updateMany({
        where: { id: p.id, status: { in: ["BACKFILLING", "TRACKING", "ERROR"] } },
        data: { status: closed ? "CLOSED" : "TRACKING", lastError: null },
      });
      log(`#${p.tokenId} → block ${head}${closed ? " (closed)" : ""} in ${Date.now() - started} ms`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db().position.update({ where: { id: p.id }, data: { status: "ERROR", lastError: message.slice(0, 1000) } });
      log(`#${p.tokenId} failed:`, message);
    } finally {
      await db().position.update({ where: { id: p.id }, data: { progress: Prisma.DbNull } }).catch(() => undefined);
    }
  }
}

async function main() {
  let warned = false;
  for (;;) {
    const missing = missingEnv();
    if (missing.length) {
      if (!warned) log(`waiting for ${missing.join(", ")} in .env`);
      warned = true;
    } else {
      warned = false;
      await tick().catch((e) => log(e instanceof ConfigError ? e.message : e));
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main();
