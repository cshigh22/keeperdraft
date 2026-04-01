-- CreateEnum
CREATE TYPE "TradeBlockPhase" AS ENUM ('PRE_DRAFT', 'DRAFT');

-- AlterTable
ALTER TABLE "TradeBlockEntry" ADD COLUMN     "phase" "TradeBlockPhase" NOT NULL DEFAULT 'PRE_DRAFT';
