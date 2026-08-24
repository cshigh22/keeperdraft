// Season Rollover
// Advances a league from its completed season to the next one, preserving
// history: draft picks stay (they are season-partitioned), rosters are
// snapshotted into RosterHistory, and the champion is recorded.

import { prisma } from '@/lib/prisma';
import { generatePickSlots } from '@/server/draft-pick-generator';
import { ROSTERED_PLAYER_WHERE } from '@/lib/roster-membership';

export interface RolloverSeasonInput {
  leagueId: string;
  // The season the caller believes is current. Guards against a stale tab
  // rolling the league forward twice.
  expectedSeason: number;
  championManagerName?: string;
  championTeamName?: string;
}

export interface RolloverSeasonResult {
  newSeason: number;
  rostersArchived: number;
  picksGenerated: number;
}

export async function rolloverSeason(input: RolloverSeasonInput): Promise<RolloverSeasonResult> {
  const { leagueId, expectedSeason } = input;

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: {
      teams: { orderBy: { draftPosition: 'asc' } },
      draftSettings: true,
      draftState: true,
    },
  });

  if (!league) {
    throw new Error('League not found');
  }
  // Season check first: a stale tab re-submitting after a rollover should hear
  // "already rolled over", not a confusing draft-status complaint.
  if (league.season !== expectedSeason) {
    throw new Error('This league has already been rolled over to a new season');
  }
  if (league.draftState?.status !== 'COMPLETED') {
    throw new Error('Season can only be rolled over after the draft is completed');
  }
  if (!league.draftSettings) {
    throw new Error('Draft settings not configured');
  }
  if (league.teams.length === 0) {
    throw new Error('League has no teams');
  }

  const settings = league.draftSettings;
  const teamOrderList = league.teams.map((t) => t.id);
  const oldSeason = league.season;
  const newSeason = oldSeason + 1;

  const result = await prisma.$transaction(
    async (tx) => {
      // Authoritative double-rollover guard: re-read under Serializable so two
      // racing submissions cannot both pass.
      const fresh = await tx.league.findUnique({
        where: { id: leagueId },
        select: { season: true },
      });
      if (fresh?.season !== expectedSeason) {
        throw new Error('This league has already been rolled over to a new season');
      }

      // 1. Archive final rosters. Non-keeper FREE_AGENT rows are pre-draft
      // marketplace signals, not rostered players — skipped and left in place.
      const rosters = await tx.playerRoster.findMany({
        where: { leagueId, ...ROSTERED_PLAYER_WHERE },
        include: {
          player: { select: { fullName: true, position: true, nflTeam: true } },
          team: { select: { name: true } },
        },
      });

      if (rosters.length > 0) {
        await tx.rosterHistory.createMany({
          data: rosters.map((entry) => ({
            leagueId,
            season: oldSeason,
            teamId: entry.teamId,
            teamName: entry.team.name,
            playerId: entry.playerId,
            playerName: entry.player.fullName,
            position: entry.player.position,
            nflTeam: entry.player.nflTeam,
            isKeeper: entry.isKeeper,
            keeperRound: entry.keeperRound,
            acquiredVia: entry.acquiredVia,
          })),
        });
      }

      // 2. Record the champion (upsert — the commissioner may already have
      // added this season via the Hall of Champions UI).
      const championManagerName = input.championManagerName?.trim();
      if (championManagerName) {
        const teamName = input.championTeamName?.trim() || championManagerName;
        await tx.pastWinner.upsert({
          where: { leagueId_season: { leagueId, season: oldSeason } },
          create: { leagueId, season: oldSeason, managerName: championManagerName, teamName },
          update: { managerName: championManagerName, teamName },
        });
      }

      // 3. Cancel any open trades — their assets refer to the closed season.
      await tx.trade.updateMany({
        where: { leagueId, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          respondedAt: new Date(),
          commissionerNotes: 'Cancelled due to season rollover',
        },
      });

      // 4. Every team re-picks keepers each season. Rosters stay — keeper
      // selection chooses from them, and saveKeepers replaces each team's
      // roster on submit.
      await tx.playerRoster.updateMany({
        where: { leagueId },
        data: { isKeeper: false, keeperRound: null },
      });

      // 5. A stale keeper deadline would hard-lock the new season's keeper
      // saves; the commissioner sets fresh dates in settings.
      await tx.draftSettings.update({
        where: { leagueId },
        data: { keeperDeadline: null, scheduledStartTime: null },
      });

      // 6. Advance the season.
      await tx.league.update({
        where: { id: leagueId },
        data: { season: newSeason },
      });

      // 7. Build the new season's board. Picks already traded into this season
      // exist as unslotted rows; generatePickSlots adopts them in place,
      // preserving their ownership and TradeAsset references.
      const picksGenerated = await generatePickSlots(tx, {
        leagueId,
        season: newSeason,
        teamOrderList,
        totalRounds: settings.totalRounds,
        draftType: settings.draftType,
        tradeMap: new Map(),
      });

      // 8. Fresh draft state for the new season.
      await tx.draftState.update({
        where: { leagueId },
        data: {
          status: 'NOT_STARTED',
          currentRound: 1,
          currentPick: 1,
          currentTeamId: null,
          isPaused: false,
          pauseReason: null,
          timerStartedAt: null,
          timerSecondsRemaining: null,
          lastPickId: null,
          undoAvailable: false,
          startedAt: null,
          completedAt: null,
          lastActivityAt: new Date(),
        },
      });

      // 9. Stale draft queues belong to the finished season.
      await tx.draftQueue.deleteMany({
        where: { team: { leagueId } },
      });

      return { rostersArchived: rosters.length, picksGenerated };
    },
    { isolationLevel: 'Serializable', timeout: 30000, maxWait: 10000 }
  );

  return { newSeason, ...result };
}
