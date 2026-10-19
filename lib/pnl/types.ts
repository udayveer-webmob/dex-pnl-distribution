// Shapes returned by the API and consumed by the dashboard (no server-only imports here).

export type PositionStatus = "DISCOVERED" | "BACKFILLING" | "TRACKING" | "CLOSED" | "ERROR";

export interface WalletDto {
  id: string;
  address: string;
  label: string | null;
}

export interface PoolDto {
  address: string;
  token0: string;
  token0Symbol: string;
  token0Decimals: number;
  token1: string;
  token1Symbol: string;
  token1Decimals: number;
  fee: number;
  refToken: number;
}

/** Progress of the worker's current run for a position (written while it runs, cleared after). */
export interface ProgressDto {
  step: number; // 1-based
  steps: number;
  label: string;
  done: number;
  total: number | null; // null while the total is not known yet
  updatedAt: string;
}

export interface PositionSummaryDto {
  id: string;
  tokenId: string;
  status: PositionStatus;
  tickLower: number;
  tickUpper: number;
  lastError: string | null;
  progress: ProgressDto | null;
  pool: PoolDto;
  currentTick: number | null;
  latest: {
    timestamp: string;
    date: string;
    nav: number;
    positionValue: number;
    totalPnl: number;
    realisedTotal: number;
    unrealisedTotal: number;
    inRange: boolean;
  } | null;
}

/** Spec §6.2 DailyPnlRow, per position. */
export interface DailyRowDto {
  date: string;
  snapshots: number;
  openingNav: number;
  closingNav: number;
  usd0: number;
  usd1: number;
  positionValue: number;
  hodlValue: number;
  heldFeesValue: number;
  costBasis: number;
  inRange: boolean;
  daily: {
    feeIncome: number;
    gasCost: number;
    feeReval: number;
    priceEffect: number;
    ilChange: number;
    capitalIn: number;
    capitalOut: number;
    pnl: number;
  };
  reclassified: {
    feeRevalToRealised: number;
    priceEffectToRealised: number;
    ilToRealised: number;
  };
  cumulative: {
    realised: { feeIncome: number; gasCost: number; feeReval: number; priceEffect: number; il: number; total: number };
    unrealised: { priceEffect: number; il: number; feeReval: number; total: number };
    totalPnl: number;
    netCapital: number;
  };
  checksOk: boolean;
}

export interface IntradayPointDto {
  timestamp: string;
  kind: "DAILY" | "POLL" | "EVENT";
  nav: number;
  positionValue: number;
  hodlValue: number;
  totalPnl: number;
  realisedTotal: number;
  unrealisedTotal: number;
  usd0: number;
  usd1: number;
}

export interface PositionPnlDto {
  position: PositionSummaryDto;
  daily: DailyRowDto[];
}
