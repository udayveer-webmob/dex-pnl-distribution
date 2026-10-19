-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('DISCOVERED', 'BACKFILLING', 'TRACKING', 'CLOSED', 'ERROR');

-- CreateEnum
CREATE TYPE "SnapshotKind" AS ENUM ('DAILY', 'POLL', 'EVENT');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('INCREASE', 'DECREASE', 'COLLECT');

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pool" (
    "address" TEXT NOT NULL,
    "token0" TEXT NOT NULL,
    "token0Symbol" TEXT NOT NULL,
    "token0Decimals" INTEGER NOT NULL,
    "token1" TEXT NOT NULL,
    "token1Symbol" TEXT NOT NULL,
    "token1Decimals" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "refToken" INTEGER NOT NULL,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "poolAddress" TEXT NOT NULL,
    "tickLower" INTEGER NOT NULL,
    "tickUpper" INTEGER NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'DISCOVERED',
    "mintBlock" BIGINT,
    "lastBlock" BIGINT,
    "state" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "positionId" TEXT NOT NULL,
    "kind" "SnapshotKind" NOT NULL,
    "block" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "date" TEXT NOT NULL,
    "sqrtPriceX96" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "liquidity" TEXT NOT NULL,
    "inRange" BOOLEAN NOT NULL,
    "usd0" DOUBLE PRECISION NOT NULL,
    "usd1" DOUBLE PRECISION NOT NULL,
    "amount0" DOUBLE PRECISION NOT NULL,
    "amount1" DOUBLE PRECISION NOT NULL,
    "positionValue" DOUBLE PRECISION NOT NULL,
    "hodl0" DOUBLE PRECISION NOT NULL,
    "hodl1" DOUBLE PRECISION NOT NULL,
    "hodlValue" DOUBLE PRECISION NOT NULL,
    "heldFees0" DOUBLE PRECISION NOT NULL,
    "heldFees1" DOUBLE PRECISION NOT NULL,
    "heldFeesValue" DOUBLE PRECISION NOT NULL,
    "costBasis" DOUBLE PRECISION NOT NULL,
    "navOpen" DOUBLE PRECISION NOT NULL,
    "nav" DOUBLE PRECISION NOT NULL,
    "feeIncome" DOUBLE PRECISION NOT NULL,
    "gasCost" DOUBLE PRECISION NOT NULL,
    "feeReval" DOUBLE PRECISION NOT NULL,
    "priceEffect" DOUBLE PRECISION NOT NULL,
    "ilChange" DOUBLE PRECISION NOT NULL,
    "capitalIn" DOUBLE PRECISION NOT NULL,
    "capitalOut" DOUBLE PRECISION NOT NULL,
    "pnl" DOUBLE PRECISION NOT NULL,
    "feeRevalToRealised" DOUBLE PRECISION NOT NULL,
    "priceEffectToRealised" DOUBLE PRECISION NOT NULL,
    "ilToRealised" DOUBLE PRECISION NOT NULL,
    "rFeeIncome" DOUBLE PRECISION NOT NULL,
    "rGasCost" DOUBLE PRECISION NOT NULL,
    "rFeeReval" DOUBLE PRECISION NOT NULL,
    "rPriceEffect" DOUBLE PRECISION NOT NULL,
    "rIl" DOUBLE PRECISION NOT NULL,
    "realisedTotal" DOUBLE PRECISION NOT NULL,
    "uPriceEffect" DOUBLE PRECISION NOT NULL,
    "uIl" DOUBLE PRECISION NOT NULL,
    "uFeeReval" DOUBLE PRECISION NOT NULL,
    "unrealisedTotal" DOUBLE PRECISION NOT NULL,
    "totalPnl" DOUBLE PRECISION NOT NULL,
    "netCapital" DOUBLE PRECISION NOT NULL,
    "checksOk" BOOLEAN NOT NULL,
    "checks" JSONB NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionEvent" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "block" BIGINT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "liquidity" TEXT,
    "amount0" TEXT NOT NULL,
    "amount1" TEXT NOT NULL,
    "gasUsed" TEXT,
    "effectiveGasPrice" TEXT,

    CONSTRAINT "PositionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenPrice" (
    "token" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "usd" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TokenPrice_pkey" PRIMARY KEY ("token","timestamp")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Position_tokenId_key" ON "Position"("tokenId");

-- CreateIndex
CREATE INDEX "Snapshot_positionId_seq_idx" ON "Snapshot"("positionId", "seq");

-- CreateIndex
CREATE INDEX "Snapshot_positionId_date_idx" ON "Snapshot"("positionId", "date");

-- CreateIndex
CREATE INDEX "PositionEvent_positionId_block_idx" ON "PositionEvent"("positionId", "block");

-- CreateIndex
CREATE UNIQUE INDEX "PositionEvent_txHash_logIndex_key" ON "PositionEvent"("txHash", "logIndex");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_poolAddress_fkey" FOREIGN KEY ("poolAddress") REFERENCES "Pool"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionEvent" ADD CONSTRAINT "PositionEvent_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
