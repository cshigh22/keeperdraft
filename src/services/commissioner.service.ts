// Commissioner Service
// "God Mode" controls for league commissioners

import { prisma } from '@/lib/prisma';
import type { DraftType } from '@prisma/client';

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

interface DraftSettingsInput {
  leagueId: string;
  draftType?: DraftType;
  totalRounds?: number;
  timerDurationSeconds?: number;
  reserveTimeSeconds?: number;
  pauseOnTrade?: boolean;
  maxKeepers?: number;
  scheduledStartTime?: Date;
}

interface GeneratePicksResult {
  success: boolean;
  totalPicks: number;
  rounds: number;
  teams: number;
}

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

    // Validate league exists and get current state
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

    // Validate draft hasn't started (or is paused)
    if (league.draftState?.status === 'IN_PROGRESS' && !league.draftState.isPaused) {
      throw new Error('Cannot change draft order while draft is in progress. Pause the draft first.');
    }

    if (league.draftState?.status === 'COMPLETED') {
      throw new Error('Cannot change draft order - draft has already completed');
    }

    // Validate all teams in the order belong to this league
    const leagueTeamIds = new Set(league.teams.map((t) => t.id));
    for (const teamId of teamOrderList) {
      if (!leagueTeamIds.has(teamId)) {
        throw new Error(`Team ${teamId} is not part of this league`);
      }
    }

    // Validate no duplicates
    if (new Set(teamOrderList).size !== teamOrderList.length) {
      throw new Error('Duplicate teams in order list');
    }

    // Validate all teams are included
    if (teamOrderList.length !== league.teams.length) {
      throw new Error(`Order list must include all ${league.teams.length} teams`);
    }

    // Update team positions and generate picks in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update each team's draft position
      const updatedTeams = await Promise.all(
        teamOrderList.map(async (teamId, index) => {
          const team = await tx.team.update({
            where: { id: teamId },
            data: { draftPosition: index + 1 },
            include: { owner: { select: { name: true } } },
          });
          return {
            id: team.id,
            name: team.name,
            draftPosition: index + 1,
            ownerName: team.owner.name,
          };
        })
      );

      // Delete existing draft picks (if draft hasn't started)
      if (!league.draftState || league.draftState.status === 'NOT_STARTED') {
        await tx.draftPick.deleteMany({
          where: { leagueId },
        });

        // Generate new draft picks
        const settings = league.draftSettings;
        const totalRounds = settings?.totalRounds || 15;
        const draftType = settings?.draftType || 'SNAKE';
        const season = new Date().getFullYear();

        if (totalRounds < 1) {
          throw new Error('Total rounds must be at least 1');
        }

        const picks: {
          leagueId: string;
          season: number;
          round: number;
          pickInRound: number;
          overallPickNumber: number;
          originalOwnerId: string;
          currentOwnerId: string;
        }[] = [];

        let overallPick = 1;

        for (let round = 1; round <= totalRounds; round++) {
          // Determine order for this round based on draft type
          let orderForRound: string[];

          switch (draftType) {
            case 'SNAKE':
              // Even rounds are reversed
              orderForRound = round % 2 === 0
                ? [...teamOrderList].reverse()
                : teamOrderList;
              break;
            case 'LINEAR':
              // Same order every round
              orderForRound = teamOrderList;
              break;
            case 'THIRD_ROUND_REVERSAL':
              // 1-10, 10-1, 10-1, 1-10, 1-10, 10-1, 10-1, ...
              // Round 1: normal, Round 2: reversed, Round 3: reversed, Round 4: normal, etc.
              const cycle = Math.floor((round - 1) / 2) % 2;
              const isReversedRound = round > 1 && (round === 2 || round === 3 || cycle === 1);
              orderForRound = isReversedRound
                ? [...teamOrderList].reverse()
                : teamOrderList;
              break;
            default:
              orderForRound = teamOrderList;
          }

          for (let pickInRound = 1; pickInRound <= teamOrderList.length; pickInRound++) {
            const teamId = orderForRound[pickInRound - 1];
            if (!teamId) continue;

            picks.push({
              leagueId,
              season,
              round,
              pickInRound,
              overallPickNumber: overallPick,
              originalOwnerId: teamId,
              currentOwnerId: teamId,
            });
            overallPick++;
          }
        }

        await tx.draftPick.createMany({ data: picks });

        return {
          teams: updatedTeams,
          picksGenerated: picks.length,
        };
      }

      return {
        teams: updatedTeams,
        picksGenerated: 0,
      };
    });

    // Log the activity
    await prisma.draftActivityLog.create({
      data: {
        leagueId,
        activityType: 'ORDER_UPDATED',
        description: 'Draft order set by commissioner',
        metadata: {
          newOrder: teamOrderList,
          picksGenerated: result.picksGenerated,
        },
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

    // Fisher-Yates shuffle
    const teamIds = league.teams.map((t) => t.id);
    for (let i = teamIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = teamIds[i];
      if (temp !== undefined) {
        teamIds[i] = teamIds[j]!;
        teamIds[j] = temp;
      }
    }

    return this.setDraftOrder({
      leagueId,
      teamOrderList: teamIds,
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

    // Validate league and check draft status
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { draftState: true },
    });

    if (!league) {
      throw new Error('League not found');
    }

    // Some settings can't be changed after draft starts
    if (league.draftState?.status === 'IN_PROGRESS' || league.draftState?.status === 'COMPLETED') {
      const restrictedFields = ['draftType', 'totalRounds', 'maxKeepers'];
      for (const field of restrictedFields) {
        if (settings[field as keyof typeof settings] !== undefined) {
          throw new Error(`Cannot change ${field} after draft has started`);
        }
      }
    }

    await prisma.draftSettings.upsert({
      where: { leagueId },
      create: {
        leagueId,
        draftType: settings.draftType || 'SNAKE',
        totalRounds: settings.totalRounds || 15,
        timerDurationSeconds: settings.timerDurationSeconds || 90,
        reserveTimeSeconds: settings.reserveTimeSeconds || 120,
        pauseOnTrade: settings.pauseOnTrade ?? true,
        maxKeepers: settings.maxKeepers || 3,
        scheduledStartTime: settings.scheduledStartTime,
      },
      update: settings,
    });

    await prisma.draftActivityLog.create({
      data: {
        leagueId,
        activityType: 'SETTINGS_CHANGED',
        description: 'Draft settings updated',
        metadata: settings,
      },
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

    // Calculate remaining time
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

    await prisma.draftActivityLog.create({
      data: {
        leagueId,
        activityType: 'DRAFT_PAUSED',
        description: reason || 'Draft paused by commissioner',
      },
    });
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

    await prisma.draftActivityLog.create({
      data: {
        leagueId,
        activityType: 'DRAFT_RESUMED',
        description: 'Draft resumed by commissioner',
      },
    });
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

    // Verify player exists and is available
    const player = await prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      throw new Error('Player not found');
    }

    // Check if already drafted
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
    await prisma.draftActivityLog.create({
      data: {
        leagueId,
        activityType: 'AUTO_PICK',
        description: `Commissioner forced pick: ${player.fullName}`,
        teamId: draftState.currentTeamId,
        pickNumber: draftState.currentPick,
        playerId,
      },
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
      include: {
        currentOwner: true,
      },
    });

    if (!lastPick || !lastPick.selectedPlayerId) {
      throw new Error('Last pick data not found');
    }

    const player = await prisma.player.findUnique({
      where: { id: lastPick.selectedPlayerId },
    });

    // Perform undo in transaction
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

    await prisma.draftActivityLog.create({
      data: {
        leagueId,
        activityType: 'PICK_UNDONE',
        description: `Commissioner undid pick: ${player?.fullName}`,
        teamId: lastPick.currentOwnerId,
        pickNumber: lastPick.overallPickNumber,
        playerId: lastPick.selectedPlayerId,
      },
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

    await prisma.draftActivityLog.create({
      data: {
        leagueId,
        activityType: 'TRADE_FORCED',
        description: `Commissioner force-approved trade`,
        tradeId,
        metadata: { notes },
      },
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

    await prisma.draftActivityLog.create({
      data: {
        leagueId,
        activityType: 'TRADE_CANCELLED',
        description: `Commissioner vetoed trade: ${reason || 'No reason given'}`,
        tradeId,
      },
    });
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
    // Validate team and player
    const team = await prisma.team.findFirst({
      where: { id: teamId, leagueId },
    });

    if (!team) {
      throw new Error('Team not found in this league');
    }

    const settings = await prisma.draftSettings.findUnique({
      where: { leagueId },
    });

    // Check keeper count
    const currentKeepers = await prisma.playerRoster.count({
      where: { teamId, leagueId, isKeeper: true },
    });

    if (currentKeepers >= (settings?.maxKeepers || 3)) {
      throw new Error(`Team already has maximum keepers (${settings?.maxKeepers || 3})`);
    }

    // Add or update keeper
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
  async getDraftActivity(leagueId: string, limit: number = 100): Promise<any[]> {
    return prisma.draftActivityLog.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
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

      // Reset all picks
      await tx.draftPick.updateMany({
        where: { leagueId },
        data: {
          selectedPlayerId: null,
          selectedAt: null,
          isComplete: false,
        },
      });

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

    await prisma.draftActivityLog.create({
      data: {
        leagueId,
        activityType: 'SETTINGS_CHANGED',
        description: 'Draft reset by commissioner',
      },
    });
  },
};

export default CommissionerService;
