-- CreateEnum
CREATE TYPE "Protocol" AS ENUM ('UNISWAP_V3', 'COMPOUND_V3');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EventType" ADD VALUE 'SUPPLY';
ALTER TYPE "EventType" ADD VALUE 'WITHDRAW';
ALTER TYPE "EventType" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "EventType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "EventType" ADD VALUE 'REWARD_CLAIM';

-- DropForeignKey
ALTER TABLE "Position" DROP CONSTRAINT "Position_poolAddress_fkey";

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "market" TEXT,
ADD COLUMN     "protocol" "Protocol" NOT NULL DEFAULT 'UNISWAP_V3',
ALTER COLUMN "poolAddress" DROP NOT NULL,
ALTER COLUMN "tickLower" DROP NOT NULL,
ALTER COLUMN "tickUpper" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Snapshot" ADD COLUMN     "rRewardIncome" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rRewardReval" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rewardIncome" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rewardReval" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rewardRevalToRealised" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "uRewardReval" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_poolAddress_fkey" FOREIGN KEY ("poolAddress") REFERENCES "Pool"("address") ON DELETE SET NULL ON UPDATE CASCADE;

