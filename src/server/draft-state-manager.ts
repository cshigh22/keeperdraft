// Draft State Manager
// Manages the real-time state machine for the draft

import type { PrismaClient, DraftStatus, DraftType } from '@prisma/client';
import type { Server } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  StateSyncPayload,
  TeamSummary,
  DraftPickSummary,
  PlayerSummary,
  RosterPlayer,
  PickMadePayload,
  OnTheClockPayload,
  DraftStartPayload,
  DraftPausePayload,
  OrderUpdatedPayload,
} from '@/types/socket';
import { SocketEvents } from '@/types/socket';

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

interface DraftStateCache {
  status: DraftStatus;
  currentRound: number;
  currentPick: number;
  currentTeamId: string | null;
  isPaused: boolean;
  pauseReason: string | null;
  timerSecondsRemaining: number | null;
  timerStartedAt: Date | null;
}

export class DraftStateManager {
  private leagueId: string;
  private prisma: PrismaClient;
  private io: TypedServer;
  private timerInterval: NodeJS.Timeout | null = null;
  private stateCache: DraftStateCache | null = null;

  constructor(leagueId: string, prisma: PrismaClient, io: TypedServer) {
    this.leagueId = leagueId;
    this.prisma = prisma;
    this.io = io;
  }

  private getRoomName(): string {
    return `draft:${this.leagueId}`;
  }

  // ===========================================================================
  // STATE RETRIEVAL
  // ===========================================================================

  async getCurrentState(): Promise<DraftStateCache> {
    if (this.stateCache) {
      return this.stateCache;
    }

    const state = await this.prisma.draftState.findUnique({
      where: { leagueId: this.leagueId },
    });

    if (!state) {
      // Return default state if none exists
      return {
        status: 'NOT_STARTED',
        currentRound: 1,
        currentPick: 1,
        currentTeamId: null,
        isPaused: false,
        pauseReason: null,
        timerSecondsRemaining: null,
        timerStartedAt: null,
      };
    }

    this.stateCache = {
      status: state.status,
      currentRound: state.currentRound,
      currentPick: state.currentPick,
      currentTeamId: state.currentTeamId,
      isPaused: state.isPaused,
      pauseReason: state.pauseReason,
      timerSecondsRemaining: state.timerSecondsRemaining,
      timerStartedAt: state.timerStartedAt,
    };

    return this.stateCache;
  }

  clearStateCache(): void {
    this.stateCache = null;
  }

  async syncCurrentTeam(): Promise<string | null> {
    const state = await this.getCurrentState();

    console.log(`[syncCurrentTeam] status=${state.status}, currentPick=${state.currentPick}, currentTeamId=${state.currentTeamId}`);

    if (state.status !== 'IN_PROGRESS' && state.status !== 'PAUSED') {
      console.log(`[syncCurrentTeam] Early return - status is ${state.status}`);
      return state.currentTeamId;
    }

    const [currentPick, settings] = await Promise.all([
      this.prisma.draftPick.findFirst({
        where: {
          leagueId: this.leagueId,
          overallPickNumber: state.currentPick,
        },
      }),
      this.prisma.draftSettings.findUnique({
        where: { leagueId: this.leagueId },
      }),
    ]);

    console.log(`[syncCurrentTeam] pick currentOwnerId=${currentPick?.currentOwnerId}, state currentTeamId=${state.currentTeamId}, match=${currentPick?.currentOwnerId === state.currentTeamId}`);

    if (currentPick && currentPick.currentOwnerId !== state.currentTeamId) {
      console.log(`[DraftStateManager] Syncing current team: ${state.currentTeamId} -> ${currentPick.currentOwnerId}`);

      const timerDuration = settings?.timerDurationSeconds || 90;
      const now = new Date();

      await this.prisma.draftState.update({
        where: { leagueId: this.leagueId },
        data: {
          currentTeamId: currentPick.currentOwnerId,
          timerSecondsRemaining: timerDuration,
          timerStartedAt: state.status === 'IN_PROGRESS' ? now : null,
        },
      });

      this.stateCache = null;
      const newState = await this.getCurrentState();

      // Broadcast update to all clients
      const teams = await this.getTeamsWithOrder();
      const team = teams.find((t) => t.id === currentPick.currentOwnerId);

      if (team) {
        const payload: OnTheClockPayload = {
          leagueId: this.leagueId,
          teamId: team.id,
          team: team,
          pickNumber: newState.currentPick,
          round: newState.currentRound,
          timerDuration: timerDuration,
          timerStartedAt: newState.timerStartedAt?.toISOString() || now.toISOString(),
        };

        this.io.to(this.getRoomName()).emit(SocketEvents.ON_THE_CLOCK, payload);
      }

      // If draft is in progress, restart the timer with full duration
      if (state.status === 'IN_PROGRESS') {
        this.startTimer(timerDuration);
      }

      return currentPick.currentOwnerId;
    }

    return state.currentTeamId;
  }

  async getFullState(): Promise<StateSyncPayload> {
    const [state, settings, teams, allPicks, players, pendingTrades, teamRosters] = await Promise.all([
      this.getCurrentState(),
      this.prisma.draftSettings.findUnique({ where: { leagueId: this.leagueId } }),
      this.getTeamsWithOrder(),
      this.getAllPicks(),
      this.getAvailablePlayers(),
      this.getPendingTrades(),
      this.getTeamRosters(),
    ]);

    const completedPicks = allPicks.filter(p => p.isComplete);

    const currentTeam = state.currentTeamId
      ? teams.find((t) => t.id === state.currentTeamId) || null
      : null;

    return {
      leagueId: this.leagueId,
      status: state.status,
      currentRound: state.currentRound,
      currentPick: state.currentPick,
      currentTeamId: state.currentTeamId,
      currentTeam,
      isPaused: state.isPaused,
      pauseReason: state.pauseReason,
      timerSecondsRemaining: state.timerSecondsRemaining,
      draftOrder: teams,
      completedPicks,
      allPicks,
      availablePlayers: players,
      teamRosters,
      pendingTrades,
      totalRounds: settings?.totalRounds || 14,
      draftType: (settings?.draftType as 'SNAKE' | 'LINEAR') || 'SNAKE',
      // Map roster settings from database (requires generated prisma client to be in sync)
      rosterSettings: settings ? {
        qbCount: settings.qbCount,
        rbCount: settings.rbCount,
        wrCount: settings.wrCount,
        teCount: settings.teCount,
        flexCount: settings.flexCount,
        superflexCount: settings.superflexCount,
        kCount: settings.kCount,
        defCount: settings.defCount,
        benchCount: settings.benchCount,
      } : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private async getTeamsWithOrder(): Promise<TeamSummary[]> {
    const teams = await this.prisma.team.findMany({
      where: { leagueId: this.leagueId },
      include: { owner: { select: { name: true } } },
      orderBy: { draftPosition: 'asc' },
    });

    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      ownerId: team.ownerId,
      ownerName: team.owner.name,
      draftPosition: team.draftPosition || 0,
    }));
  }

  async getTeamRoster(teamId: string): Promise<RosterPlayer[]> {
    const rosters = await this.prisma.playerRoster.findMany({
      where: { leagueId: this.leagueId, teamId },
      include: { player: true },
    });

    return rosters.map((r) => ({
      id: r.player.id,
      sleeperId: r.player.sleeperId,
      fullName: r.player.fullName,
      position: r.player.position,
      nflTeam: r.player.nflTeam,
      rank: r.player.rank,
      adp: r.player.adp,
      bye: r.player.byeWeek,
      injuryStatus: r.player.injuryStatus,
      isKeeper: r.isKeeper,
      round: r.keeperRound || undefined,
    }));
  }

  private async getAllPicks(): Promise<DraftPickSummary[]> {
    const picks = await this.prisma.draftPick.findMany({
      where: {
        leagueId: this.leagueId,
      },
      include: {
        currentOwner: { include: { owner: { select: { name: true } } } },
        originalOwner: true,
      },
      orderBy: { overallPickNumber: 'asc' },
    });

    // Get selected players for completed picks
    const playerIds = picks
      .filter((p) => p.selectedPlayerId)
      .map((p) => p.selectedPlayerId as string);

    const players = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
    });

    const playerMap = new Map(players.map((p) => [p.id, p]));

    return picks.map((pick) => {
      const player = pick.selectedPlayerId ? playerMap.get(pick.selectedPlayerId) : null;
      return {
        id: pick.id,
        season: pick.season,
        round: pick.round,
        pickInRound: pick.pickInRound || 0,
        overallPickNumber: pick.overallPickNumber || 0,
        currentOwnerId: pick.currentOwnerId,
        currentOwnerName: pick.currentOwner.owner.name,
        originalOwnerId: pick.originalOwnerId,
        isComplete: pick.isComplete,
        selectedPlayer: player
          ? {
            id: player.id,
            sleeperId: player.sleeperId,
            fullName: player.fullName,
            position: player.position,
            nflTeam: player.nflTeam,
            rank: player.rank,
            adp: player.adp,
            bye: player.byeWeek,
          }
          : undefined,
        selectedAt: pick.selectedAt?.toISOString(),
      };
    });
  }

  private async getTeamRosters(): Promise<Record<string, RosterPlayer[]>> {
    const rosters = await this.prisma.playerRoster.findMany({
      where: { leagueId: this.leagueId },
      include: { player: true },
    });

    const rostersByTeam: Record<string, RosterPlayer[]> = {};
    rosters.forEach((r) => {
      if (!rostersByTeam[r.teamId]) rostersByTeam[r.teamId] = [];
      const teamRoster = rostersByTeam[r.teamId];
      if (teamRoster) {
        teamRoster.push({
          id: r.player.id,
          sleeperId: r.player.sleeperId,
          fullName: r.player.fullName,
          position: r.player.position,
          nflTeam: r.player.nflTeam,
          rank: r.player.rank,
          adp: r.player.adp,
          bye: r.player.byeWeek,
          injuryStatus: r.player.injuryStatus,
          isKeeper: r.isKeeper,
          round: r.keeperRound || undefined,
        });
      }
    });
    return rostersByTeam;
  }

  private async getAvailablePlayers(): Promise<PlayerSummary[]> {
    // Get all drafted player IDs in this league
    const draftedPlayerIds = await this.prisma.draftPick.findMany({
      where: {
        leagueId: this.leagueId,
        isComplete: true,
        selectedPlayerId: { not: null },
      },
      select: { selectedPlayerId: true },
    });

    const draftedIds = draftedPlayerIds
      .map((p) => p.selectedPlayerId)
      .filter((id): id is string => id !== null);

    // Get keeper player IDs
    const keeperPlayerIds = await this.prisma.playerRoster.findMany({
      where: {
        leagueId: this.leagueId,
        isKeeper: true,
      },
      select: { playerId: true },
    });

    const keeperIds = keeperPlayerIds.map((p) => p.playerId);
    const unavailableIds = [...new Set([...draftedIds, ...keeperIds])];

    // Get available players
    const players = await this.prisma.player.findMany({
      where: {
        id: { notIn: unavailableIds },
        status: 'ACTIVE',
      },
      orderBy: { rank: 'asc' },
      take: 500, // Limit for performance
    });

    return players.map((player) => ({
      id: player.id,
      sleeperId: player.sleeperId,
      fullName: player.fullName,
      position: player.position,
      nflTeam: player.nflTeam,
      rank: player.rank,
      adp: player.adp,
      bye: player.byeWeek,
    }));
  }

  private async getPendingTrades(): Promise<any[]> {
    const trades = await this.prisma.trade.findMany({
      where: {
        leagueId: this.leagueId,
        status: 'PENDING',
      },
      include: {
        initiatorTeam: { include: { owner: { select: { name: true } } } },
        receiverTeam: { include: { owner: { select: { name: true } } } },
        assets: {
          include: {
            draftPick: true,
            player: true,
          },
        },
      },
    });

    return trades.map((trade) => ({
      leagueId: this.leagueId,
      tradeId: trade.id,
      initiatorTeam: {
        id: trade.initiatorTeam.id,
        name: trade.initiatorTeam.name,
        ownerId: trade.initiatorTeam.ownerId,
        ownerName: trade.initiatorTeam.owner.name,
        draftPosition: trade.initiatorTeam.draftPosition || 0,
      },
      receiverTeam: {
        id: trade.receiverTeam.id,
        name: trade.receiverTeam.name,
        ownerId: trade.receiverTeam.ownerId,
        ownerName: trade.receiverTeam.owner.name,
        draftPosition: trade.receiverTeam.draftPosition || 0,
      },
      initiatorAssets: trade.assets
        .filter((a) => a.fromTeamId === trade.initiatorTeamId)
        .map((a) => this.mapAsset(a)),
      receiverAssets: trade.assets
        .filter((a) => a.fromTeamId === trade.receiverTeamId)
        .map((a) => this.mapAsset(a)),
      expiresAt: trade.expiresAt?.toISOString(),
      timestamp: trade.proposedAt.toISOString(),
    }));
  }

  private mapAsset(asset: any): any {
    return {
      id: asset.id,
      assetType: asset.assetType,
      fromTeamId: asset.fromTeamId,
      draftPick: asset.draftPick
        ? {
          id: asset.draftPick.id,
          round: asset.draftPick.round,
          season: asset.draftPick.season,
          overallPickNumber: asset.draftPick.overallPickNumber,
        }
        : undefined,
      player: asset.player
        ? {
          id: asset.player.id,
          sleeperId: asset.player.sleeperId,
          fullName: asset.player.fullName,
          position: asset.player.position,
          nflTeam: asset.player.nflTeam,
          rank: asset.player.rank,
        }
        : undefined,
      futurePickSeason: asset.futurePickSeason,
      futurePickRound: asset.futurePickRound,
    };
  }

  // ===========================================================================
  // DRAFT LIFECYCLE
  // ===========================================================================

  async startDraft(): Promise<void> {
    const settings = await this.prisma.draftSettings.findUnique({
      where: { leagueId: this.leagueId },
    });

    if (!settings) {
      throw new Error('Draft settings not configured');
    }

    // Get teams in draft order
    const teams = await this.getTeamsWithOrder();
    if (teams.length === 0) {
      throw new Error('No teams in league');
    }

    // Verify draft picks exist and find who owns pick #1
    // (may differ from teams[0] if picks were traded pre-draft)
    const firstPick = await this.prisma.draftPick.findFirst({
      where: {
        leagueId: this.leagueId,
        overallPickNumber: 1,
      },
    });

    if (!firstPick) {
      throw new Error('Draft picks not generated. Please generate picks first.');
    }

    // The team on the clock is whoever currently owns pick #1
    const firstTeamOnClock = teams.find(t => t.id === firstPick.currentOwnerId) || teams[0];
    if (!firstTeamOnClock) {
      throw new Error('Could not determine first team to pick');
    }

    console.log(`[startDraft] Pick #1 owner: ${firstPick.currentOwnerId}, team on clock: ${firstTeamOnClock.name} (${firstTeamOnClock.id})`);

    const now = new Date();

    // Create or update draft state
    await this.prisma.draftState.upsert({
      where: { leagueId: this.leagueId },
      create: {
        leagueId: this.leagueId,
        status: 'IN_PROGRESS',
        currentRound: 1,
        currentPick: 1,
        currentTeamId: firstTeamOnClock.id,
        isPaused: false,
        timerStartedAt: now,
        timerSecondsRemaining: settings.timerDurationSeconds,
        startedAt: now,
        lastActivityAt: now,
      },
      update: {
        status: 'IN_PROGRESS',
        currentRound: 1,
        currentPick: 1,
        currentTeamId: firstTeamOnClock.id,
        isPaused: false,
        timerStartedAt: now,
        timerSecondsRemaining: settings.timerDurationSeconds,
        startedAt: now,
        lastActivityAt: now,
      },
    });

    // Clear cache
    this.stateCache = null;

    // Log activity
    await this.prisma.draftActivityLog.create({
      data: {
        leagueId: this.leagueId,
        activityType: 'DRAFT_STARTED',
        description: 'Draft started',
      },
    });

    // Broadcast draft start
    const payload: DraftStartPayload = {
      leagueId: this.leagueId,
      startedAt: now.toISOString(),
      currentPick: 1,
      currentTeamId: firstTeamOnClock.id,
      currentTeam: firstTeamOnClock,
      timerDuration: settings.timerDurationSeconds,
      draftOrder: teams,
    };

    this.io.to(this.getRoomName()).emit(SocketEvents.DRAFT_START, payload);

    // Start the timer
    this.startTimer(settings.timerDurationSeconds);
  }

  async pauseDraft(reason: string, pausedBy: string): Promise<void> {
    const state = await this.getCurrentState();

    // Calculate remaining time
    let remainingTime = state.timerSecondsRemaining || 0;
    if (state.timerStartedAt && !state.isPaused) {
      const elapsed = Math.floor((Date.now() - state.timerStartedAt.getTime()) / 1000);
      remainingTime = Math.max(0, (state.timerSecondsRemaining || 0) - elapsed);
    }

    // Stop the timer
    this.stopTimer();

    // Update state
    await this.prisma.draftState.update({
      where: { leagueId: this.leagueId },
      data: {
        isPaused: true,
        pauseReason: reason,
        timerSecondsRemaining: remainingTime,
        timerStartedAt: null,
        lastActivityAt: new Date(),
      },
    });

    this.stateCache = null;

    // Log activity
    await this.prisma.draftActivityLog.create({
      data: {
        leagueId: this.leagueId,
        activityType: 'DRAFT_PAUSED',
        description: `Draft paused: ${reason}`,
        triggeredById: pausedBy === 'system' ? null : pausedBy,
      },
    });

    // Broadcast pause
    const payload: DraftPausePayload = {
      leagueId: this.leagueId,
      isPaused: true,
      reason,
      pausedBy,
      timerSecondsRemaining: remainingTime,
      timestamp: new Date().toISOString(),
    };

    this.io.to(this.getRoomName()).emit(SocketEvents.DRAFT_PAUSE, payload);
  }

  async resumeDraft(): Promise<void> {
    const state = await this.getCurrentState();
    const settings = await this.prisma.draftSettings.findUnique({
      where: { leagueId: this.leagueId },
    });

    const remainingTime = state.timerSecondsRemaining || settings?.timerDurationSeconds || 90;

    // Update state
    await this.prisma.draftState.update({
      where: { leagueId: this.leagueId },
      data: {
        isPaused: false,
        pauseReason: null,
        timerStartedAt: new Date(),
        timerSecondsRemaining: remainingTime,
        lastActivityAt: new Date(),
      },
    });

    this.stateCache = null;

    // Log activity
    await this.prisma.draftActivityLog.create({
      data: {
        leagueId: this.leagueId,
        activityType: 'DRAFT_RESUMED',
        description: 'Draft resumed',
      },
    });

    // Broadcast resume
    const payload: DraftPausePayload = {
      leagueId: this.leagueId,
      isPaused: false,
      timerSecondsRemaining: remainingTime,
      timestamp: new Date().toISOString(),
    };

    this.io.to(this.getRoomName()).emit(SocketEvents.DRAFT_RESUME, payload);

    // Restart the timer
    this.startTimer(remainingTime);
  }

  // ===========================================================================
  // PICK MANAGEMENT
  // ===========================================================================

  async canTeamPick(teamId: string, isCommissioner: boolean): Promise<boolean> {
    const state = await this.getCurrentState();

    if (state.status !== 'IN_PROGRESS') {
      return false;
    }

    if (state.isPaused) {
      return false;
    }

    // Commissioner can always make picks (for force pick)
    if (isCommissioner) {
      return true;
    }

    // Get the current pick
    const currentPick = await this.prisma.draftPick.findFirst({
      where: {
        leagueId: this.leagueId,
        overallPickNumber: state.currentPick,
        isComplete: false,
      },
    });

    if (!currentPick) {
      return false;
    }

    return currentPick.currentOwnerId === teamId;
  }

  async makePick(teamId: string, playerId: string): Promise<void> {
    const state = await this.getCurrentState();
    const settings = await this.prisma.draftSettings.findUnique({
      where: { leagueId: this.leagueId },
    });

    // Verify player is available
    const isAvailable = await this.isPlayerAvailable(playerId);
    if (!isAvailable) {
      throw new Error('Player is not available');
    }

    // Get the current pick
    const currentPick = await this.prisma.draftPick.findFirst({
      where: {
        leagueId: this.leagueId,
        overallPickNumber: state.currentPick,
        isComplete: false,
      },
      include: {
        currentOwner: { include: { owner: { select: { name: true } } } },
      },
    });

    if (!currentPick) {
      throw new Error('No current pick found');
    }

    // Get player details
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      throw new Error('Player not found');
    }

    // Stop the timer
    this.stopTimer();

    const now = new Date();

    // Perform the pick in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Update the pick
      await tx.draftPick.update({
        where: { id: currentPick.id },
        data: {
          selectedPlayerId: playerId,
          selectedAt: now,
          isComplete: true,
        },
      });

      // Add player to team roster
      await tx.playerRoster.create({
        data: {
          teamId,
          playerId,
          leagueId: this.leagueId,
          isKeeper: false,
          acquiredVia: 'DRAFTED',
        },
      });

      // Update draft state
      const nextPick = await this.calculateNextPick(state.currentPick, settings?.draftType || 'SNAKE');

      if (nextPick) {
        await tx.draftState.update({
          where: { leagueId: this.leagueId },
          data: {
            currentRound: nextPick.round,
            currentPick: nextPick.overall,
            currentTeamId: nextPick.teamId,
            lastPickId: currentPick.id,
            undoAvailable: true,
            timerStartedAt: now,
            timerSecondsRemaining: settings?.timerDurationSeconds || 90,
            lastActivityAt: now,
          },
        });
      } else {
        // Draft complete
        await tx.draftState.update({
          where: { leagueId: this.leagueId },
          data: {
            status: 'COMPLETED',
            completedAt: now,
            lastPickId: currentPick.id,
            lastActivityAt: now,
          },
        });
      }
    });

    this.stateCache = null;

    // Log activity
    await this.prisma.draftActivityLog.create({
      data: {
        leagueId: this.leagueId,
        activityType: 'PICK_MADE',
        description: `${currentPick.currentOwner.name} selected ${player.fullName}`,
        teamId,
        pickNumber: state.currentPick,
        playerId,
      },
    });

    // Get next pick info
    const nextPickInfo = await this.calculateNextPick(state.currentPick, settings?.draftType || 'SNAKE');
    let nextTeam: TeamSummary | undefined;

    if (nextPickInfo) {
      const team = await this.prisma.team.findUnique({
        where: { id: nextPickInfo.teamId },
        include: { owner: { select: { name: true } } },
      });

      if (team) {
        nextTeam = {
          id: team.id,
          name: team.name,
          ownerId: team.ownerId,
          ownerName: team.owner.name,
          draftPosition: team.draftPosition || 0,
        };
      }
    }

    // Get updated roster for the team that picked
    const updatedRoster = await this.getTeamRoster(teamId);

    // Broadcast pick made
    const payload: PickMadePayload = {
      leagueId: this.leagueId,
      pick: {
        id: currentPick.id,
        season: currentPick.season,
        round: currentPick.round,
        pickInRound: currentPick.pickInRound || 0,
        overallPickNumber: state.currentPick,
        currentOwnerId: currentPick.currentOwnerId,
        currentOwnerName: currentPick.currentOwner.owner.name,
        originalOwnerId: currentPick.originalOwnerId,
        isComplete: true,
        selectedPlayer: {
          id: player.id,
          sleeperId: player.sleeperId,
          fullName: player.fullName,
          position: player.position,
          nflTeam: player.nflTeam,
          rank: player.rank,
          adp: player.adp,
          bye: player.byeWeek,
        },
        selectedAt: now.toISOString(),
      },
      player: {
        id: player.id,
        sleeperId: player.sleeperId,
        fullName: player.fullName,
        position: player.position,
        nflTeam: player.nflTeam,
        rank: player.rank,
      },
      teamId,
      teamName: currentPick.currentOwner.name,
      pickNumber: state.currentPick,
      round: currentPick.round,
      nextPick: nextPickInfo && nextTeam
        ? {
          pickNumber: nextPickInfo.overall,
          round: nextPickInfo.round,
          teamId: nextPickInfo.teamId,
          team: nextTeam,
        }
        : undefined,
      teamRosterUpdates: {
        [teamId]: updatedRoster,
      },
      timestamp: now.toISOString(),
    };

    this.io.to(this.getRoomName()).emit(SocketEvents.PICK_MADE, payload);
    this.io.to(this.getRoomName()).emit(SocketEvents.PLAYER_TAKEN, {
      leagueId: this.leagueId,
      playerId,
      teamId,
    });

    // If there's a next pick, start the timer and emit on the clock
    if (nextPickInfo && nextTeam) {
      const onClockPayload: OnTheClockPayload = {
        leagueId: this.leagueId,
        teamId: nextPickInfo.teamId,
        team: nextTeam,
        pickNumber: nextPickInfo.overall,
        round: nextPickInfo.round,
        timerDuration: settings?.timerDurationSeconds || 90,
        timerStartedAt: now.toISOString(),
      };

      this.io.to(this.getRoomName()).emit(SocketEvents.ON_THE_CLOCK, onClockPayload);
      this.startTimer(settings?.timerDurationSeconds || 90);
    } else {
      // Draft complete
      this.io.to(this.getRoomName()).emit(SocketEvents.DRAFT_COMPLETE, {
        leagueId: this.leagueId,
        completedAt: now.toISOString(),
      });
    }
  }

  async forcePick(playerId: string): Promise<void> {
    const state = await this.getCurrentState();

    if (!state.currentTeamId) {
      throw new Error('No team currently on the clock');
    }

    await this.makePick(state.currentTeamId, playerId);
  }

  async undoLastPick(): Promise<void> {
    const state = await this.getCurrentState();

    const draftState = await this.prisma.draftState.findUnique({
      where: { leagueId: this.leagueId },
    });

    if (!draftState?.lastPickId || !draftState.undoAvailable) {
      throw new Error('No pick available to undo');
    }

    const lastPick = await this.prisma.draftPick.findUnique({
      where: { id: draftState.lastPickId },
      include: {
        currentOwner: { include: { owner: { select: { name: true } } } },
      },
    });

    if (!lastPick || !lastPick.selectedPlayerId) {
      throw new Error('Last pick not found or no player selected');
    }

    const player = await this.prisma.player.findUnique({
      where: { id: lastPick.selectedPlayerId },
    });

    // Stop the timer
    this.stopTimer();

    // Undo in transaction
    await this.prisma.$transaction(async (tx) => {
      // Remove player from roster
      await tx.playerRoster.deleteMany({
        where: {
          teamId: lastPick.currentOwnerId,
          playerId: lastPick.selectedPlayerId!,
          leagueId: this.leagueId,
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

      // Reset draft state
      await tx.draftState.update({
        where: { leagueId: this.leagueId },
        data: {
          status: 'IN_PROGRESS',
          currentRound: lastPick.round,
          currentPick: lastPick.overallPickNumber || state.currentPick - 1,
          currentTeamId: lastPick.currentOwnerId,
          lastPickId: null,
          undoAvailable: false,
          completedAt: null,
          lastActivityAt: new Date(),
        },
      });
    });

    this.stateCache = null;

    // Log activity
    await this.prisma.draftActivityLog.create({
      data: {
        leagueId: this.leagueId,
        activityType: 'PICK_UNDONE',
        description: `Pick undone: ${player?.fullName || 'Unknown'}`,
        teamId: lastPick.currentOwnerId,
        pickNumber: lastPick.overallPickNumber,
        playerId: lastPick.selectedPlayerId,
      },
    });

    // Get updated roster for the team that lost the player
    const updatedRoster = await this.getTeamRoster(lastPick.currentOwnerId);

    // Broadcast
    this.io.to(this.getRoomName()).emit(SocketEvents.PICK_UNDONE, {
      leagueId: this.leagueId,
      pickId: lastPick.id,
      pickNumber: lastPick.overallPickNumber || 0,
      playerId: lastPick.selectedPlayerId,
      playerName: player?.fullName || 'Unknown',
      revertedToTeamId: lastPick.currentOwnerId,
      teamRosterUpdates: {
        [lastPick.currentOwnerId]: updatedRoster,
      },
      timestamp: new Date().toISOString(),
    });

    // Put team back on the clock
    const settings = await this.prisma.draftSettings.findUnique({
      where: { leagueId: this.leagueId },
    });

    const onClockPayload: OnTheClockPayload = {
      leagueId: this.leagueId,
      teamId: lastPick.currentOwnerId,
      team: {
        id: lastPick.currentOwner.id,
        name: lastPick.currentOwner.name,
        ownerId: lastPick.currentOwner.ownerId,
        ownerName: lastPick.currentOwner.owner.name,
        draftPosition: lastPick.currentOwner.draftPosition || 0,
      },
      pickNumber: lastPick.overallPickNumber || 0,
      round: lastPick.round,
      timerDuration: settings?.timerDurationSeconds || 90,
      timerStartedAt: new Date().toISOString(),
    };

    this.io.to(this.getRoomName()).emit(SocketEvents.ON_THE_CLOCK, onClockPayload);
    this.startTimer(settings?.timerDurationSeconds || 90);
  }

  // ===========================================================================
  // DRAFT ORDER
  // ===========================================================================

  async resetDraft(): Promise<void> {
    this.stopTimer();

    await this.prisma.$transaction(async (tx) => {
      const currentYear = new Date().getFullYear();

      // 1. Delete future pick records (they become virtual/defaulted)
      await tx.draftPick.deleteMany({
        where: {
          leagueId: this.leagueId,
          season: { gt: currentYear },
        },
      });

      // 2. Reset current season picks to original owners and clear selections
      // Use raw query since Prisma updateMany can't set column = another column
      await tx.$executeRawUnsafe(
        `UPDATE "DraftPick" SET "currentOwnerId" = "originalOwnerId", "selectedPlayerId" = NULL, "selectedAt" = NULL, "isComplete" = false WHERE "leagueId" = $1 AND "season" = $2`,
        this.leagueId,
        currentYear
      );

      // 3. Delete all player rosters (except keepers)
      await tx.playerRoster.deleteMany({
        where: {
          leagueId: this.leagueId,
          isKeeper: false,
        },
      });

      // 4. Reset draft state
      await tx.draftState.update({
        where: { leagueId: this.leagueId },
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

      // 5. Cancel all pending trades
      await tx.trade.updateMany({
        where: {
          leagueId: this.leagueId,
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
          respondedAt: new Date(),
          commissionerNotes: 'Cancelled due to draft reset',
        },
      });
    });

    this.stateCache = null;

    // Log activity
    await this.prisma.draftActivityLog.create({
      data: {
        leagueId: this.leagueId,
        activityType: 'SETTINGS_CHANGED',
        description: 'Draft fully reset by commissioner',
      },
    });

    // Broadcast the full reset state
    const fullState = await this.getFullState();
    this.io.to(this.getRoomName()).emit(SocketEvents.DRAFT_RESET, fullState);
  }

  async setDraftOrder(teamOrder: string[], updatedBy: string): Promise<void> {
    const state = await this.getCurrentState();

    if (state.status === 'IN_PROGRESS' && !state.isPaused) {
      throw new Error('Cannot change order while draft is in progress. Pause the draft first.');
    }

    // Update team positions in transaction
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < teamOrder.length; i++) {
        await tx.team.update({
          where: { id: teamOrder[i] },
          data: { draftPosition: i + 1 },
        });
      }

      // Recalculate pick assignments if draft hasn't started
      if (state.status === 'NOT_STARTED') {
        await this.recalculateDraftPicks(tx, teamOrder);
      }
    });

    // Log activity
    await this.prisma.draftActivityLog.create({
      data: {
        leagueId: this.leagueId,
        activityType: 'ORDER_UPDATED',
        description: 'Draft order updated by commissioner',
        triggeredById: updatedBy,
        metadata: { newOrder: teamOrder },
      },
    });

    // Get updated teams
    const teams = await this.getTeamsWithOrder();

    // Broadcast
    const payload: OrderUpdatedPayload = {
      leagueId: this.leagueId,
      newOrder: teams,
      updatedBy,
      reason: 'commissioner_set',
      timestamp: new Date().toISOString(),
    };

    this.io.to(this.getRoomName()).emit(SocketEvents.ORDER_UPDATED, payload);
  }

  private async recalculateDraftPicks(tx: any, teamOrder: string[]): Promise<void> {
    const settings = await this.prisma.draftSettings.findUnique({
      where: { leagueId: this.leagueId },
    });

    if (!settings) return;

    const totalTeams = teamOrder.length;
    const totalRounds = settings.totalRounds;

    // Delete existing picks
    await tx.draftPick.deleteMany({
      where: { leagueId: this.leagueId },
    });

    // Create new picks based on draft type
    const picks: any[] = [];
    let overallPick = 1;

    for (let round = 1; round <= totalRounds; round++) {
      const isReversed = settings.draftType === 'SNAKE' && round % 2 === 0;
      const orderForRound = isReversed ? [...teamOrder].reverse() : teamOrder;

      for (let pickInRound = 1; pickInRound <= totalTeams; pickInRound++) {
        const teamId = orderForRound[pickInRound - 1];
        picks.push({
          leagueId: this.leagueId,
          season: new Date().getFullYear(),
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
  }

  // ===========================================================================
  // TIMER MANAGEMENT
  // ===========================================================================

  private startTimer(durationSeconds: number): void {
    this.stopTimer();

    let remaining = durationSeconds;

    this.timerInterval = setInterval(async () => {
      remaining--;

      // Broadcast tick
      const state = await this.getCurrentState();
      this.io.to(this.getRoomName()).emit(SocketEvents.TIMER_TICK, {
        leagueId: this.leagueId,
        secondsRemaining: remaining,
        currentPick: state.currentPick,
        currentTeamId: state.currentTeamId || '',
      });

      // Update state periodically
      if (remaining % 10 === 0) {
        await this.prisma.draftState.update({
          where: { leagueId: this.leagueId },
          data: { timerSecondsRemaining: remaining },
        });
      }

      if (remaining <= 0) {
        this.stopTimer();
        await this.handleTimerExpired();
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private async handleTimerExpired(): Promise<void> {
    const state = await this.getCurrentState();

    if (!state.currentTeamId) return;

    // Log activity
    await this.prisma.draftActivityLog.create({
      data: {
        leagueId: this.leagueId,
        activityType: 'TIMER_EXPIRED',
        description: 'Pick timer expired',
        teamId: state.currentTeamId,
        pickNumber: state.currentPick,
      },
    });

    // Broadcast timer expired
    this.io.to(this.getRoomName()).emit(SocketEvents.TIMER_EXPIRED, {
      leagueId: this.leagueId,
      teamId: state.currentTeamId,
      pickNumber: state.currentPick,
    });

    // Auto-pick best available player
    const availablePlayers = await this.getAvailablePlayers();
    const bestPlayer = availablePlayers[0];
    if (bestPlayer) {
      await this.makePick(state.currentTeamId, bestPlayer.id);
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private async isPlayerAvailable(playerId: string): Promise<boolean> {
    // Check if already drafted
    const drafted = await this.prisma.draftPick.findFirst({
      where: {
        leagueId: this.leagueId,
        selectedPlayerId: playerId,
        isComplete: true,
      },
    });

    if (drafted) return false;

    // Check if kept
    const kept = await this.prisma.playerRoster.findFirst({
      where: {
        leagueId: this.leagueId,
        playerId,
        isKeeper: true,
      },
    });

    return !kept;
  }

  private async calculateNextPick(
    currentOverall: number,
    draftType: DraftType
  ): Promise<{ round: number; overall: number; teamId: string } | null> {
    const settings = await this.prisma.draftSettings.findUnique({
      where: { leagueId: this.leagueId },
    });

    if (!settings) return null;

    const teams = await this.prisma.team.findMany({
      where: { leagueId: this.leagueId },
      orderBy: { draftPosition: 'asc' },
    });

    const totalTeams = teams.length;
    const totalPicks = totalTeams * settings.totalRounds;

    const nextOverall = currentOverall + 1;
    if (nextOverall > totalPicks) {
      return null; // Draft complete
    }

    // Find the next uncompleted pick
    const nextPick = await this.prisma.draftPick.findFirst({
      where: {
        leagueId: this.leagueId,
        overallPickNumber: nextOverall,
        isComplete: false,
      },
    });

    if (!nextPick) return null;

    return {
      round: nextPick.round,
      overall: nextOverall,
      teamId: nextPick.currentOwnerId,
    };
  }
}
