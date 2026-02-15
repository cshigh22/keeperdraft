-- CreateEnum
CREATE TYPE "LeagueRole" AS ENUM ('COMMISSIONER', 'CO_COMMISSIONER', 'MEMBER');

-- CreateEnum
CREATE TYPE "Position" AS ENUM ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX');

-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'INJURED_RESERVE', 'PRACTICE_SQUAD', 'FREE_AGENT');

-- CreateEnum
CREATE TYPE "AcquisitionType" AS ENUM ('DRAFTED', 'TRADED', 'KEEPER', 'FREE_AGENT');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'PROCESSING', 'COMPLETED', 'VETOED');

-- CreateEnum
CREATE TYPE "TradeAssetType" AS ENUM ('DRAFT_PICK', 'PLAYER', 'FUTURE_PICK');

-- CreateEnum
CREATE TYPE "DraftType" AS ENUM ('SNAKE', 'LINEAR', 'AUCTION', 'THIRD_ROUND_REVERSAL');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DraftActivityType" AS ENUM ('DRAFT_STARTED', 'DRAFT_PAUSED', 'DRAFT_RESUMED', 'DRAFT_COMPLETED', 'PICK_MADE', 'PICK_UNDONE', 'TRADE_PROPOSED', 'TRADE_ACCEPTED', 'TRADE_REJECTED', 'TRADE_CANCELLED', 'TRADE_FORCED', 'TIMER_EXPIRED', 'AUTO_PICK', 'ORDER_UPDATED', 'SETTINGS_CHANGED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT,
    "name" TEXT,
    "image" TEXT,
    "avatarUrl" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "LeagueInvite" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "League" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "maxTeams" INTEGER NOT NULL DEFAULT 12,
    "commissionerId" TEXT NOT NULL,
    "sleeperId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeagueMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "role" "LeagueRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT,
    "leagueId" TEXT NOT NULL,
    "draftPosition" INTEGER,
    "sleeperId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "sleeperId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "position" "Position" NOT NULL,
    "nflTeam" TEXT,
    "age" INTEGER,
    "yearsExp" INTEGER,
    "status" "PlayerStatus" NOT NULL DEFAULT 'ACTIVE',
    "injuryStatus" TEXT,
    "avatarUrl" TEXT,
    "adp" DOUBLE PRECISION,
    "rank" INTEGER,
    "positionRank" INTEGER,
    "byeWeek" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftQueue" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerRoster" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "isKeeper" BOOLEAN NOT NULL DEFAULT false,
    "keeperRound" INTEGER,
    "acquiredVia" "AcquisitionType" NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftPick" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "pickInRound" INTEGER,
    "overallPickNumber" INTEGER,
    "originalOwnerId" TEXT NOT NULL,
    "currentOwnerId" TEXT NOT NULL,
    "selectedPlayerId" TEXT,
    "selectedAt" TIMESTAMP(3),
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "isAutoPick" BOOLEAN NOT NULL DEFAULT false,
    "autoPickPlayerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "initiatorTeamId" TEXT NOT NULL,
    "receiverTeamId" TEXT NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "forcedByCommissioner" BOOLEAN NOT NULL DEFAULT false,
    "commissionerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeAsset" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "fromTeamId" TEXT NOT NULL,
    "assetType" "TradeAssetType" NOT NULL,
    "draftPickId" TEXT,
    "playerId" TEXT,
    "futurePickSeason" INTEGER,
    "futurePickRound" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftSettings" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "draftType" "DraftType" NOT NULL DEFAULT 'LINEAR',
    "totalRounds" INTEGER NOT NULL DEFAULT 14,
    "timerDurationSeconds" INTEGER NOT NULL DEFAULT 90,
    "reserveTimeSeconds" INTEGER NOT NULL DEFAULT 120,
    "pauseOnTrade" BOOLEAN NOT NULL DEFAULT true,
    "maxKeepers" INTEGER NOT NULL DEFAULT 7,
    "qbCount" INTEGER NOT NULL DEFAULT 1,
    "rbCount" INTEGER NOT NULL DEFAULT 2,
    "wrCount" INTEGER NOT NULL DEFAULT 3,
    "teCount" INTEGER NOT NULL DEFAULT 1,
    "flexCount" INTEGER NOT NULL DEFAULT 2,
    "superflexCount" INTEGER NOT NULL DEFAULT 0,
    "kCount" INTEGER NOT NULL DEFAULT 1,
    "defCount" INTEGER NOT NULL DEFAULT 1,
    "benchCount" INTEGER NOT NULL DEFAULT 9,
    "keeperDeadline" TIMESTAMP(3),
    "scheduledStartTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftState" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "currentRound" INTEGER NOT NULL DEFAULT 1,
    "currentPick" INTEGER NOT NULL DEFAULT 1,
    "currentTeamId" TEXT,
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "pauseReason" TEXT,
    "timerStartedAt" TIMESTAMP(3),
    "timerSecondsRemaining" INTEGER,
    "lastPickId" TEXT,
    "undoAvailable" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftActivityLog" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "activityType" "DraftActivityType" NOT NULL,
    "description" TEXT NOT NULL,
    "teamId" TEXT,
    "pickNumber" INTEGER,
    "playerId" TEXT,
    "tradeId" TEXT,
    "triggeredById" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueInvite_token_key" ON "LeagueInvite"("token");

-- CreateIndex
CREATE INDEX "LeagueInvite_leagueId_idx" ON "LeagueInvite"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueInvite_token_idx" ON "LeagueInvite"("token");

-- CreateIndex
CREATE INDEX "League_commissionerId_idx" ON "League"("commissionerId");

-- CreateIndex
CREATE INDEX "League_season_idx" ON "League"("season");

-- CreateIndex
CREATE INDEX "LeagueMember_leagueId_idx" ON "LeagueMember"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMember_userId_leagueId_key" ON "LeagueMember"("userId", "leagueId");

-- CreateIndex
CREATE INDEX "Team_leagueId_idx" ON "Team"("leagueId");

-- CreateIndex
CREATE INDEX "Team_ownerId_idx" ON "Team"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_leagueId_draftPosition_key" ON "Team"("leagueId", "draftPosition");

-- CreateIndex
CREATE UNIQUE INDEX "Player_sleeperId_key" ON "Player"("sleeperId");

-- CreateIndex
CREATE INDEX "Player_position_idx" ON "Player"("position");

-- CreateIndex
CREATE INDEX "Player_nflTeam_idx" ON "Player"("nflTeam");

-- CreateIndex
CREATE INDEX "Player_fullName_idx" ON "Player"("fullName");

-- CreateIndex
CREATE INDEX "Player_rank_idx" ON "Player"("rank");

-- CreateIndex
CREATE INDEX "DraftQueue_teamId_idx" ON "DraftQueue"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftQueue_teamId_playerId_key" ON "DraftQueue"("teamId", "playerId");

-- CreateIndex
CREATE INDEX "PlayerRoster_teamId_idx" ON "PlayerRoster"("teamId");

-- CreateIndex
CREATE INDEX "PlayerRoster_leagueId_idx" ON "PlayerRoster"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRoster_teamId_playerId_key" ON "PlayerRoster"("teamId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRoster_leagueId_playerId_key" ON "PlayerRoster"("leagueId", "playerId");

-- CreateIndex
CREATE INDEX "DraftPick_leagueId_season_idx" ON "DraftPick"("leagueId", "season");

-- CreateIndex
CREATE INDEX "DraftPick_currentOwnerId_idx" ON "DraftPick"("currentOwnerId");

-- CreateIndex
CREATE INDEX "DraftPick_isComplete_idx" ON "DraftPick"("isComplete");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_leagueId_season_round_pickInRound_key" ON "DraftPick"("leagueId", "season", "round", "pickInRound");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_leagueId_season_overallPickNumber_key" ON "DraftPick"("leagueId", "season", "overallPickNumber");

-- CreateIndex
CREATE INDEX "Trade_leagueId_idx" ON "Trade"("leagueId");

-- CreateIndex
CREATE INDEX "Trade_status_idx" ON "Trade"("status");

-- CreateIndex
CREATE INDEX "Trade_initiatorTeamId_idx" ON "Trade"("initiatorTeamId");

-- CreateIndex
CREATE INDEX "Trade_receiverTeamId_idx" ON "Trade"("receiverTeamId");

-- CreateIndex
CREATE INDEX "TradeAsset_tradeId_idx" ON "TradeAsset"("tradeId");

-- CreateIndex
CREATE INDEX "TradeAsset_fromTeamId_idx" ON "TradeAsset"("fromTeamId");

-- CreateIndex
CREATE INDEX "TradeAsset_assetType_idx" ON "TradeAsset"("assetType");

-- CreateIndex
CREATE UNIQUE INDEX "DraftSettings_leagueId_key" ON "DraftSettings"("leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftState_leagueId_key" ON "DraftState"("leagueId");

-- CreateIndex
CREATE INDEX "DraftActivityLog_leagueId_idx" ON "DraftActivityLog"("leagueId");

-- CreateIndex
CREATE INDEX "DraftActivityLog_activityType_idx" ON "DraftActivityLog"("activityType");

-- CreateIndex
CREATE INDEX "DraftActivityLog_createdAt_idx" ON "DraftActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueInvite" ADD CONSTRAINT "LeagueInvite_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "League" ADD CONSTRAINT "League_commissionerId_fkey" FOREIGN KEY ("commissionerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMember" ADD CONSTRAINT "LeagueMember_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMember" ADD CONSTRAINT "LeagueMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftQueue" ADD CONSTRAINT "DraftQueue_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftQueue" ADD CONSTRAINT "DraftQueue_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRoster" ADD CONSTRAINT "PlayerRoster_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRoster" ADD CONSTRAINT "PlayerRoster_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_currentOwnerId_fkey" FOREIGN KEY ("currentOwnerId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftPick" ADD CONSTRAINT "DraftPick_originalOwnerId_fkey" FOREIGN KEY ("originalOwnerId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_initiatorTeamId_fkey" FOREIGN KEY ("initiatorTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_receiverTeamId_fkey" FOREIGN KEY ("receiverTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAsset" ADD CONSTRAINT "TradeAsset_draftPickId_fkey" FOREIGN KEY ("draftPickId") REFERENCES "DraftPick"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAsset" ADD CONSTRAINT "TradeAsset_fromTeamId_fkey" FOREIGN KEY ("fromTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAsset" ADD CONSTRAINT "TradeAsset_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeAsset" ADD CONSTRAINT "TradeAsset_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftSettings" ADD CONSTRAINT "DraftSettings_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftState" ADD CONSTRAINT "DraftState_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;
