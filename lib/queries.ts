// Read models for the API: positions with their latest snapshot, and day-wise P&L rows.

import { db } from "@/lib/db";
import type { Pool, Position, Snapshot } from "@/lib/generated/prisma/client";
import type { DailyRowDto, DirectPositionPnlDto, IntradayPointDto, PositionSummaryDto, ProgressDto } from "@/lib/pnl/types";
import type { CloseSnapshot } from "@/lib/pnl/dayPnl";
import { COMET_MARKETS } from "@/lib/compound/markets";

type LatestFields = Pick<
  Snapshot,
  "timestamp" | "date" | "nav" | "positionValue" | "totalPnl" | "realisedTotal" | "unrealisedTotal" | "inRange"
>;

export function positionSummary(
  p: Position & { pool: Pool | null },
  latest: LatestFields | null,
  currentTick: number | null,
  compoundBalance: number | null = null,
): PositionSummaryDto {
  const market = p.market ? COMET_MARKETS.find((m) => m.comet.toLowerCase() === p.market) : undefined;
  return {
    id: p.id,
    protocol: p.protocol,
    tokenId: p.tokenId,
    status: p.status,
    tickLower: p.tickLower,
    tickUpper: p.tickUpper,
    pool: p.pool,
    compound: market
      ? { comet: market.comet, name: market.name, baseSymbol: market.baseSymbol, balance: compoundBalance }
      : null,
    lastError: p.lastError,
    progress: (p.progress as ProgressDto | null) ?? null,
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
  booked: number;
  bookedPosition: number;
  rewardIncome: number;
  rewardReval: number;
  rewardRevalToRealised: number;
}

/**
 * Day-wise rows: interval P&L summed per UTC day, state and cumulative totals from the day's last snapshot.
 *
 * P&L booked per snapshot = capital out − cost basis of what left, where the cost basis removed is
 * prevCostBasis + capitalIn − costBasis (cost basis only falls on withdrawals). Of that, the position
 * part is the price effect and positional P&L realised on the withdrawal; the rest is collected fees.
 */
export async function dailyRows(positionId: string): Promise<DailyRowDto[]> {
  const days = await db().$queryRaw<DayAggregate[]>`
    WITH s AS (
      SELECT *,
        "capitalOut" - (COALESCE(LAG("costBasis") OVER (ORDER BY seq), 0) + "capitalIn" - "costBasis") AS booked
      FROM "Snapshot"
      WHERE "positionId" = ${positionId}
    )
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
      SUM("ilToRealised") AS "ilToRealised",
      SUM(booked) AS booked,
      SUM("rewardIncome") AS "rewardIncome",
      SUM("rewardReval") AS "rewardReval",
      SUM("rewardRevalToRealised") AS "rewardRevalToRealised",
      SUM("priceEffectToRealised" + "ilToRealised") AS "bookedPosition"
    FROM s
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
        rewardIncome: d.rewardIncome,
        rewardReval: d.rewardReval,
        capitalIn: d.capitalIn,
        capitalOut: d.capitalOut,
        pnl: d.pnl,
      },
      booked: {
        total: d.booked,
        position: d.bookedPosition,
        fees: d.booked - d.bookedPosition,
      },
      reclassified: {
        feeRevalToRealised: d.feeRevalToRealised,
        priceEffectToRealised: d.priceEffectToRealised,
        ilToRealised: d.ilToRealised,
        rewardRevalToRealised: d.rewardRevalToRealised,
      },
      cumulative: {
        realised: {
          feeIncome: s.rFeeIncome,
          gasCost: s.rGasCost,
          feeReval: s.rFeeReval,
          priceEffect: s.rPriceEffect,
          il: s.rIl,
          rewardIncome: s.rRewardIncome,
          rewardReval: s.rRewardReval,
          total: s.realisedTotal,
        },
        unrealised: {
          priceEffect: s.uPriceEffect,
          il: s.uIl,
          feeReval: s.uFeeReval,
          rewardReval: s.uRewardReval,
          total: s.unrealisedTotal,
        },
        totalPnl: s.totalPnl,
        netCapital: s.netCapital,
      },
      checksOk: d.checksOk,
    };
  });
}

/**
 * Direct position P&L from the on-chain IncreaseLiquidity / DecreaseLiquidity amounts, valued at the
 * USD prices of the snapshot taken at each event, plus the latest position value. Independent of the
 * engine's price effect / positional split, which must add up to the same figure.
 */
export async function directPositionPnl(
  positionId: string,
  decimals0: number,
  decimals1: number,
  currentValue: number,
): Promise<DirectPositionPnlDto> {
  const rows = await db().$queryRaw<{ type: "INCREASE" | "DECREASE"; value: number }[]>`
    SELECT e.type, SUM(
      (e.amount0::numeric / power(10::numeric, ${decimals0}::int)) * s.usd0::numeric
      + (e.amount1::numeric / power(10::numeric, ${decimals1}::int)) * s.usd1::numeric
    )::float8 AS value
    FROM "PositionEvent" e
    JOIN "Snapshot" s ON s."positionId" = e."positionId" AND s.block = e.block AND s.kind = 'EVENT'
    WHERE e."positionId" = ${positionId} AND e.type IN ('INCREASE', 'DECREASE')
    GROUP BY e.type`;
  const deposited = rows.find((r) => r.type === "INCREASE")?.value ?? 0;
  const withdrawn = rows.find((r) => r.type === "DECREASE")?.value ?? 0;
  return { deposited, withdrawn, currentValue, pnl: withdrawn + currentValue - deposited };
}

/** The last snapshot of each UTC day (the day's close), oldest first. */
export async function dayCloseSnapshots(positionId: string): Promise<CloseSnapshot[]> {
  return db().$queryRaw<CloseSnapshot[]>`
    SELECT DISTINCT ON (date)
      date, timestamp,
      "rFeeIncome", "rGasCost", "rFeeReval", "rPriceEffect", "rIl",
      "uPriceEffect", "uIl", "uFeeReval",
      "rRewardIncome", "rRewardReval", "uRewardReval",
      "realisedTotal", "unrealisedTotal", "totalPnl"
    FROM "Snapshot"
    WHERE "positionId" = ${positionId}
    ORDER BY date, seq DESC`;
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
