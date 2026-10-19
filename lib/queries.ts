// Read models for the API: positions with their latest snapshot, and day-wise P&L rows.

import { db } from "@/lib/db";
import type { Pool, Position, Snapshot } from "@/lib/generated/prisma/client";
import type { DailyRowDto, IntradayPointDto, PositionSummaryDto, ProgressDto } from "@/lib/pnl/types";

type LatestFields = Pick<
  Snapshot,
  "timestamp" | "date" | "nav" | "positionValue" | "totalPnl" | "realisedTotal" | "unrealisedTotal" | "inRange"
>;

export function positionSummary(
  p: Position & { pool: Pool },
  latest: LatestFields | null,
  currentTick: number | null,
): PositionSummaryDto {
  return {
    id: p.id,
    tokenId: p.tokenId,
    status: p.status,
    tickLower: p.tickLower,
    tickUpper: p.tickUpper,
    lastError: p.lastError,
    progress: (p.progress as ProgressDto | null) ?? null,
    pool: p.pool,
    currentTick,
    latest: latest && {
      timestamp: latest.timestamp.toISOString(),
      date: latest.date,
      nav: latest.nav,
      positionValue: latest.positionValue,
      totalPnl: latest.totalPnl,
      realisedTotal: latest.realisedTotal,
      unrealisedTotal: latest.unrealisedTotal,
      inRange: latest.inRange,
    },
  };
}

export async function latestSnapshot(positionId: string) {
  return db().snapshot.findFirst({ where: { positionId }, orderBy: { seq: "desc" } });
}

interface DayAggregate {
  date: string;
  snapshots: number;
  navOpen: number;
  lastId: string;
  checksOk: boolean;
  feeIncome: number;
  gasCost: number;
  feeReval: number;
  priceEffect: number;
  ilChange: number;
  capitalIn: number;
  capitalOut: number;
  pnl: number;
  feeRevalToRealised: number;
  priceEffectToRealised: number;
  ilToRealised: number;
}

/** Day-wise rows: interval P&L summed per UTC day, state and cumulative totals from the day's last snapshot. */
export async function dailyRows(positionId: string): Promise<DailyRowDto[]> {
  const days = await db().$queryRaw<DayAggregate[]>`
    SELECT date,
      COUNT(*)::int AS snapshots,
      (array_agg("navOpen" ORDER BY seq ASC))[1] AS "navOpen",
      (array_agg(id ORDER BY seq DESC))[1] AS "lastId",
      bool_and("checksOk") AS "checksOk",
      SUM("feeIncome") AS "feeIncome",
      SUM("gasCost") AS "gasCost",
      SUM("feeReval") AS "feeReval",
      SUM("priceEffect") AS "priceEffect",
      SUM("ilChange") AS "ilChange",
      SUM("capitalIn") AS "capitalIn",
      SUM("capitalOut") AS "capitalOut",
      SUM(pnl) AS pnl,
      SUM("feeRevalToRealised") AS "feeRevalToRealised",
      SUM("priceEffectToRealised") AS "priceEffectToRealised",
      SUM("ilToRealised") AS "ilToRealised"
    FROM "Snapshot"
    WHERE "positionId" = ${positionId}
    GROUP BY date
    ORDER BY date`;

  const last = await db().snapshot.findMany({ where: { id: { in: days.map((d) => d.lastId) } } });
  const byId = new Map(last.map((s) => [s.id, s]));

  return days.map((d) => {
    const s = byId.get(d.lastId)!;
    return {
      date: d.date,
      snapshots: d.snapshots,
      openingNav: d.navOpen,
      closingNav: s.nav,
      usd0: s.usd0,
      usd1: s.usd1,
      positionValue: s.positionValue,
      hodlValue: s.hodlValue,
      heldFeesValue: s.heldFeesValue,
      costBasis: s.costBasis,
      inRange: s.inRange,
      daily: {
        feeIncome: d.feeIncome,
        gasCost: d.gasCost,
        feeReval: d.feeReval,
        priceEffect: d.priceEffect,
        ilChange: d.ilChange,
        capitalIn: d.capitalIn,
        capitalOut: d.capitalOut,
        pnl: d.pnl,
      },
      reclassified: {
        feeRevalToRealised: d.feeRevalToRealised,
        priceEffectToRealised: d.priceEffectToRealised,
        ilToRealised: d.ilToRealised,
      },
      cumulative: {
        realised: {
          feeIncome: s.rFeeIncome,
          gasCost: s.rGasCost,
          feeReval: s.rFeeReval,
          priceEffect: s.rPriceEffect,
          il: s.rIl,
          total: s.realisedTotal,
        },
        unrealised: { priceEffect: s.uPriceEffect, il: s.uIl, feeReval: s.uFeeReval, total: s.unrealisedTotal },
        totalPnl: s.totalPnl,
        netCapital: s.netCapital,
      },
      checksOk: d.checksOk,
    };
  });
}

export async function intradayPoints(positionId: string, date: string): Promise<IntradayPointDto[]> {
  const rows = await db().snapshot.findMany({
    where: { positionId, date },
    orderBy: { seq: "asc" },
    select: {
      timestamp: true,
      kind: true,
      nav: true,
      positionValue: true,
      hodlValue: true,
      totalPnl: true,
      realisedTotal: true,
      unrealisedTotal: true,
      usd0: true,
      usd1: true,
    },
  });
  return rows.map((r) => ({ ...r, timestamp: r.timestamp.toISOString() }));
}
