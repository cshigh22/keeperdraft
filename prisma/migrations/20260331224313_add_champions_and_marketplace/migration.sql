-- CreateEnum
CREATE TYPE "TradeIntent" AS ENUM ('FIRE_SALE', 'BUYING', 'LISTENING', 'NOT_TRADING');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "tradeIntent" "TradeIntent" NOT NULL DEFAULT 'LISTENING';

-- CreateTable
CREATE TABLE "PastWinner" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "managerName" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "keeperHighlights" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PastWinner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeBlockEntry" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "playerId" TEXT,
    "draftCost" INTEGER,
    "askingPrice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeBlockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueRumor" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueRumor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PastWinner_leagueId_idx" ON "PastWinner"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "PastWinner_leagueId_season_key" ON "PastWinner"("leagueId", "season");

-- CreateIndex
CREATE INDEX "TradeBlockEntry_leagueId_idx" ON "TradeBlockEntry"("leagueId");

-- CreateIndex
CREATE INDEX "TradeBlockEntry_teamId_idx" ON "TradeBlockEntry"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeBlockEntry_teamId_playerId_key" ON "TradeBlockEntry"("teamId", "playerId");

-- CreateIndex
CREATE INDEX "LeagueRumor_leagueId_idx" ON "LeagueRumor"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueRumor_createdAt_idx" ON "LeagueRumor"("createdAt");

-- AddForeignKey
ALTER TABLE "PastWinner" ADD CONSTRAINT "PastWinner_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBlockEntry" ADD CONSTRAINT "TradeBlockEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBlockEntry" ADD CONSTRAINT "TradeBlockEntry_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBlockEntry" ADD CONSTRAINT "TradeBlockEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueRumor" ADD CONSTRAINT "LeagueRumor_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
