"use client";

import { useEffect, useState } from "react";
import type { ProgressDto } from "@/lib/pnl/types";

const STALE_MS = 60_000;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Worker progress: step label, a bar for the current step, counts, and a stale-worker hint. */
export function Progress({ progress, upTo, compact = false }: { progress: ProgressDto | null; upTo?: string; compact?: boolean }) {
  const now = useNow(10_000);
  if (!progress) {
    return <p className="text-xs text-muted">Waiting for the worker to start…{upTo ? ` · up to ${upTo}` : ""}</p>;
  }
  const pct = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const stale = now - new Date(progress.updatedAt).getTime() > STALE_MS;

  return (
    <div className={compact ? "w-48" : "w-full"}>
      <p className="text-xs text-ink-2">
        Step {progress.step}/{progress.steps} · {progress.label}
        {progress.total !== null && (
          <span className="tnum text-muted">
            {" "}
            · {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
          </span>
        )}
      </p>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label={progress.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        <div
          className={`h-full rounded-full bg-accent ${pct === null ? "w-1/3 animate-pulse" : ""}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="tnum mt-0.5 text-xs text-muted">
        {pct !== null ? `${pct}%` : "counting…"}
        {upTo ? ` · up to ${upTo}` : ""}
        {stale && <span className="text-critical"> · ▲ no update for over a minute. Is the worker running?</span>}
      </p>
    </div>
  );
}
