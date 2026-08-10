// Commissioner Service
// "God Mode" controls for league commissioners

import { prisma } from '@/lib/prisma';
import { buildTradeMap, generatePickSlots } from '@/server/draft-pick-generator';
import type {
  DraftActivityLog,
  DraftActivityType,
  DraftType,
  Prisma,
} from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

interface SetDraftOrderInput {
  leagueId: string;
  teamOrderList: string[]; // Array of team IDs in desired order (index = draft position - 1)
}

interface SetDraftOrderResult {
  success: boolean;
  teams: {
    id: string;
    name: string;
    draftPosition: number;
    ownerName: string;
  }[];
  picksGenerated: number;
}

export interface DraftSettingsInput {
  leagueId: string;
  draftType?: DraftType;
  totalRounds?: number;
  timerDurationSeconds?: number;
  reserveTimeSeconds?: number;
  pauseOnTrade?: boolean;
  maxKeepers?: number;
  qbCount?: number;
  rbCount?: number;
  wrCount?: number;
  teCount?: number;
  flexCount?: number;
  superflexCount?: number;
  kCount?: number;
  defCount?: number;
  benchCount?: number;
  keeperDeadline?: Date | null;
  scheduledStartTime?: Date;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

const DEFAULT_TOTAL_ROUNDS = 15;
const DEFAULT_MAX_KEEPERS = 3;

// Settings that would invalidate existing picks/keepers once the draft has started
const LOCKED_AFTER_START: readonly (keyof Omit<DraftSettingsInput, 'leagueId'>)[] = [
  'draftType',
  'totalRounds',
  'maxKeepers',
];

async function logActivity(
  leagueId: string,
  activityType: DraftActivityType,
  description: string,
  extra: Partial<Prisma.DraftActivityLogUncheckedCreateInput> = {}
): Promise<void> {
  await prisma.draftActivityLog.create({
    data: { leagueId, activityType, description, ...extra },
  });
}

// Fisher-Yates shuffle (returns a new array)
function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

// Pick slot generation lives in the shared module (used here, by the socket
// server's DraftStateManager, and by season rollover).

// ============================================================================
// COMMISSIONER SERVICE
// ============================================================================

export const CommissionerService = {
  // ==========================================================================
  // DRAFT ORDER MANAGEMENT
  // ==========================================================================

  /**
   * Set the draft order for a league.
   * This is the primary method for commissioners to establish or modify the draft order.
   *
   * @param input - Contains leagueId and ordered array of team IDs
   * @returns Result with updated teams and generated picks count
   *
   * @example
   * await CommissionerService.setDraftOrder({
   *   leagueId: 'league-123',
   *   teamOrderList: ['team-5', 'team-2', 'team-8', 'team-1', ...] // First pick, second pick, etc.
   * });
   */
  async setDraftOrder(input: SetDraftOrderInput): Promise<SetDraftOrderResult> {
    const { leagueId, teamOrderList } = input;

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        teams: true,
        draftState: true,
        draftSettings: true,
      },
    });

    if (!league) {
      throw new Error('League not found');
    }

    // Order can only change before the draft or while it is paused
    if (league.draftState?.status === 'IN_PROGRESS' && !league.draftState.isPaused) {
      throw new Error(
        'Cannot change draft order while draft is in progress. Pause the draft first.'
      );
    }
    if (league.draftState?.status === 'COMPLETED') {
      throw new Error('Cannot change draft order - draft has already completed');
    }

    // The order list must be exactly the league's teams, once each
    const leagueTeamIds = new Set(league.teams.map((t) => t.id));
    for (const teamId of teamOrderList) {
      if (!leagueTeamIds.has(teamId)) {
        throw new Error(`Team ${teamId} is not part of this league`);
      }
    }
    if (new Set(teamOrderList).size !== teamOrderList.length) {
      throw new Error('Duplicate teams in order list');
    }
    if (teamOrderList.length !== league.teams.length) {
      throw new Error(`Order list must include all ${league.teams.length} teams`);
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Capture current ownership state for traded picks, so trades can
      // "follow the team" when the draft order changes. Scoped to this
      // season's slotted rows — unslotted rows are trade-materialized picks
      // for FUTURE seasons and must not leak onto this board.
      const currentPicks = await tx.draftPick.findMany({
        where: { leagueId, season: league.season, pickInRound: { not: null } },
        select: {
          round: true,
          originalOwnerId: true,
          currentOwnerId: true,
        },
      });

      const tradeMap = buildTradeMap(currentPicks);

      // 2. Clear all draft positions first to avoid unique constraint violations
      // (leagueId, draftPosition) is unique, so we can't swap directly without nulling first
      await tx.team.updateMany({
        where: { leagueId },
        data: { draftPosition: null },
      });

      // 3. Update each team's draft position
      const updatedTeams: SetDraftOrderResult['teams'] = [];
      for (const [index, teamId] of teamOrderList.entries()) {
        const team = await tx.team.update({
          where: { id: teamId },
          data: { draftPosition: index + 1 },
          include: { owner: { select: { name: true } } },
        });

        updatedTeams.push({
          id: team.id,
          name: team.name,
          draftPosition: index + 1,
          ownerName: team.owner?.name ?? 'No Owner',
        });
      }

      // 4. Regenerate draft picks (only if draft hasn't started)
      if (league.draftState && league.draftState.status !== 'NOT_STARTED') {
        return { teams: updatedTeams, picksGenerated: 0 };
      }

      const totalRounds = league.draftSettings?.totalRounds || DEFAULT_TOTAL_ROUNDS;
      if (totalRounds < 1) {
        throw new Error('Total rounds must be at least 1');
      }

      const picksGenerated = await generatePickSlots(tx, {
        leagueId,
        season: league.season,
        teamOrderList,
        totalRounds,
        draftType: league.draftSettings?.draftType || 'SNAKE',
        tradeMap,
      });

      return { teams: updatedTeams, picksGenerated };
    });

    await logActivity(leagueId, 'ORDER_UPDATED', 'Draft order set by commissioner', {
      metadata: {
        newOrder: teamOrderList,
        picksGenerated: result.picksGenerated,
      },
    });

    return {
      success: true,
      teams: result.teams,
      picksGenerated: result.picksGenerated,
    };
  },

  /**
   * Randomize the draft order
   */
  async randomizeDraftOrder(leagueId: string): Promise<SetDraftOrderResult> {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { teams: true },
    });

    if (!league) {
      throw new Error('League not found');
    }

    return this.setDraftOrder({
      leagueId,
      teamOrderList: shuffle(league.teams.map((t) => t.id)),
    });
  },

  // ==========================================================================
  // DRAFT SETTINGS
  // ==========================================================================

  /**
   * Update draft settings
   */
  async updateDraftSettings(input: DraftSettingsInput): Promise<void> {
    const { leagueId, ...settings } = input;

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { draftState: true },
    });

    if (!league) {
      throw new Error('League not found');
    }

    // Some settings can't be changed after draft starts
    if (league.draftState?.status === 'IN_PROGRESS' || league.draftState?.status === 'COMPLETED') {
      for (const field of LOCKED_AFTER_START) {
        if (settings[field] !== undefined) {
          throw new Error(`Cannot change ${field} after draft has started`);
        }
      }
    }

    await prisma.draftSettings.upsert({
      where: { leagueId },
      create: {
        leagueId,
        draftType: settings.draftType || 'SNAKE',
        totalRounds: settings.totalRounds || DEFAULT_TOTAL_ROUNDS,
        timerDurationSeconds: settings.timerDurationSeconds || 90,
        reserveTimeSeconds: settings.reserveTimeSeconds || 120,
        pauseOnTrade: settings.pauseOnTrade ?? true,
        maxKeepers: settings.maxKeepers || DEFAULT_MAX_KEEPERS,
        qbCount: settings.qbCount || 1,
        rbCount: settings.rbCount || 2,
        wrCount: settings.wrCount || 3,
        teCount: settings.teCount || 1,
        flexCount: settings.flexCount || 2,
        superflexCount: settings.superflexCount || 0,
        kCount: settings.kCount || 1,
        defCount: settings.defCount || 1,
        benchCount: settings.benchCount || 9,
        scheduledStartTime: settings.scheduledStartTime,
      },
      update: settings,
    });

    await logActivity(leagueId, 'SETTINGS_CHANGED', 'Draft settings updated', {
      metadata: settings,
    });
  },

  /**
   * Get draft settings
   */
  async getDraftSettings(leagueId: string) {
    return prisma.draftSettings.findUnique({
      where: { leagueId },
    });
  },

  /**
   * Toggle between Snake and Linear draft
   */
  async setDraftType(leagueId: string, draftType: DraftType): Promise<void> {
    await this.updateDraftSettings({ leagueId, draftType });

    // Regenerate picks if draft hasn't started
    const draftState = await prisma.draftState.findUnique({
      where: { leagueId },
    });

    if (!draftState || draftState.status === 'NOT_STARTED') {
      const teams = await prisma.team.findMany({
        where: { leagueId },
        orderBy: { draftPosition: 'asc' },
      });

      if (teams.length > 0) {
        await this.setDraftOrder({
          leagueId,
          teamOrderList: teams.map((t) => t.id),
        });
      }
    }
  },

  // ==========================================================================
  // LIVE DRAFT CONTROLS
  //
  // DEAD CODE — nothing calls the methods below. The live implementations run
  // in the socket server's DraftStateManager (src/server/draft-state-manager.ts).
  // Several of these lack the season scoping the live twins have; do not wire
  // them up without reconciling.
  // ==========================================================================

  /**
   * Pause the draft
   */
  async pauseDraft(leagueId: string, reason?: string): Promise<void> {
    const draftState = await prisma.draftState.findUnique({
      where: { leagueId },
    });

    if (!draftState || draftState.status !== 'IN_PROGRESS') {
      throw new Error('Draft is not in progress');
    }
    if (draftState.isPaused) {
      throw new Error('Draft is already paused');
    }

    // Freeze the clock: subtract time elapsed since the timer last started
    let remainingTime = draftState.timerSecondsRemaining || 0;
    if (draftState.timerStartedAt) {
      const elapsed = Math.floor((Date.now() - draftState.timerStartedAt.getTime()) / 1000);
      remainingTime = Math.max(0, remainingTime - elapsed);
    }

    await prisma.draftState.update({
      where: { leagueId },
      data: {
        isPaused: true,
        pauseReason: reason || 'Paused by commissioner',
        timerSecondsRemaining: remainingTime,
        timerStartedAt: null,
        lastActivityAt: new Date(),
      },
    });

    await logActivity(leagueId, 'DRAFT_PAUSED', reason || 'Draft paused by commissioner');
  },

  /**
   * Resume the draft
   */
  async resumeDraft(leagueId: string): Promise<void> {
    const draftState = await prisma.draftState.findUnique({
      where: { leagueId },
    });

    if (!draftState || draftState.status !== 'IN_PROGRESS') {
      throw new Error('Draft is not in progress');
    }
    if (!draftState.isPaused) {
      throw new Error('Draft is not paused');
    }

    await prisma.draftState.update({
      where: { leagueId },
      data: {
        isPaused: false,
        pauseReason: null,
        timerStartedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });

    await logActivity(leagueId, 'DRAFT_RESUMED', 'Draft resumed by commissioner');
  },

  /**
   * Force a pick for the current team
   */
  async forcePick(leagueId: string, playerId: string): Promise<void> {
    const draftState = await prisma.draftState.findUnique({
      where: { leagueId },
    });

    if (!draftState || draftState.status !== 'IN_PROGRESS') {
      throw new Error('Draft is not in progress');
    }
    if (!draftState.currentTeamId) {
      throw new Error('No team currently on the clock');
    }

    const player = await prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      throw new Error('Player not found');
    }

    const alreadyDrafted = await prisma.draftPick.findFirst({
      where: {
        leagueId,
        selectedPlayerId: playerId,
        isComplete: true,
      },
    });

    if (alreadyDrafted) {
      throw new Error('Player has already been drafted');
    }

    // The actual pick will be handled by the socket server
    // This method just validates and logs the force pick request
    await logActivity(leagueId, 'AUTO_PICK', `Commissioner forced pick: ${player.fullName}`, {
      teamId: draftState.currentTeamId,
      pickNumber: draftState.currentPick,
      playerId,
    });
  },

  /**
   * Undo the last pick
   */
  async undoLastPick(leagueId: string): Promise<{
    pickId: string;
    playerId: string;
    playerName: string;
    teamId: string;
  } | null> {
    const draftState = await prisma.draftState.findUnique({
      where: { leagueId },
    });

    if (!draftState || !draftState.lastPickId || !draftState.undoAvailable) {
      throw new Error('No pick available to undo');
    }

    const lastPick = await prisma.draftPick.findUnique({
      where: { id: draftState.lastPickId },
    });

    if (!lastPick || !lastPick.selectedPlayerId) {
      throw new Error('Last pick data not found');
    }

    const player = await prisma.player.findUnique({
      where: { id: lastPick.selectedPlayerId },
    });

    await prisma.$transaction(async (tx) => {
      // Remove player from roster
      await tx.playerRoster.deleteMany({
        where: {
          teamId: lastPick.currentOwnerId,
          playerId: lastPick.selectedPlayerId!,
          leagueId,
        },
      });

      // Reset the pick
      await tx.draftPick.update({
        where: { id: lastPick.id },
        data: {
          selectedPlayerId: null,
          selectedAt: null,
          isComplete: false,
        },
      });

      // Reset draft state to previous pick
      await tx.draftState.update({
        where: { leagueId },
        data: {
          status: 'IN_PROGRESS',
          currentRound: lastPick.round,
          currentPick: lastPick.overallPickNumber || draftState.currentPick - 1,
          currentTeamId: lastPick.currentOwnerId,
          lastPickId: null,
          undoAvailable: false,
          completedAt: null,
          lastActivityAt: new Date(),
        },
      });
    });

    await logActivity(leagueId, 'PICK_UNDONE', `Commissioner undid pick: ${player?.fullName}`, {
      teamId: lastPick.currentOwnerId,
      pickNumber: lastPick.overallPickNumber,
      playerId: lastPick.selectedPlayerId,
    });

    return {
      pickId: lastPick.id,
      playerId: lastPick.selectedPlayerId,
      playerName: player?.fullName || 'Unknown',
      teamId: lastPick.currentOwnerId,
    };
  },

  // ==========================================================================
  // TRADE MANAGEMENT
  // ==========================================================================

  /**
   * Force push a trade (approve without receiver consent)
   */
  async forceApproveTrade(leagueId: string, tradeId: string, notes?: string): Promise<void> {
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
    });

    if (!trade) {
      throw new Error('Trade not found');
    }
    if (trade.leagueId !== leagueId) {
      throw new Error('Trade does not belong to this league');
    }
    if (trade.status !== 'PENDING') {
      throw new Error(`Trade cannot be approved - status is ${trade.status}`);
    }

    // Mark for force approval - actual processing handled by socket server
    await prisma.trade.update({
      where: { id: tradeId },
      data: {
        commissionerNotes: notes,
      },
    });

    await logActivity(leagueId, 'TRADE_FORCED', 'Commissioner force-approved trade', {
      tradeId,
      metadata: { notes },
    });
  },

  /**
   * Veto a trade
   */
  async vetoTrade(leagueId: string, tradeId: string, reason?: string): Promise<void> {
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
    });

    if (!trade) {
      throw new Error('Trade not found');
    }
    if (trade.leagueId !== leagueId) {
      throw new Error('Trade does not belong to this league');
    }
    if (trade.status !== 'PENDING' && trade.status !== 'ACCEPTED') {
      throw new Error(`Trade cannot be vetoed - status is ${trade.status}`);
    }

    await prisma.trade.update({
      where: { id: tradeId },
      data: {
        status: 'VETOED',
        respondedAt: new Date(),
        commissionerNotes: reason,
      },
    });

    await logActivity(
      leagueId,
      'TRADE_CANCELLED',
      `Commissioner vetoed trade: ${reason || 'No reason given'}`,
      { tradeId }
    );
  },

  // ==========================================================================
  // KEEPER MANAGEMENT
  // ==========================================================================

  /**
   * Set a player as a keeper for a team
   */
  async setKeeper(
    leagueId: string,
    teamId: string,
    playerId: string,
    keeperRound: number
  ): Promise<void> {
    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
    });

    if (!team) {
      throw new Error('Team not found in this league');
    }

    const settings = await prisma.draftSettings.findUnique({
      where: { leagueId },
    });
    const maxKeepers = settings?.maxKeepers || DEFAULT_MAX_KEEPERS;

    const currentKeepers = await prisma.playerRoster.count({
      where: { teamId, leagueId, isKeeper: true },
    });

    if (currentKeepers >= maxKeepers) {
      throw new Error(`Team already has maximum keepers (${maxKeepers})`);
    }

    await prisma.playerRoster.upsert({
      where: {
        teamId_playerId: { teamId, playerId },
      },
      create: {
        teamId,
        playerId,
        leagueId,
        isKeeper: true,
        keeperRound,
        acquiredVia: 'KEEPER',
      },
      update: {
        isKeeper: true,
        keeperRound,
      },
    });
  },

  /**
   * Remove a keeper designation
   */
  async removeKeeper(leagueId: string, teamId: string, playerId: string): Promise<void> {
    await prisma.playerRoster.updateMany({
      where: {
        teamId,
        playerId,
        leagueId,
        isKeeper: true,
      },
      data: {
        isKeeper: false,
        keeperRound: null,
      },
    });
  },

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Get all draft activity for a league
   */
  async getDraftActivity(leagueId: string, limit: number = 100): Promise<DraftActivityLog[]> {
    return prisma.draftActivityLog.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  /**
   * Manually assign pick owner (Commissioner God Mode)
   */
  async manuallyAssignPickOwner(
    leagueId: string,
    pickId: string,
    newOwnerId: string
  ): Promise<void> {
    const pick = await prisma.draftPick.findUnique({
      where: { id: pickId },
    });

    if (!pick || pick.leagueId !== leagueId) {
      throw new Error('Pick not found in this league');
    }
    if (pick.isComplete) {
      throw new Error('Cannot change ownership of a pick that has already been made');
    }

    const team = await prisma.team.findUnique({
      where: { id: newOwnerId },
    });

    if (!team || team.leagueId !== leagueId) {
      throw new Error('Target team not found in this league');
    }

    await prisma.draftPick.update({
      where: { id: pickId },
      data: { currentOwnerId: newOwnerId },
    });

    await logActivity(
      leagueId,
      'ORDER_UPDATED',
      `Commissioner manually assigned pick ${pick.round}.${pick.pickInRound} to ${team.name}`,
      {
        metadata: {
          pickId,
          oldOwnerId: pick.currentOwnerId,
          newOwnerId,
          round: pick.round,
          pickInRound: pick.pickInRound,
        },
      }
    );
  },

  /**
   * Reset the draft (delete all picks, reset state)
   */
  async resetDraft(leagueId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // Delete all player rosters (except keepers)
      await tx.playerRoster.deleteMany({
        where: {
          leagueId,
          isKeeper: false,
        },
      });

      // Reset all picks AND return traded picks to original owners.
      // Raw query because Prisma updateMany can't set column = another column.
      await tx.$executeRawUnsafe(
        `UPDATE "DraftPick" SET "selectedPlayerId" = NULL, "selectedAt" = NULL, "isComplete" = false, "currentOwnerId" = "originalOwnerId" WHERE "leagueId" = $1`,
        leagueId
      );

      // Reset draft state
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
        },
      });

      // Cancel all pending trades
      await tx.trade.updateMany({
        where: {
          leagueId,
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
          respondedAt: new Date(),
          commissionerNotes: 'Cancelled due to draft reset',
        },
      });
    });

    await logActivity(leagueId, 'SETTINGS_CHANGED', 'Draft reset by commissioner');
  },
};

export default CommissionerService;
