-- CreateTable
CREATE TABLE "RosterHistory" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "nflTeam" TEXT,
    "isKeeper" BOOLEAN NOT NULL,
    "keeperRound" INTEGER,
    "acquiredVia" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RosterHistory_leagueId_season_idx" ON "RosterHistory"("leagueId", "season");

-- AddForeignKey
ALTER TABLE "RosterHistory" ADD CONSTRAINT "RosterHistory_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

