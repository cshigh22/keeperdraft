// Draft State Manager
// Manages the real-time state machine for the draft

import type {
  DraftSettings,
  DraftStatus,
  Player,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { toPlayerSummary, toTeamSummary, toTradeAssetPayload } from './mappers';
import { buildTradeMap, generatePickSlots } from './draft-pick-generator';
import { getRestrictedPositions, normalizePosition } from '@/lib/roster-restrictions';
import { ROSTERED_PLAYER_WHERE, isRosteredEntry } from '@/lib/roster-membership';
import { NFL_RELEVANT_PLAYER_WHERE } from '@/lib/player-pool';
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
  RosterSettings,
  PickMadePayload,
  PickEditedPayload,
  OnTheClockPayload,
  DraftStartPayload,
  DraftPausePayload,
  OrderUpdatedPayload,
  TradeOfferedPayload,
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

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_TIMER_SECONDS = 90;
const DEFAULT_TOTAL_ROUNDS = 14;

const DEFAULT_DRAFT_STATE: DraftStateCache = {
  status: 'NOT_STARTED',
  currentRound: 1,
  currentPick: 1,
  currentTeamId: null,
  isPaused: false,
  pauseReason: null,
  timerSecondsRemaining: null,
  timerStartedAt: null,
};

// =============================================================================
// ROW SHAPES & PURE MAPPERS
// (shared team/player/trade-asset mappers live in ./mappers)
// =============================================================================

interface RosterEntryWithPlayer {
  isKeeper: boolean;
  keeperRound: number | null;
  player: Player;
}

function toRosterPlayer(entry: RosterEntryWithPlayer): RosterPlayer {
  return {
    ...toPlayerSummary(entry.player),
    injuryStatus: entry.player.injuryStatus,
    isKeeper: entry.isKeeper,
    round: entry.keeperRound ?? undefined,
  };
}

function toRosterSettings(settings: DraftSettings): RosterSettings {
  return {
    qbCount: settings.qbCount,
    rbCount: settings.rbCount,
    wrCount: settings.wrCount,
    teCount: settings.teCount,
    flexCount: settings.flexCount,
    superflexCount: settings.superflexCount,
    kCount: settings.kCount,
    defCount: settings.defCount,
    benchCount: settings.benchCount,
  };
}

function timerDurationOf(settings: Pick<DraftSettings, 'timerDurationSeconds'> | null): number {
  return settings?.timerDurationSeconds || DEFAULT_TIMER_SECONDS;
}

export class DraftStateManager {
  private timerInterval: NodeJS.Timeout | null = null;
  private stateCache: DraftStateCache | null = null;

  constructor(
    private readonly leagueId: string,
    private readonly prisma: PrismaClient,
    private readonly io: TypedServer
  ) {}

  private get room() {
    return this.io.to(`draft:${this.leagueId}`);
  }

  // ===========================================================================
  // STATE RETRIEVAL
  // ===========================================================================

  async getCurrentState(): Promise<DraftStateCache> {
    // Only trust the cache mid-draft. Outside IN_PROGRESS the state can be
    // changed by the Next.js process (e.g. season rollover resets it) with no
    // way to invalidate this long-lived manager instance.
    if (this.stateCache?.status === 'IN_PROGRESS') {
      return this.stateCache;
    }

    const state = await this.prisma.draftState.findUnique({
      where: { leagueId: this.leagueId },
    });

    if (!state) {
      return { ...DEFAULT_DRAFT_STATE };
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

  // Realigns currentTeamId with the actual owner of the current pick (e.g. after
  // a trade moves the pick on the clock) and restarts the timer if needed.
  async syncCurrentTeam(): Promise<string | null> {
    const state = await this.getCurrentState();

    if (state.status !== 'IN_PROGRESS' && state.status !== 'PAUSED') {
      return state.currentTeamId;
    }

    const [currentPick, settings] = await Promise.all([
      this.prisma.draftPick.findFirst({
        where: {
          leagueId: this.leagueId,
          season: await this.getLeagueSeason(),
          overallPickNumber: state.currentPick,
        },
      }),
      this.prisma.draftSettings.findUnique({
        where: { leagueId: this.leagueId },
      }),
    ]);

    if (!currentPick || currentPick.currentOwnerId === state.currentTeamId) {
      return state.currentTeamId;
    }

    console.log(
      `[DraftStateManager] Syncing current team: ${state.currentTeamId} -> ${currentPick.currentOwnerId}`
    );

    const timerDuration = timerDurationOf(settings);
    const now = new Date();

    await this.prisma.draftState.update({
      where: { leagueId: this.leagueId },
      data: {
        currentTeamId: currentPick.currentOwnerId,
        timerSecondsRemaining: timerDuration,
        timerStartedAt: state.status === 'IN_PROGRESS' && !state.isPaused ? now : null,
      },
    });

    this.clearStateCache();
    const newState = await this.getCurrentState();

    // Broadcast update to all clients
    const teams = await this.getTeamsWithOrder();
    const team = teams.find((t) => t.id === currentPick.currentOwnerId);

    if (team) {
      const payload: OnTheClockPayload = {
        leagueId: this.leagueId,
        teamId: team.id,
        team,
        pickNumber: newState.currentPick,
        round: newState.currentRound,
        timerDuration,
        timerStartedAt: newState.timerStartedAt?.toISOString() || now.toISOString(),
      };

      this.room.emit(SocketEvents.ON_THE_CLOCK, payload);
    }

    // If draft is in progress (and not paused, e.g. by the commissioner),
    // restart the timer with full duration for the pick's new owner
    if (state.status === 'IN_PROGRESS' && !state.isPaused) {
      this.startTimer(timerDuration);
    }

    return currentPick.currentOwnerId;
  }

  async getFullState(): Promise<StateSyncPayload> {
    const [state, settings, teams, allPicks, players, pendingTrades, teamRosters, teamQueues, season] =
      await Promise.all([
        this.getCurrentState(),
        this.prisma.draftSettings.findUnique({ where: { leagueId: this.leagueId } }),
        this.getTeamsWithOrder(),
        this.getAllPicks(),
        this.getAvailablePlayers(),
        this.getPendingTrades(),
        this.getTeamRosters(),
        this.getTeamQueues(),
        this.getLeagueSeason(),
      ]);

    const currentTeam = state.currentTeamId
      ? teams.find((t) => t.id === state.currentTeamId) || null
      : null;

    return {
      leagueId: this.leagueId,
      season,
      status: state.status,
      currentRound: state.currentRound,
      currentPick: state.currentPick,
      currentTeamId: state.currentTeamId,
      currentTeam,
      isPaused: state.isPaused,
      pauseReason: state.pauseReason,
      timerSecondsRemaining: state.timerSecondsRemaining,
      draftOrder: teams,
      completedPicks: allPicks.filter((p) => p.isComplete),
      allPicks,
      availablePlayers: players,
      teamRosters,
      pendingTrades,
      totalRounds: settings?.totalRounds || DEFAULT_TOTAL_ROUNDS,
      draftType: (settings?.draftType as 'SNAKE' | 'LINEAR' | undefined) || 'SNAKE',
      teamQueues,
      rosterSettings: settings ? toRosterSettings(settings) : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private async getTeamsWithOrder(): Promise<TeamSummary[]> {
    const teams = await this.prisma.team.findMany({
      where: { leagueId: this.leagueId },
      include: { owner: { select: { name: true } } },
      orderBy: { draftPosition: 'asc' },
    });

    return teams.map(toTeamSummary);
  }

  async getTeamRoster(teamId: string): Promise<RosterPlayer[]> {
    const rosters = await this.prisma.playerRoster.findMany({
      where: { leagueId: this.leagueId, teamId, ...ROSTERED_PLAYER_WHERE },
      include: { player: true },
    });

    return rosters.map(toRosterPlayer);
  }

  private async getAllPicks(): Promise<DraftPickSummary[]> {
    // Current season plus future seasons: the board renders only the current
    // board, but the trade modal needs trade-materialized future picks as real
    // rows so acquired ownership ("Acquired via ...") is shown and offerable.
    // Past seasons are history and stay excluded. Mirrors the dashboard's
    // pickSummaries query (season: { gte: league.season }).
    const picks = await this.prisma.draftPick.findMany({
      where: { leagueId: this.leagueId, season: { gte: await this.getLeagueSeason() } },
      include: {
        currentOwner: { include: { owner: { select: { name: true } } } },
        originalOwner: true,
      },
      orderBy: { overallPickNumber: 'asc' },
    });

    // DraftPick has no relation to Player for selectedPlayerId, so resolve
    // selected players with a second query.
    const selectedPlayerIds = picks
      .map((pick) => pick.selectedPlayerId)
      .filter((id): id is string => id !== null);

    const players = selectedPlayerIds.length
      ? await this.prisma.player.findMany({ where: { id: { in: selectedPlayerIds } } })
      : [];

    const playerById = new Map(players.map((p) => [p.id, p]));

    return picks.map((pick) => {
      const player = pick.selectedPlayerId ? playerById.get(pick.selectedPlayerId) : undefined;
      return {
        id: pick.id,
        season: pick.season,
        round: pick.round,
        pickInRound: pick.pickInRound || 0,
        overallPickNumber: pick.overallPickNumber || 0,
        currentOwnerId: pick.currentOwnerId,
        currentOwnerName: pick.currentOwner.owner?.name || 'Open Slot',
        originalOwnerId: pick.originalOwnerId,
        isComplete: pick.isComplete,
        isKeeper: pick.isKeeper,
        selectedPlayer: player ? toPlayerSummary(player) : undefined,
        selectedAt: pick.selectedAt?.toISOString(),
      };
    });
  }

  private async getTeamRosters(): Promise<Record<string, RosterPlayer[]>> {
    const rosters = await this.prisma.playerRoster.findMany({
      where: { leagueId: this.leagueId, ...ROSTERED_PLAYER_WHERE },
      include: { player: true },
    });

    const rostersByTeam: Record<string, RosterPlayer[]> = {};
    for (const entry of rosters) {
      (rostersByTeam[entry.teamId] ??= []).push(toRosterPlayer(entry));
    }
    return rostersByTeam;
  }

  private async getAvailablePlayers(): Promise<PlayerSummary[]> {
    // Get IDs of players to exclude (drafted OR on any roster)
    const [draftedPicks, allRosteredPlayers] = await Promise.all([
      this.prisma.draftPick.findMany({
        where: {
          leagueId: this.leagueId,
          season: await this.getLeagueSeason(),
          isComplete: true,
          selectedPlayerId: { not: null },
        },
        select: { selectedPlayerId: true },
      }),
      this.prisma.playerRoster.findMany({
        where: { leagueId: this.leagueId },
        select: {
          playerId: true,
          isKeeper: true,
          acquiredVia: true,
          team: { select: { name: true } },
        },
      }),
    ]);

    const excludeIds = new Set<string>();

    for (const pick of draftedPicks) {
      if (pick.selectedPlayerId) excludeIds.add(pick.selectedPlayerId);
    }

    // Exclude only keepers and draft-acquired players — not pre-draft marketplace entries (FREE_AGENT)
    const keeperTeamByPlayerId = new Map<string, string>();
    for (const entry of allRosteredPlayers) {
      if (isRosteredEntry(entry)) {
        excludeIds.add(entry.playerId);
      }
      if (entry.isKeeper) {
        keeperTeamByPlayerId.set(entry.playerId, entry.team.name);
      }
    }

    // Only current-NFL players belong in the pool: without this filter,
    // ~2k retired and team-less rows crowd active players out of the capped
    // window. The admission rule (and its Sleeper-quirk rationale) lives in
    // NFL_RELEVANT_PLAYER_WHERE, shared with the free agency list. The cap
    // stays as a safety valve.
    const players = await this.prisma.player.findMany({
      where: {
        id: { notIn: Array.from(excludeIds) },
        ...NFL_RELEVANT_PLAYER_WHERE,
      },
      orderBy: [{ rank: { sort: 'asc', nulls: 'last' } }, { fullName: 'asc' }],
      take: 2000,
    });

    return players.map((player) => ({
      ...toPlayerSummary(player),
      keptByTeam: keeperTeamByPlayerId.get(player.id) ?? null,
    }));
  }

  private async getPendingTrades(): Promise<TradeOfferedPayload[]> {
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
      initiatorTeam: toTeamSummary(trade.initiatorTeam),
      receiverTeam: toTeamSummary(trade.receiverTeam),
      initiatorAssets: trade.assets
        .filter((asset) => asset.fromTeamId === trade.initiatorTeamId)
        .map((asset) => toTradeAssetPayload(asset, trade.initiatorTeam.name)),
      receiverAssets: trade.assets
        .filter((asset) => asset.fromTeamId === trade.receiverTeamId)
        .map((asset) => toTradeAssetPayload(asset, trade.receiverTeam.name)),
      expiresAt: trade.expiresAt?.toISOString(),
      timestamp: trade.proposedAt.toISOString(),
    }));
  }

  private async getTeamQueues(): Promise<Record<string, PlayerSummary[]>> {
    const allQueues = await this.prisma.draftQueue.findMany({
      where: { team: { leagueId: this.leagueId } },
      include: { player: true },
      orderBy: { rank: 'asc' },
    });

    const queuesByTeam: Record<string, PlayerSummary[]> = {};
    for (const item of allQueues) {
      (queuesByTeam[item.teamId] ??= []).push({
        ...toPlayerSummary(item.player),
        keptByTeam: null,
      });
    }
    return queuesByTeam;
  }

  async updateQueue(teamId: string, playerIds: string[]): Promise<void> {
    // Deduplicate on the way in
    const uniquePlayerIds = Array.from(new Set(playerIds));

    // Use upsert loop instead of delete+create to be immune to race conditions.
    // Two concurrent calls can safely upsert over each other without constraint errors.
    await this.prisma.$transaction(async (tx) => {
      // Upsert each player entry (update rank if exists, create if not)
      for (const [rank, playerId] of uniquePlayerIds.entries()) {
        await tx.draftQueue.upsert({
          where: {
            teamId_playerId: { teamId, playerId },
          },
          update: { rank },
          create: { teamId, playerId, rank },
        });
      }

      // Remove any entries NOT in the updated list
      await tx.draftQueue.deleteMany({
        where:
          uniquePlayerIds.length > 0
            ? { teamId, playerId: { notIn: uniquePlayerIds } }
            : { teamId },
      });
    });

    const updatedQueue = await this.prisma.draftQueue.findMany({
      where: { teamId },
      include: { player: true },
      orderBy: { rank: 'asc' },
    });

    this.room.emit(SocketEvents.QUEUE_UPDATED, {
      leagueId: this.leagueId,
      teamId,
      queue: updatedQueue.map((item) => ({
        ...toPlayerSummary(item.player),
        keptByTeam: null,
      })),
    });
  }

  // ===========================================================================
  // DRAFT LIFECYCLE
  // ===========================================================================

  async startDraft(): Promise<void> {
    console.log(`[DraftStateManager] Starting draft for league ${this.leagueId}...`);

    const state = await this.getCurrentState();
    if (state.status !== 'NOT_STARTED') {
      console.warn(`[DraftStateManager] Cannot start draft - current status is ${state.status}`);
      throw new Error(`Draft cannot be started because it is currently ${state.status}`);
    }

    const settings = await this.prisma.draftSettings.findUnique({
      where: { leagueId: this.leagueId },
    });

    if (!settings) {
      throw new Error('Draft settings not configured');
    }

    // Clear cache immediately to prevent stale reads
    this.clearStateCache();

    try {
      const teams = await this.getTeamsWithOrder();
      if (teams.length === 0) {
        throw new Error('No teams in league');
      }

      // Purge non-keeper roster rows before the board opens. After a season
      // rollover, teams that never re-submitted keepers still carry last
      // season's roster, which would wrongly block those players from the
      // pool. Keepers and pre-draft marketplace signals (FREE_AGENT) survive.
      await this.prisma.playerRoster.deleteMany({
        where: {
          leagueId: this.leagueId,
          isKeeper: false,
          acquiredVia: { not: 'FREE_AGENT' },
        },
      });

      // Keeper counts can drift past maxKeepers through paths that don't
      // revalidate (lowering the limit after selections, trading keeper-flagged
      // players), which corrupts every team's pick math once the board is
      // generated. Refuse to start until the commissioner resolves it.
      const keeperCounts = await this.prisma.playerRoster.groupBy({
        by: ['teamId'],
        where: { leagueId: this.leagueId, isKeeper: true },
        _count: { _all: true },
      });

      const overLimit = keeperCounts.filter((k) => k._count._all > settings.maxKeepers);
      if (overLimit.length > 0) {
        const details = overLimit
          .map((k) => {
            const teamName = teams.find((t) => t.id === k.teamId)?.name || 'Unknown team';
            const count = k._count._all;
            return `${teamName} has ${count} keeper${count === 1 ? '' : 's'}`;
          })
          .join(', ');
        throw new Error(`Cannot start draft: ${details}; league max is ${settings.maxKeepers}`);
      }

      const allKeepersCount = keeperCounts.reduce((sum, k) => sum + k._count._all, 0);
      console.log(
        `[startDraft] Found ${allKeepersCount} keepers on rosters. Starting draft for remaining spots.`
      );

      // Find the first available pick after keepers are accounted for
      const firstPick = await this.prisma.draftPick.findFirst({
        where: {
          leagueId: this.leagueId,
          season: await this.getLeagueSeason(),
          isComplete: false,
        },
        orderBy: { overallPickNumber: 'asc' },
      });

      if (!firstPick) {
        // If all picks are filled by keepers, the draft is immediately complete
        console.log(`[startDraft] All picks filled by keepers. Draft completing immediately.`);
        await this.prisma.draftState.upsert({
          where: { leagueId: this.leagueId },
          create: { leagueId: this.leagueId, status: 'COMPLETED' },
          update: { status: 'COMPLETED' },
        });
        this.clearStateCache();
        this.room.emit(SocketEvents.DRAFT_COMPLETE, {
          leagueId: this.leagueId,
          completedAt: new Date().toISOString(),
        });
        return;
      }

      const firstTeamOnClock = teams.find((t) => t.id === firstPick.currentOwnerId) || teams[0];
      if (!firstTeamOnClock) {
        throw new Error('Could not determine first team on clock');
      }
      const now = new Date();

      const inProgressState = {
        status: 'IN_PROGRESS' as const,
        currentRound: firstPick.round || 1,
        currentPick: firstPick.overallPickNumber || 1,
        currentTeamId: firstTeamOnClock.id,
        isPaused: false,
        timerStartedAt: now,
        timerSecondsRemaining: settings.timerDurationSeconds,
        startedAt: now,
        lastActivityAt: now,
      };

      await this.prisma.draftState.upsert({
        where: { leagueId: this.leagueId },
        create: { leagueId: this.leagueId, ...inProgressState },
        update: inProgressState,
      });

      this.clearStateCache();

      await this.logActivity('DRAFT_STARTED', 'Draft started');

      const payload: DraftStartPayload = {
        leagueId: this.leagueId,
        startedAt: now.toISOString(),
        currentPick: firstPick.overallPickNumber || 1,
        currentTeamId: firstTeamOnClock.id,
        currentTeam: firstTeamOnClock,
        timerDuration: settings.timerDurationSeconds,
        draftOrder: teams,
      };

      this.room.emit(SocketEvents.DRAFT_START, payload);
      this.startTimer(timerDurationOf(settings));

      // Also broadcast full state to ensure everyone has up-to-date picks/keepers/players
      const fullState = await this.getFullState();
      this.room.emit(SocketEvents.STATE_SYNC, fullState);

      console.log(`[DraftStateManager] Draft successfully started for league ${this.leagueId}.`);
    } catch (error) {
      console.error(`[DraftStateManager] FAILED to start draft:`, error);
      throw error;
    }
  }

  async pauseDraft(reason: string, pausedBy: string): Promise<void> {
    const state = await this.getCurrentState();

    // Freeze the clock: subtract time elapsed since the timer last started
    let remainingTime = state.timerSecondsRemaining || 0;
    if (state.timerStartedAt && !state.isPaused) {
      const elapsed = Math.floor((Date.now() - state.timerStartedAt.getTime()) / 1000);
      remainingTime = Math.max(0, (state.timerSecondsRemaining || 0) - elapsed);
    }

    this.stopTimer();

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

    this.clearStateCache();

    await this.logActivity('DRAFT_PAUSED', `Draft paused: ${reason}`, {
      triggeredById: pausedBy === 'system' ? null : pausedBy,
    });

    const payload: DraftPausePayload = {
      leagueId: this.leagueId,
      isPaused: true,
      reason,
      pausedBy,
      timerSecondsRemaining: remainingTime,
      timestamp: new Date().toISOString(),
    };

    this.room.emit(SocketEvents.DRAFT_PAUSE, payload);
  }

  async resumeDraft(): Promise<void> {
    const state = await this.getCurrentState();
    const settings = await this.prisma.draftSettings.findUnique({
      where: { leagueId: this.leagueId },
    });

    const remainingTime = state.timerSecondsRemaining || timerDurationOf(settings);

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

    this.clearStateCache();

    await this.logActivity('DRAFT_RESUMED', 'Draft resumed');

    const payload: DraftPausePayload = {
      leagueId: this.leagueId,
      isPaused: false,
      timerSecondsRemaining: remainingTime,
      timestamp: new Date().toISOString(),
    };

    this.room.emit(SocketEvents.DRAFT_RESUME, payload);

    this.startTimer(remainingTime);
  }

  // ===========================================================================
  // PICK MANAGEMENT
  // ===========================================================================

  // NOTE: currently unused — makePick inlines its own authorization checks.
  // Kept for API completeness; candidate for removal.
  async canTeamPick(teamId: string, isCommissioner: boolean): Promise<boolean> {
    const state = await this.getCurrentState();

    if (state.status !== 'IN_PROGRESS' || state.isPaused) {
      return false;
    }

    // Commissioner can always make picks (for force pick)
    if (isCommissioner) {
      return true;
    }

    const currentPick = await this.prisma.draftPick.findFirst({
      where: {
        leagueId: this.leagueId,
        season: await this.getLeagueSeason(),
        overallPickNumber: state.currentPick,
        isComplete: false,
      },
    });

    return currentPick?.currentOwnerId === teamId;
  }

  async makePick(teamId: string, playerId: string, isCommissioner: boolean = false): Promise<void> {
    // --- Phase 1: Parallel pre-validation ---
    const [state, settings] = await Promise.all([
      this.getCurrentState(),
      this.prisma.draftSettings.findUnique({ where: { leagueId: this.leagueId } }),
    ]);

    if (state.status !== 'IN_PROGRESS') {
      throw new Error('Draft is not in progress');
    }
    if (state.isPaused) {
      throw new Error('Draft is paused');
    }

    // Run independent validations in parallel
    const [isAvailable, currentPick, player, restrictedPositions] = await Promise.all([
      this.isPlayerAvailable(playerId),
      this.prisma.draftPick.findFirst({
        where: {
          leagueId: this.leagueId,
          season: await this.getLeagueSeason(),
          overallPickNumber: state.currentPick,
          isComplete: false,
        },
        include: {
          currentOwner: { include: { owner: { select: { name: true } } } },
        },
      }),
      this.prisma.player.findUnique({ where: { id: playerId } }),
      this.getRestrictedPositionsForTeam(teamId),
    ]);

    if (!isAvailable) {
      throw new Error('Player is not available');
    }
    if (!currentPick) {
      throw new Error('No current pick found');
    }
    // Verify this team owns the pick (or commissioner override)
    if (!isCommissioner && currentPick.currentOwnerId !== teamId) {
      throw new Error('It is not your turn to pick');
    }
    if (!player) {
      throw new Error('Player not found');
    }
    if (restrictedPositions.includes(normalizePosition(player.position))) {
      throw new Error(`Positional limit reached for ${player.position}`);
    }

    this.stopTimer();

    const now = new Date();

    // --- Phase 2: Transaction (write phase) ---
    // Calculate next pick BEFORE the transaction (read-only query, safe to do outside)
    const nextPickResult = await this.calculateNextPick(state.currentPick);

    await this.prisma.$transaction(async (tx) => {
      await tx.draftPick.update({
        where: { id: currentPick.id },
        data: {
          selectedPlayerId: playerId,
          selectedAt: now,
          isComplete: true,
          isKeeper: false,
        },
      });

      // Add player to team roster (upsert in case a marketplace FREE_AGENT entry exists)
      await tx.playerRoster.upsert({
        where: {
          leagueId_playerId: { leagueId: this.leagueId, playerId },
        },
        create: {
          teamId,
          playerId,
          leagueId: this.leagueId,
          isKeeper: false,
          acquiredVia: 'DRAFTED',
        },
        update: {
          teamId,
          isKeeper: false,
          acquiredVia: 'DRAFTED',
        },
      });

      if (nextPickResult) {
        await tx.draftState.update({
          where: { leagueId: this.leagueId },
          data: {
            currentRound: nextPickResult.round,
            currentPick: nextPickResult.overall,
            currentTeamId: nextPickResult.teamId,
            lastPickId: currentPick.id,
            undoAvailable: true,
            timerStartedAt: now,
            timerSecondsRemaining: timerDurationOf(settings),
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

    // --- Phase 3: Build payload and emit ASAP ---
    const [updatedRoster, nextTeamRecord] = await Promise.all([
      this.getTeamRoster(teamId),
      nextPickResult
        ? this.prisma.team.findUnique({
            where: { id: nextPickResult.teamId },
            include: { owner: { select: { name: true } } },
          })
        : Promise.resolve(null),
    ]);

    const nextTeam = nextTeamRecord ? toTeamSummary(nextTeamRecord) : undefined;

    const payload: PickMadePayload = {
      leagueId: this.leagueId,
      pick: {
        id: currentPick.id,
        season: currentPick.season,
        round: currentPick.round,
        pickInRound: currentPick.pickInRound || 0,
        overallPickNumber: state.currentPick,
        currentOwnerId: currentPick.currentOwnerId,
        currentOwnerName: currentPick.currentOwner.owner?.name || 'Open Slot',
        originalOwnerId: currentPick.originalOwnerId,
        isComplete: true,
        isKeeper: false,
        selectedPlayer: toPlayerSummary(player),
        selectedAt: now.toISOString(),
      },
      player: toPlayerSummary(player),
      teamId,
      teamName: currentPick.currentOwner.name,
      pickNumber: state.currentPick,
      round: currentPick.round,
      nextPick:
        nextPickResult && nextTeam
          ? {
              pickNumber: nextPickResult.overall,
              round: nextPickResult.round,
              teamId: nextPickResult.teamId,
              team: nextTeam,
            }
          : undefined,
      teamRosterUpdates: {
        [teamId]: updatedRoster,
      },
      timestamp: now.toISOString(),
    };

    this.room.emit(SocketEvents.PICK_MADE, payload);
    this.room.emit(SocketEvents.PLAYER_TAKEN, {
      leagueId: this.leagueId,
      playerId,
      teamId,
    });

    if (nextPickResult && nextTeam) {
      const onClockPayload: OnTheClockPayload = {
        leagueId: this.leagueId,
        teamId: nextPickResult.teamId,
        team: nextTeam,
        pickNumber: nextPickResult.overall,
        round: nextPickResult.round,
        timerDuration: timerDurationOf(settings),
        timerStartedAt: now.toISOString(),
      };
      this.room.emit(SocketEvents.ON_THE_CLOCK, onClockPayload);
      this.startTimer(timerDurationOf(settings));
    } else {
      this.room.emit(SocketEvents.DRAFT_COMPLETE, {
        leagueId: this.leagueId,
        completedAt: now.toISOString(),
      });
    }

    // --- Phase 4: Deferred non-critical work (don't block the response) ---
    // These run after the socket emit so the client gets a fast response
    Promise.all([
      this.logActivity(
        'PICK_MADE',
        `${currentPick.currentOwner.name} selected ${player.fullName}`,
        { teamId, pickNumber: state.currentPick, playerId }
      ),
      this.prisma.draftQueue.deleteMany({ where: { playerId } }),
    ]).catch((err) => {
      console.error('[makePick] Deferred work failed:', err);
    });
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

    this.stopTimer();

    await this.prisma.$transaction(async (tx) => {
      // Remove drafted player from roster (only DRAFTED entries, not marketplace FREE_AGENT ones)
      await tx.playerRoster.deleteMany({
        where: {
          teamId: lastPick.currentOwnerId,
          playerId: lastPick.selectedPlayerId!,
          leagueId: this.leagueId,
          acquiredVia: 'DRAFTED',
        },
      });

      await tx.draftPick.update({
        where: { id: lastPick.id },
        data: {
          selectedPlayerId: null,
          selectedAt: null,
          isComplete: false,
        },
      });

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

    await this.logActivity('PICK_UNDONE', `Pick undone: ${player?.fullName || 'Unknown'}`, {
      teamId: lastPick.currentOwnerId,
      pickNumber: lastPick.overallPickNumber,
      playerId: lastPick.selectedPlayerId,
    });

    // Get updated roster for the team that lost the player
    const updatedRoster = await this.getTeamRoster(lastPick.currentOwnerId);

    this.room.emit(SocketEvents.PICK_UNDONE, {
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
    const timerDuration = timerDurationOf(settings);

    const onClockPayload: OnTheClockPayload = {
      leagueId: this.leagueId,
      teamId: lastPick.currentOwnerId,
      team: toTeamSummary(lastPick.currentOwner),
      pickNumber: lastPick.overallPickNumber || 0,
      round: lastPick.round,
      timerDuration,
      timerStartedAt: new Date().toISOString(),
    };

    this.room.emit(SocketEvents.ON_THE_CLOCK, onClockPayload);
    this.startTimer(timerDuration);
  }

  // Commissioner corrective tool: put any player on a non-keeper pick after
  // the draft has ended — no swap-in eligibility constraint. A player who is
  // already rostered is moved onto this pick (their old roster row and any
  // board slot showing them are updated), and a slot emptied that way can be
  // filled the same way. Keeper slots stay locked. DraftState is deliberately
  // never written, so completion status, undo bookkeeping, and reset behavior
  // are unaffected. Positional limits are not enforced — like commissioner
  // trades, this is a repair escape hatch.
  async editCompletedPick(
    pickId: string,
    newPlayerId: string,
    editedByUserId: string
  ): Promise<void> {
    const state = await this.getCurrentState();
    if (state.status !== 'COMPLETED') {
      throw new Error('Picks can only be edited after the draft is complete');
    }

    const season = await this.getLeagueSeason();
    const [pick, newPlayer] = await Promise.all([
      this.prisma.draftPick.findFirst({
        where: { id: pickId, leagueId: this.leagueId, season },
        include: {
          currentOwner: { include: { owner: { select: { name: true } } } },
        },
      }),
      this.prisma.player.findUnique({ where: { id: newPlayerId } }),
    ]);

    if (!pick) {
      throw new Error('Pick not found in this draft');
    }
    if (pick.isKeeper) {
      throw new Error('Keeper picks cannot be edited');
    }
    if (!newPlayer) {
      throw new Error('Player not found');
    }
    if (pick.selectedPlayerId === newPlayerId) {
      throw new Error(`${newPlayer.fullName} is already on this pick`);
    }

    const oldPlayerId = pick.selectedPlayerId;
    const oldPlayer = oldPlayerId
      ? await this.prisma.player.findUnique({ where: { id: oldPlayerId } })
      : null;

    type PickWithOwner = Prisma.DraftPickGetPayload<{
      include: { currentOwner: { include: { owner: { select: { name: true } } } } };
    }>;
    let released = false;
    let vacatedPickRow: PickWithOwner | null = null;
    let incomingFromTeamId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      // Outgoing player: release only the original DRAFTED row on the pick's
      // own team (mirrors undoLastPick's delete scoping). A row acquired any
      // other way — traded back, dropped and re-signed as a PICKUP — is a
      // separate acquisition this edit leaves alone.
      if (oldPlayerId) {
        const outgoing = await tx.playerRoster.findFirst({
          where: {
            leagueId: this.leagueId,
            playerId: oldPlayerId,
            teamId: pick.currentOwnerId,
            acquiredVia: 'DRAFTED',
          },
        });
        if (outgoing) {
          await tx.playerRoster.delete({ where: { id: outgoing.id } });
          await tx.tradeBlockEntry.deleteMany({
            where: { leagueId: this.leagueId, playerId: oldPlayerId },
          });
          released = true;
        }
      }

      // If the incoming player already occupies another board slot, vacate it
      // so no player shows on two picks — except keeper slots, which are
      // never touched.
      const otherPick = await tx.draftPick.findFirst({
        where: {
          leagueId: this.leagueId,
          season,
          selectedPlayerId: newPlayerId,
          isComplete: true,
          id: { not: pick.id },
        },
        include: {
          currentOwner: { include: { owner: { select: { name: true } } } },
        },
      });
      if (otherPick?.isKeeper) {
        throw new Error(`${newPlayer.fullName} occupies a keeper slot, which cannot be changed`);
      }
      if (otherPick) {
        await tx.draftPick.update({
          where: { id: otherPick.id },
          data: {
            selectedPlayerId: null,
            selectedAt: null,
            isComplete: false,
            isAutoPick: false,
            autoPickPlayerId: null,
          },
        });
        vacatedPickRow = otherPick;
      }

      // selectedAt is preserved on an existing selection (an administrative
      // correction, not a new pick); a previously empty slot is stamped now.
      await tx.draftPick.update({
        where: { id: pick.id },
        data: {
          selectedPlayerId: newPlayerId,
          isComplete: true,
          isAutoPick: false,
          autoPickPlayerId: null,
          ...(pick.selectedAt ? {} : { selectedAt: new Date() }),
        },
      });

      // Whatever roster row the incoming player has — pre-draft FREE_AGENT
      // signal, PICKUP, TRADED, or a spot on another team — becomes the
      // drafted spot on the pick's team, exactly like makePick's upsert.
      const incomingExisting = await tx.playerRoster.findUnique({
        where: { leagueId_playerId: { leagueId: this.leagueId, playerId: newPlayerId } },
      });
      if (incomingExisting && incomingExisting.teamId !== pick.currentOwnerId) {
        incomingFromTeamId = incomingExisting.teamId;
      }
      await tx.playerRoster.upsert({
        where: { leagueId_playerId: { leagueId: this.leagueId, playerId: newPlayerId } },
        create: {
          teamId: pick.currentOwnerId,
          playerId: newPlayerId,
          leagueId: this.leagueId,
          isKeeper: false,
          acquiredVia: 'DRAFTED',
        },
        update: {
          teamId: pick.currentOwnerId,
          isKeeper: false,
          acquiredVia: 'DRAFTED',
        },
      });
      await tx.tradeBlockEntry.deleteMany({
        where: { leagueId: this.leagueId, playerId: newPlayerId },
      });
    });

    this.clearStateCache();

    const affectedTeamIds = [
      ...new Set([pick.currentOwnerId, incomingFromTeamId].filter((id): id is string => !!id)),
    ];
    const rosters = await Promise.all(affectedTeamIds.map((id) => this.getTeamRoster(id)));
    const teamRosterUpdates = Object.fromEntries(
      affectedTeamIds.map((id, i) => [id, rosters[i]!])
    );

    const vacated = vacatedPickRow as PickWithOwner | null;
    const payload: PickEditedPayload = {
      leagueId: this.leagueId,
      pick: {
        id: pick.id,
        season: pick.season,
        round: pick.round,
        pickInRound: pick.pickInRound || 0,
        overallPickNumber: pick.overallPickNumber || 0,
        currentOwnerId: pick.currentOwnerId,
        currentOwnerName: pick.currentOwner.owner?.name || 'Open Slot',
        originalOwnerId: pick.originalOwnerId,
        isComplete: true,
        isKeeper: false,
        selectedPlayer: toPlayerSummary(newPlayer),
        selectedAt: (pick.selectedAt ?? new Date()).toISOString(),
      },
      newPlayer: toPlayerSummary(newPlayer),
      previousPlayer: oldPlayer ? toPlayerSummary(oldPlayer) : undefined,
      releasedPlayer: released && oldPlayer ? toPlayerSummary(oldPlayer) : undefined,
      vacatedPick: vacated
        ? {
            id: vacated.id,
            season: vacated.season,
            round: vacated.round,
            pickInRound: vacated.pickInRound || 0,
            overallPickNumber: vacated.overallPickNumber || 0,
            currentOwnerId: vacated.currentOwnerId,
            currentOwnerName: vacated.currentOwner.owner?.name || 'Open Slot',
            originalOwnerId: vacated.originalOwnerId,
            isComplete: false,
            isKeeper: false,
            selectedPlayer: undefined,
            selectedAt: undefined,
          }
        : undefined,
      teamId: pick.currentOwnerId,
      teamRosterUpdates,
      timestamp: new Date().toISOString(),
    };

    this.room.emit(SocketEvents.PICK_EDITED, payload);

    // Deferred non-critical work (mirrors makePick Phase 4)
    Promise.all([
      this.logActivity(
        'PICK_MADE',
        `Commissioner edit: pick ${pick.overallPickNumber} (${pick.currentOwner.name}) changed from ${oldPlayer?.fullName ?? 'empty'} to ${newPlayer.fullName}`,
        {
          teamId: pick.currentOwnerId,
          pickNumber: pick.overallPickNumber,
          playerId: newPlayerId,
          triggeredById: editedByUserId,
          metadata: { edited: true, previousPlayerId: oldPlayerId },
        }
      ),
      // Scoped to this league's teams: DraftQueue has no leagueId of its own,
      // and other leagues may still be drafting this player.
      this.prisma.draftQueue.deleteMany({
        where: { playerId: newPlayerId, team: { leagueId: this.leagueId } },
      }),
    ]).catch((err) => {
      console.error('[editCompletedPick] Deferred work failed:', err);
    });
  }

  // ===========================================================================
  // DRAFT ORDER
  // ===========================================================================

  async resetDraft(): Promise<void> {
    this.stopTimer();

    await this.prisma.$transaction(async (tx) => {
      const currentSeason = await this.getLeagueSeason();

      // NOTE: future-season pick records are intentionally left untouched — they
      // may represent traded picks. Only the current season is reset.

      // Clear selections only. Pick ownership from completed trades is
      // preserved — traded players stay on their new teams through a reset,
      // so reverting picks to original owners would half-undo those trades.
      await tx.draftPick.updateMany({
        where: { leagueId: this.leagueId, season: currentSeason },
        data: {
          selectedPlayerId: null,
          selectedAt: null,
          isComplete: false,
        },
      });

      // Delete all player rosters (except keepers and marketplace FREE_AGENT entries)
      await tx.playerRoster.deleteMany({
        where: {
          leagueId: this.leagueId,
          isKeeper: false,
          acquiredVia: { not: 'FREE_AGENT' },
        },
      });

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

    await this.logActivity('SETTINGS_CHANGED', 'Draft fully reset by commissioner');

    const fullState = await this.getFullState();
    this.room.emit(SocketEvents.DRAFT_RESET, fullState);
  }

  async setDraftOrder(teamOrder: string[], updatedBy: string): Promise<void> {
    const state = await this.getCurrentState();

    if (state.status === 'IN_PROGRESS' && !state.isPaused) {
      throw new Error('Cannot change order while draft is in progress. Pause the draft first.');
    }

    await this.prisma.$transaction(async (tx) => {
      // (leagueId, draftPosition) is unique — null everything first so
      // reassignments can't collide with a position another team still holds.
      await tx.team.updateMany({
        where: { leagueId: this.leagueId },
        data: { draftPosition: null },
      });

      for (const [index, teamId] of teamOrder.entries()) {
        await tx.team.update({
          where: { id: teamId },
          data: { draftPosition: index + 1 },
        });
      }

      // Recalculate pick assignments if draft hasn't started
      if (state.status === 'NOT_STARTED') {
        await this.recalculateDraftPicks(tx, teamOrder);
      }
    });

    await this.logActivity('ORDER_UPDATED', 'Draft order updated by commissioner', {
      triggeredById: updatedBy,
      metadata: { newOrder: teamOrder },
    });

    const teams = await this.getTeamsWithOrder();

    const payload: OrderUpdatedPayload = {
      leagueId: this.leagueId,
      newOrder: teams,
      updatedBy,
      reason: 'commissioner_set',
      timestamp: new Date().toISOString(),
    };

    this.room.emit(SocketEvents.ORDER_UPDATED, payload);
  }

  private async recalculateDraftPicks(
    tx: Prisma.TransactionClient,
    teamOrder: string[]
  ): Promise<void> {
    const settings = await this.prisma.draftSettings.findUnique({
      where: { leagueId: this.leagueId },
    });

    if (!settings) return;

    const season = await this.getLeagueSeason();

    // Preserve traded ownership across the reorder. Only slotted rows for this
    // season feed the map — unslotted rows are trade-materialized picks that
    // the shared generator adopts in place.
    const currentPicks = await tx.draftPick.findMany({
      where: { leagueId: this.leagueId, season, pickInRound: { not: null } },
      select: { round: true, originalOwnerId: true, currentOwnerId: true },
    });

    await generatePickSlots(tx, {
      leagueId: this.leagueId,
      season,
      teamOrderList: teamOrder,
      totalRounds: settings.totalRounds,
      draftType: settings.draftType,
      tradeMap: buildTradeMap(currentPicks),
    });
  }

  // ===========================================================================
  // TIMER MANAGEMENT
  // ===========================================================================

  private startTimer(durationSeconds: number): void {
    this.stopTimer();

    let remaining = durationSeconds;

    this.timerInterval = setInterval(() => {
      remaining--;

      // Broadcast tick — no async DB call needed, just use local state
      this.room.emit(SocketEvents.TIMER_TICK, {
        leagueId: this.leagueId,
        secondsRemaining: remaining,
        currentPick: 0, // Client already knows the current pick from state
        currentTeamId: '',
      });

      // Update DB periodically (fire-and-forget)
      if (remaining % 10 === 0 && remaining > 0) {
        this.prisma.draftState
          .update({
            where: { leagueId: this.leagueId },
            data: { timerSecondsRemaining: remaining },
          })
          .catch((err) => {
            console.error('[Timer] Failed to persist timer state:', err);
          });
      }

      if (remaining <= 0) {
        this.stopTimer();
        // Execute auto-pick with error handling to prevent silent failures
        this.handleTimerExpired().catch((err) => {
          console.error('[Timer] handleTimerExpired failed:', err);
        });
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
    const teamId = state.currentTeamId;

    await this.logActivity('TIMER_EXPIRED', 'Pick timer expired', {
      teamId,
      pickNumber: state.currentPick,
    });

    this.room.emit(SocketEvents.TIMER_EXPIRED, {
      leagueId: this.leagueId,
      teamId,
      pickNumber: state.currentPick,
    });

    const restrictedPositions = await this.getRestrictedPositionsForTeam(teamId);
    const isPickable = (position: string) =>
      !restrictedPositions.includes(normalizePosition(position));

    // 1. Auto-pick the highest-ranked queued player that is available AND
    //    satisfies positional requirements
    const teamQueue = await this.prisma.draftQueue.findMany({
      where: { teamId },
      orderBy: { rank: 'asc' },
      include: { player: true },
    });

    for (const queueItem of teamQueue) {
      if (isPickable(queueItem.player.position) && (await this.isPlayerAvailable(queueItem.playerId))) {
        console.log(
          `[TimerExpired] Drafting top valid queued player ${queueItem.playerId} for team ${teamId}`
        );
        await this.makePick(teamId, queueItem.playerId);
        return;
      }
    }

    // 2. Fallback to best available player that satisfies positional requirements
    const availablePlayers = await this.getAvailablePlayers();
    const validPlayer = availablePlayers.find((p) => isPickable(p.position));

    if (validPlayer) {
      console.log(
        `[TimerExpired] No queue found. Drafting best valid player ${validPlayer.fullName} for team ${teamId}`
      );
      await this.makePick(teamId, validPlayer.id);
      return;
    }

    // Last resort: if no valid player is found (should be rare), just take the best
    // available to avoid stalling the draft. Shouldn't happen with correct settings.
    const bestPlayer = availablePlayers[0];
    if (bestPlayer) {
      console.log(
        `[TimerExpired] No valid position player found. Drafting best available player ${bestPlayer.fullName} for team ${teamId}`
      );
      await this.makePick(teamId, bestPlayer.id);
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private async logActivity(
    activityType: Prisma.DraftActivityLogCreateInput['activityType'],
    description: string,
    extra: Partial<Prisma.DraftActivityLogUncheckedCreateInput> = {}
  ): Promise<void> {
    await this.prisma.draftActivityLog.create({
      data: {
        leagueId: this.leagueId,
        activityType,
        description,
        ...extra,
      },
    });
  }

  private async isPlayerAvailable(playerId: string): Promise<boolean> {
    const [draftedPick, rosterEntry] = await Promise.all([
      this.prisma.draftPick.findFirst({
        where: {
          leagueId: this.leagueId,
          season: await this.getLeagueSeason(),
          selectedPlayerId: playerId,
          isComplete: true,
        },
      }),
      // Rostered = keeper or drafted; marketplace FREE_AGENT entries don't count
      this.prisma.playerRoster.findFirst({
        where: {
          leagueId: this.leagueId,
          playerId,
          ...ROSTERED_PLAYER_WHERE,
        },
      }),
    ]);

    return !draftedPick && !rosterEntry;
  }

  // League.season is the authoritative season for the live draft. Picks from
  // other seasons (e.g. future picks acquired via trade) belong to later
  // drafts and must not count toward this one's math.
  //
  // Deliberately NOT cached: manager instances live for the whole socket
  // process (never evicted), and season rollover bumps League.season from the
  // Next.js process, which has no way to invalidate state held here. A PK
  // select per call is the price of always being right.
  private async getLeagueSeason(): Promise<number> {
    const league = await this.prisma.league.findUnique({
      where: { id: this.leagueId },
      select: { season: true },
    });
    return league?.season ?? new Date().getFullYear();
  }

  // Determines which positions a team may NOT draft, so remaining picks are
  // guaranteed to cover every unfilled starting slot.
  private async getRestrictedPositionsForTeam(teamId: string): Promise<string[]> {
    const settings = await this.prisma.draftSettings.findUnique({
      where: { leagueId: this.leagueId },
    });

    if (!settings) return [];

    const season = await this.getLeagueSeason();

    // Fetch roster and remaining picks in parallel (exclude marketplace FREE_AGENT entries)
    const [roster, remainingPicks] = await Promise.all([
      this.prisma.playerRoster.findMany({
        where: {
          leagueId: this.leagueId,
          teamId,
          ...ROSTERED_PLAYER_WHERE,
        },
        include: { player: { select: { position: true } } },
      }),
      this.prisma.draftPick.count({
        where: {
          leagueId: this.leagueId,
          season,
          currentOwnerId: teamId,
          isComplete: false,
        },
      }),
    ]);

    return getRestrictedPositions(
      roster.map((entry) => entry.player.position),
      settings,
      remainingPicks
    );
  }

  // Finds the next uncompleted pick with a higher overall number. Uses the
  // actual DraftPick rows as the source of truth, which is more resilient than
  // computing total picks from settings.
  private async calculateNextPick(
    currentOverall: number
  ): Promise<{ round: number; overall: number; teamId: string } | null> {
    const nextPick = await this.prisma.draftPick.findFirst({
      where: {
        leagueId: this.leagueId,
        season: await this.getLeagueSeason(),
        overallPickNumber: { gt: currentOverall },
        isComplete: false,
      },
      orderBy: { overallPickNumber: 'asc' },
    });

    if (!nextPick || !nextPick.overallPickNumber) return null;

    return {
      round: nextPick.round,
      overall: nextPick.overallPickNumber,
      teamId: nextPick.currentOwnerId,
    };
  }
}
