// Draft Socket Hook
// Manages real-time connection to the draft server

'use client';

import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import type { DraftStatus } from '@prisma/client';
import { createAuthenticatedSocket, type TypedSocket } from '@/lib/socket-connection';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  StateSyncPayload,
  PickMadePayload,
  PickUndonePayload,
  PickEditedPayload,
  TimerTickPayload,
  TradeOfferedPayload,
  TradeAcceptedPayload,
  DraftStartPayload,
  DraftPausePayload,
  OnTheClockPayload,
  OrderUpdatedPayload,
  TeamSummary,
  PlayerSummary,
  RosterPlayer,
  RosterSettings,
  DraftPickSummary,
  ErrorPayload,
} from '@/types/socket';
import { SocketEvents } from '@/types/socket';

// ============================================================================
// TYPES
// ============================================================================

export interface DraftState {
  isConnected: boolean;
  status: DraftStatus;
  currentRound: number;
  currentPick: number;
  currentTeamId: string | null;
  currentTeam: TeamSummary | null;
  isPaused: boolean;
  pauseReason: string | null;
  timerSecondsRemaining: number | null;
  draftOrder: TeamSummary[];
  completedPicks: DraftPickSummary[];
  allPicks: DraftPickSummary[];
  // The draft's season from the server; 0 until the first state sync
  season: number;
  availablePlayers: PlayerSummary[];
  teamRosters: Record<string, RosterPlayer[]>;
  pendingTrades: TradeOfferedPayload[];
  totalRounds: number;
  draftType: 'SNAKE' | 'LINEAR';
  teamQueues: Record<string, PlayerSummary[]>;
  rosterSettings?: RosterSettings;
  lastUpdate: Date | null;
  error: ErrorPayload | null;
  pendingPickId: string | null;
}

type TradeAssetInput = { assetType: string; id: string };

interface UseDraftSocketOptions {
  leagueId: string;
  userId: string;
  teamId?: string;
  onPickMade?: (payload: PickMadePayload) => void;
  onTradeOffered?: (payload: TradeOfferedPayload) => void;
  onTradeAccepted?: (payload: TradeAcceptedPayload) => void;
  onDraftStart?: (payload: DraftStartPayload) => void;
  onError?: (error: ErrorPayload) => void;
}

interface UseDraftSocketReturn {
  state: DraftState;
  timerSeconds: number | null;
  isMyTurn: boolean;
  myTeam: TeamSummary | null;
  actions: {
    makePick: (playerId: string) => void;
    proposeTrade: (
      receiverTeamId: string,
      myAssets: TradeAssetInput[],
      theirAssets: TradeAssetInput[]
    ) => void;
    acceptTrade: (tradeId: string) => void;
    rejectTrade: (tradeId: string) => void;
    cancelTrade: (tradeId: string) => void;
    // Commissioner actions
    startDraft: () => void;
    pauseDraft: (reason?: string) => void;
    resumeDraft: () => void;
    resetDraft: () => void;
    forcePick: (playerId: string) => void;
    undoLastPick: () => void;
    editPick: (pickId: string, playerId: string) => void;
    updateOrder: (teamOrder: string[]) => void;
    updateQueue: (teamId: string, playerIds: string[]) => void;
    toggleQueue: (teamId: string, playerId: string) => void;
    updateTeamName: (teamId: string, name: string) => void;
    clearError: () => void;
  };
  disconnect: () => void;
  reconnect: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const DEFAULT_TOTAL_ROUNDS = 14;

const initialState: DraftState = {
  isConnected: false,
  status: 'NOT_STARTED',
  currentRound: 1,
  currentPick: 1,
  currentTeamId: null,
  currentTeam: null,
  isPaused: false,
  pauseReason: null,
  timerSecondsRemaining: null,
  draftOrder: [],
  completedPicks: [],
  allPicks: [],
  season: 0,
  availablePlayers: [],
  teamRosters: {},
  pendingTrades: [],
  totalRounds: DEFAULT_TOTAL_ROUNDS,
  draftType: 'SNAKE',
  teamQueues: {},
  lastUpdate: null,
  error: null,
  pendingPickId: null,
};

// ============================================================================
// PURE STATE TRANSITIONS
// Kept outside the hook so they are individually testable and the socket
// wiring below stays thin.
// ============================================================================

function clearPickSelection(pick: DraftPickSummary): DraftPickSummary {
  return { ...pick, isComplete: false, selectedPlayer: undefined, selectedAt: undefined };
}

function mergeRosterUpdates(
  rosters: Record<string, RosterPlayer[]>,
  updates?: Record<string, RosterPlayer[]>
): Record<string, RosterPlayer[]> {
  return updates ? { ...rosters, ...updates } : rosters;
}

function withoutTrade(prev: DraftState, tradeId: string): DraftState {
  return {
    ...prev,
    pendingTrades: prev.pendingTrades.filter((t) => t.tradeId !== tradeId),
    lastUpdate: new Date(),
  };
}

// Full-state replacement used for STATE_SYNC and DRAFT_RESET.
function applyStateSync(prev: DraftState, payload: StateSyncPayload): DraftState {
  return {
    ...prev,
    status: payload.status,
    currentRound: payload.currentRound,
    currentPick: payload.currentPick,
    currentTeamId: payload.currentTeamId,
    currentTeam: payload.currentTeam,
    isPaused: payload.isPaused,
    pauseReason: payload.pauseReason,
    timerSecondsRemaining: payload.timerSecondsRemaining,
    draftOrder: payload.draftOrder,
    completedPicks: payload.completedPicks,
    allPicks: payload.allPicks,
    season: payload.season || prev.season,
    availablePlayers: payload.availablePlayers,
    teamRosters: payload.teamRosters,
    pendingTrades: payload.pendingTrades,
    totalRounds: payload.totalRounds || DEFAULT_TOTAL_ROUNDS,
    draftType: payload.draftType || 'SNAKE',
    rosterSettings: payload.rosterSettings,
    teamQueues: payload.teamQueues || {},
    lastUpdate: new Date(),
  };
}

export function applyPickMade(prev: DraftState, payload: PickMadePayload): DraftState {
  return {
    ...prev,
    // Filter out any optimistic pick matching this pick number to avoid duplicates
    completedPicks: [
      ...prev.completedPicks.filter(
        (p) => !(p.season === payload.pick.season && p.overallPickNumber === payload.pickNumber)
      ),
      payload.pick,
    ],
    // Remove player (may already be removed by optimistic update)
    availablePlayers: prev.availablePlayers.filter((p) => p.id !== payload.player.id),
    // Upsert the official server pick into its board slot so it supersedes our
    // optimistic "opt-..." entry — and is appended rather than silently dropped
    // when no entry occupies the slot (e.g. after a stale or partial sync).
    allPicks: upsertPickIntoSlot(prev.allPicks, payload.pick, payload.pickNumber),
    currentPick: payload.nextPick?.pickNumber || prev.currentPick,
    currentRound: payload.nextPick?.round || prev.currentRound,
    currentTeamId: payload.nextPick?.teamId || null,
    currentTeam: payload.nextPick?.team || null,
    teamRosters: mergeRosterUpdates(prev.teamRosters, payload.teamRosterUpdates),
    pendingPickId: null, // Clear optimistic flag
    lastUpdate: new Date(),
  };
}

function applyPickUndone(prev: DraftState, payload: PickUndonePayload): DraftState {
  return {
    ...prev,
    completedPicks: prev.completedPicks.filter((p) => p.id !== payload.pickId),
    currentPick: payload.pickNumber,
    currentTeamId: payload.revertedToTeamId,
    teamRosters: mergeRosterUpdates(prev.teamRosters, payload.teamRosterUpdates),
    allPicks: prev.allPicks.map((p) => (p.id === payload.pickId ? clearPickSelection(p) : p)),
    lastUpdate: new Date(),
  };
}

// Commissioner swapped the player on a completed pick post-draft: update the
// board slot, the owning team's roster, and pool/queue membership for both
// players. Status and clock fields are deliberately untouched.
function applyPickEdited(prev: DraftState, payload: PickEditedPayload): DraftState {
  const teamQueues: Record<string, PlayerSummary[]> = {};
  for (const [queueTeamId, queue] of Object.entries(prev.teamQueues)) {
    teamQueues[queueTeamId] = queue.filter((p) => p.id !== payload.newPlayer.id);
  }

  // Replace in place: completedPicks stays ordered by pick number, and the
  // optimistic undo path reads its last element as the most recent pick.
  const editedIndex = prev.completedPicks.findIndex(
    (p) =>
      p.id === payload.pick.id ||
      (p.season === payload.pick.season && p.overallPickNumber === payload.pick.overallPickNumber)
  );

  return {
    ...prev,
    completedPicks:
      editedIndex === -1
        ? [...prev.completedPicks, payload.pick]
        : prev.completedPicks.map((p, i) => (i === editedIndex ? payload.pick : p)),
    allPicks: upsertPickIntoSlot(prev.allPicks, payload.pick, payload.pick.overallPickNumber),
    // Return the outgoing player to the pool (sorted by rank, like undo) and
    // drop the incoming one; both filters also make redelivery idempotent.
    availablePlayers: [
      ...prev.availablePlayers.filter(
        (p) => p.id !== payload.newPlayer.id && p.id !== payload.previousPlayer.id
      ),
      { ...payload.previousPlayer, keptByTeam: null },
    ].sort((a, b) => (a.rank || 9999) - (b.rank || 9999)),
    teamRosters: mergeRosterUpdates(prev.teamRosters, payload.teamRosterUpdates),
    teamQueues,
    lastUpdate: new Date(),
  };
}

// Remove the taken player from the available pool AND from every team queue.
function applyPlayerTaken(prev: DraftState, playerId: string): DraftState {
  const teamQueues: Record<string, PlayerSummary[]> = {};
  for (const [queueTeamId, queue] of Object.entries(prev.teamQueues)) {
    teamQueues[queueTeamId] = queue.filter((p) => p.id !== playerId);
  }

  return {
    ...prev,
    availablePlayers: prev.availablePlayers.filter((p) => p.id !== playerId),
    teamQueues,
  };
}

function sortPicks(picks: DraftPickSummary[]): DraftPickSummary[] {
  return picks.sort((a, b) => a.season - b.season || a.overallPickNumber - b.overallPickNumber);
}

// Replace whatever occupies the given board slot with the official pick,
// appending instead of dropping it when no entry matches the slot.
function upsertPickIntoSlot(
  picks: DraftPickSummary[],
  pick: DraftPickSummary,
  slotNumber: number
): DraftPickSummary[] {
  return sortPicks([
    ...picks.filter(
      (p) =>
        !(
          p.season === pick.season &&
          (p.overallPickNumber === slotNumber || p.overallPickNumber === pick.overallPickNumber)
        )
    ),
    pick,
  ]);
}

// On a slot collision, keep the entry that actually shows a drafted player,
// then prefer real DB ids over optimistic "opt-..." ones.
function preferPick(pick: DraftPickSummary, rival: DraftPickSummary): boolean {
  const pickFilled = pick.isComplete && !!pick.selectedPlayer;
  const rivalFilled = rival.isComplete && !!rival.selectedPlayer;
  if (pickFilled !== rivalFilled) return pickFilled;
  const pickReal = !pick.id.startsWith('opt-');
  const rivalReal = !rival.id.startsWith('opt-');
  if (pickReal !== rivalReal) return pickReal;
  return false;
}

export function mergeUpdatedPicks(
  picks: DraftPickSummary[],
  updates: DraftPickSummary[]
): DraftPickSummary[] {
  const pickById = new Map(picks.map((p) => [p.id, p]));
  for (const updated of updates) {
    const existing = pickById.get(updated.id);
    pickById.set(updated.id, existing ? { ...existing, ...updated } : updated);
  }

  // A trade payload can carry a row the client knew under another id (an
  // optimistic "opt-..." entry, or a row born before the client joined),
  // leaving two entries claiming the same board slot; the board renders one
  // per slot, so an unfilled duplicate could shadow a completed pick. Slot
  // numbers <= 0 are exempt: unslotted future picks all share 0 and are
  // distinct picks, not duplicates.
  const bySlot = new Map<string, DraftPickSummary>();
  const unslotted: DraftPickSummary[] = [];
  for (const pick of pickById.values()) {
    if (pick.overallPickNumber <= 0) {
      unslotted.push(pick);
      continue;
    }
    const key = `${pick.season}:${pick.overallPickNumber}`;
    const rival = bySlot.get(key);
    if (!rival || preferPick(pick, rival)) bySlot.set(key, pick);
  }
  return sortPicks([...unslotted, ...bySlot.values()]);
}

function applyTradeAccepted(prev: DraftState, payload: TradeAcceptedPayload): DraftState {
  return {
    ...prev,
    pendingTrades: prev.pendingTrades.filter((t) => t.tradeId !== payload.tradeId),
    teamRosters: mergeRosterUpdates(prev.teamRosters, payload.teamRosterUpdates),
    allPicks: payload.updatedDraftOrder
      ? mergeUpdatedPicks(prev.allPicks, payload.updatedDraftOrder)
      : prev.allPicks,
    lastUpdate: new Date(),
  };
}

// Optimistically move players and picks between the two teams of an accepted trade.
function applyOptimisticTradeAccept(prev: DraftState, tradeId: string): DraftState {
  const trade = prev.pendingTrades.find((t) => t.tradeId === tradeId);
  if (!trade) return prev;

  const initiatorId = trade.initiatorTeam.id;
  const receiverId = trade.receiverTeam.id;

  // Move players between rosters
  const teamRosters = { ...prev.teamRosters };
  const initiatorPlayers = [...(teamRosters[initiatorId] || [])];
  const receiverPlayers = [...(teamRosters[receiverId] || [])];

  const movePlayer = (from: RosterPlayer[], to: RosterPlayer[], playerId?: string) => {
    const index = from.findIndex((p) => p.id === playerId);
    if (index !== -1) {
      const [moved] = from.splice(index, 1);
      to.push(moved!);
    }
  };

  for (const asset of trade.initiatorAssets) {
    if (asset.assetType === 'PLAYER') movePlayer(initiatorPlayers, receiverPlayers, asset.player?.id);
  }
  for (const asset of trade.receiverAssets) {
    if (asset.assetType === 'PLAYER') movePlayer(receiverPlayers, initiatorPlayers, asset.player?.id);
  }

  teamRosters[initiatorId] = initiatorPlayers;
  teamRosters[receiverId] = receiverPlayers;

  // Move draft picks on the board.
  // NOTE: this compares the trade ASSET id against the draft PICK id, so it
  // never matches and the optimistic pick move is a no-op; the board is
  // corrected when the server's TRADE_ACCEPTED arrives with updatedDraftOrder.
  // Kept as-is to preserve behavior — fixing it means using asset.draftPick?.id.
  const initiatorGivesPicks = new Set(
    trade.initiatorAssets.filter((a) => a.assetType === 'DRAFT_PICK').map((a) => a.id)
  );
  const receiverGivesPicks = new Set(
    trade.receiverAssets.filter((a) => a.assetType === 'DRAFT_PICK').map((a) => a.id)
  );

  const allPicks = prev.allPicks.map((p) => {
    if (initiatorGivesPicks.has(p.id)) {
      return { ...p, currentOwnerId: receiverId, currentOwnerName: trade.receiverTeam.name };
    }
    if (receiverGivesPicks.has(p.id)) {
      return { ...p, currentOwnerId: initiatorId, currentOwnerName: trade.initiatorTeam.name };
    }
    return p;
  });

  return {
    ...prev,
    pendingTrades: prev.pendingTrades.filter((t) => t.tradeId !== tradeId),
    teamRosters,
    allPicks,
    lastUpdate: new Date(),
  };
}

// Rename a team everywhere it appears. Callers decide whether to bump lastUpdate.
function applyTeamRename(prev: DraftState, teamId: string, name: string): DraftState {
  const renamePickOwner = (pick: DraftPickSummary): DraftPickSummary =>
    pick.currentOwnerId === teamId ? { ...pick, currentOwnerName: name } : pick;

  return {
    ...prev,
    draftOrder: prev.draftOrder.map((t) => (t.id === teamId ? { ...t, name } : t)),
    currentTeam:
      prev.currentTeam?.id === teamId ? { ...prev.currentTeam, name } : prev.currentTeam,
    allPicks: prev.allPicks.map(renamePickOwner),
    completedPicks: prev.completedPicks.map(renamePickOwner),
  };
}

function buildOptimisticPick(
  prev: DraftState,
  teamId: string,
  player: PlayerSummary,
  idPrefix: string,
  fallbackOwnerName: string
): DraftPickSummary {
  // Build on top of the real slot row when the client has one, so the DB id
  // survives the optimistic window and later by-id merges (trade payloads,
  // undo) still find the pick.
  const existing = prev.allPicks.find(
    (p) => p.overallPickNumber === prev.currentPick && (!prev.season || p.season === prev.season)
  );
  if (existing) {
    return {
      ...existing,
      isComplete: true,
      isKeeper: false,
      selectedPlayer: player,
      selectedAt: new Date().toISOString(),
    };
  }

  return {
    id: `${idPrefix}-${Date.now()}`,
    season: prev.season || new Date().getFullYear(),
    round: prev.currentRound,
    pickInRound: 0, // Unknown until the server confirms
    overallPickNumber: prev.currentPick,
    currentOwnerId: teamId,
    currentOwnerName: prev.currentTeam?.name || fallbackOwnerName,
    originalOwnerId: teamId,
    isComplete: true,
    isKeeper: false,
    selectedPlayer: player,
    selectedAt: new Date().toISOString(),
  };
}

// ============================================================================
// HOOK
// ============================================================================

export function useDraftSocket(options: UseDraftSocketOptions): UseDraftSocketReturn {
  const {
    leagueId,
    userId,
    teamId,
    onPickMade,
    onTradeOffered,
    onTradeAccepted,
    onDraftStart,
    onError,
  } = options;

  const socketRef = useRef<TypedSocket | null>(null);
  const [state, setState] = useState<DraftState>(initialState);

  // Separate timer state to avoid re-rendering the entire component tree on every tick
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);

  const myTeam = state.draftOrder.find((t) => t.id === teamId) || null;

  const isMyTurn =
    state.status === 'IN_PROGRESS' && !state.isPaused && state.currentTeamId === teamId;

  // Use refs for callbacks to avoid re-connecting when they change
  const callbacks = useRef({
    onPickMade,
    onTradeOffered,
    onTradeAccepted,
    onDraftStart,
    onError,
  });

  useEffect(() => {
    callbacks.current = {
      onPickMade,
      onTradeOffered,
      onTradeAccepted,
      onDraftStart,
      onError,
    };
  }, [onPickMade, onTradeOffered, onTradeAccepted, onDraftStart, onError]);

  // ==========================================================================
  // SOCKET CONNECTION
  // ==========================================================================

  useEffect(() => {
    if (!leagueId || !userId) return;

    console.log('Connecting to socket...');

    const socket = createAuthenticatedSocket();

    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log('Socket connected');
      setState((prev) => ({ ...prev, isConnected: true, error: null }));

      socket.emit(SocketEvents.JOIN_DRAFT_ROOM, { leagueId });
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setState((prev) => ({ ...prev, isConnected: false }));
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setState((prev) => ({
        ...prev,
        isConnected: false,
        error: { code: 'CONN_ERROR', message: error.message },
      }));
    });

    // State sync (initial load, reconnection, and full reset)
    socket.on(SocketEvents.STATE_SYNC, (payload: StateSyncPayload) => {
      setState((prev) => applyStateSync(prev, payload));
    });

    socket.on(SocketEvents.DRAFT_RESET, (payload: StateSyncPayload) => {
      setState((prev) => applyStateSync(prev, payload));
    });

    // Draft lifecycle
    socket.on(SocketEvents.DRAFT_START, (payload: DraftStartPayload) => {
      setState((prev) => ({
        ...prev,
        status: 'IN_PROGRESS',
        currentPick: payload.currentPick,
        currentTeamId: payload.currentTeamId,
        currentTeam: payload.currentTeam,
        timerSecondsRemaining: payload.timerDuration,
        draftOrder: payload.draftOrder,
        lastUpdate: new Date(),
      }));
      callbacks.current.onDraftStart?.(payload);
    });

    socket.on(SocketEvents.DRAFT_PAUSE, (payload: DraftPausePayload) => {
      setState((prev) => ({
        ...prev,
        isPaused: true,
        pauseReason: payload.reason || null,
        timerSecondsRemaining: payload.timerSecondsRemaining,
        lastUpdate: new Date(),
      }));
    });

    socket.on(SocketEvents.DRAFT_RESUME, (payload: DraftPausePayload) => {
      setState((prev) => ({
        ...prev,
        isPaused: false,
        pauseReason: null,
        timerSecondsRemaining: payload.timerSecondsRemaining,
        lastUpdate: new Date(),
      }));
    });

    socket.on(SocketEvents.DRAFT_COMPLETE, () => {
      setState((prev) => ({
        ...prev,
        status: 'COMPLETED',
        currentTeamId: null,
        currentTeam: null,
        timerSecondsRemaining: null,
        lastUpdate: new Date(),
      }));
    });

    // Timer tick — only update the isolated timer state, NOT the full draft state
    socket.on(SocketEvents.TIMER_TICK, (payload: TimerTickPayload) => {
      setTimerSeconds(payload.secondsRemaining);
    });

    // Pick events
    socket.on(SocketEvents.PICK_MADE, (payload: PickMadePayload) => {
      setState((prev) => applyPickMade(prev, payload));
      callbacks.current.onPickMade?.(payload);
    });

    socket.on(SocketEvents.ON_THE_CLOCK, (payload: OnTheClockPayload) => {
      setState((prev) => ({
        ...prev,
        currentPick: payload.pickNumber,
        currentRound: payload.round,
        currentTeamId: payload.teamId,
        currentTeam: payload.team,
        timerSecondsRemaining: payload.timerDuration,
        lastUpdate: new Date(),
      }));
    });

    socket.on(SocketEvents.PICK_UNDONE, (payload) => {
      setState((prev) => applyPickUndone(prev, payload));
    });

    socket.on(SocketEvents.PICK_EDITED, (payload) => {
      setState((prev) => applyPickEdited(prev, payload));
    });

    // Player taken (backup event)
    socket.on(SocketEvents.PLAYER_TAKEN, (payload) => {
      // Guard against potential undefined payload issues
      if (!payload?.playerId) return;
      setState((prev) => applyPlayerTaken(prev, payload.playerId));
    });

    // Order updated
    socket.on(SocketEvents.ORDER_UPDATED, (payload: OrderUpdatedPayload) => {
      setState((prev) => ({
        ...prev,
        draftOrder: payload.newOrder,
        lastUpdate: new Date(),
      }));
    });

    // Trade events
    socket.on(SocketEvents.TRADE_OFFERED, (payload: TradeOfferedPayload) => {
      setState((prev) => ({
        ...prev,
        pendingTrades: [...prev.pendingTrades, payload],
        lastUpdate: new Date(),
      }));
      callbacks.current.onTradeOffered?.(payload);
    });

    socket.on(SocketEvents.TRADE_ACCEPTED, (payload: TradeAcceptedPayload) => {
      setState((prev) => applyTradeAccepted(prev, payload));
      callbacks.current.onTradeAccepted?.(payload);
    });

    socket.on(SocketEvents.TRADE_REJECTED, (payload) => {
      setState((prev) => withoutTrade(prev, payload.tradeId));
    });

    socket.on(SocketEvents.TRADE_CANCELLED, (payload) => {
      setState((prev) => withoutTrade(prev, payload.tradeId));
    });

    // Queue updated
    socket.on(SocketEvents.QUEUE_UPDATED, (payload) => {
      setState((prev) => ({
        ...prev,
        teamQueues: {
          ...prev.teamQueues,
          [payload.teamId]: payload.queue,
        },
        lastUpdate: new Date(),
      }));
    });

    // Team name updated
    socket.on(SocketEvents.TEAM_UPDATED, (payload) => {
      setState((prev) => ({
        ...applyTeamRename(prev, payload.teamId, payload.name),
        lastUpdate: new Date(),
      }));
    });

    // Error handling
    socket.on(SocketEvents.ERROR, (payload: ErrorPayload) => {
      setState((prev) => ({ ...prev, error: payload }));
      callbacks.current.onError?.(payload);
    });

    return () => {
      console.log('Cleaning up socket...');
      socket.emit(SocketEvents.LEAVE_DRAFT_ROOM, { leagueId });
      socket.disconnect();
    };
  }, [leagueId, userId, teamId]);

  // ==========================================================================
  // ACTIONS
  // ==========================================================================

  const makePick = useCallback(
    (playerId: string) => {
      if (!socketRef.current || !teamId) return;

      // OPTIMISTIC: fill the board, roster, and queue before the server confirms
      setState((prev) => {
        const player = prev.availablePlayers.find((p) => p.id === playerId);
        if (!player) return prev;

        const optimisticPick = buildOptimisticPick(prev, teamId, player, 'opt', 'Me');
        const rosterAddition: RosterPlayer = { ...player, isKeeper: false, round: prev.currentRound };

        return {
          ...prev,
          availablePlayers: prev.availablePlayers.filter((p) => p.id !== playerId),
          completedPicks: [...prev.completedPicks, optimisticPick],
          allPicks: upsertPickIntoSlot(prev.allPicks, optimisticPick, prev.currentPick),
          teamRosters: {
            ...prev.teamRosters,
            [teamId]: [...(prev.teamRosters[teamId] || []), rosterAddition],
          },
          teamQueues: {
            ...prev.teamQueues,
            [teamId]: (prev.teamQueues[teamId] || []).filter((p) => p.id !== playerId),
          },
          pendingPickId: playerId,
          currentTeamId: null, // Disable draft button until server confirms next team
          currentTeam: null,
          timerSecondsRemaining: null,
          lastUpdate: new Date(),
        };
      });

      socketRef.current.emit(SocketEvents.PICK_MADE, { leagueId, playerId });
    },
    [leagueId, teamId]
  );

  const proposeTrade = useCallback(
    (receiverTeamId: string, myAssets: TradeAssetInput[], theirAssets: TradeAssetInput[]) => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.TRADE_OFFERED, {
        leagueId,
        receiverTeamId,
        initiatorAssets: myAssets,
        receiverAssets: theirAssets,
      });
    },
    [leagueId]
  );

  const acceptTrade = useCallback(
    (tradeId: string) => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Move assets before server round-trip
      setState((prev) => applyOptimisticTradeAccept(prev, tradeId));

      socketRef.current.emit(SocketEvents.TRADE_ACCEPTED, { tradeId });
    },
    []
  );

  const rejectTrade = useCallback(
    (tradeId: string) => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Remove trade from list
      setState((prev) => withoutTrade(prev, tradeId));

      socketRef.current.emit(SocketEvents.TRADE_REJECTED, { tradeId });
    },
    []
  );

  const cancelTrade = useCallback(
    (tradeId: string) => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Remove trade from list
      setState((prev) => withoutTrade(prev, tradeId));

      socketRef.current.emit(SocketEvents.TRADE_CANCELLED, { tradeId });
    },
    []
  );

  // Commissioner actions

  const startDraft = useCallback(() => {
    if (!socketRef.current) return;

    // OPTIMISTIC: Change status
    setState((prev) => ({
      ...prev,
      status: 'IN_PROGRESS',
      lastUpdate: new Date(),
    }));

    socketRef.current.emit(SocketEvents.DRAFT_START, { leagueId });
  }, [leagueId]);

  const pauseDraft = useCallback(
    (reason?: string) => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Change status
      setState((prev) => ({
        ...prev,
        isPaused: true,
        pauseReason: reason || 'Paused by commissioner',
        lastUpdate: new Date(),
      }));

      socketRef.current.emit(SocketEvents.DRAFT_PAUSE, { leagueId, reason });
    },
    [leagueId]
  );

  const resumeDraft = useCallback(() => {
    if (!socketRef.current) return;

    // OPTIMISTIC: Change status
    setState((prev) => ({
      ...prev,
      isPaused: false,
      pauseReason: null,
      lastUpdate: new Date(),
    }));

    socketRef.current.emit(SocketEvents.DRAFT_RESUME, { leagueId });
  }, [leagueId]);

  const resetDraft = useCallback(() => {
    if (!socketRef.current) return;

    // OPTIMISTIC: Wipe everything locally, keeping connection, board slots,
    // draft order, and queues
    setState((prev) => ({
      ...initialState,
      isConnected: true,
      allPicks: prev.allPicks.map(clearPickSelection),
      draftOrder: prev.draftOrder,
      teamQueues: prev.teamQueues,
      lastUpdate: new Date(),
    }));

    socketRef.current.emit(SocketEvents.DRAFT_RESET, { leagueId });
  }, [leagueId]);

  const forcePick = useCallback(
    (playerId: string) => {
      if (!socketRef.current) return;
      const teamIdToDraft = state.currentTeamId;
      if (!teamIdToDraft) return;

      // OPTIMISTIC (matches makePick logic)
      setState((prev) => {
        const player = prev.availablePlayers.find((p) => p.id === playerId);
        if (!player) return prev;

        const optimisticPick = buildOptimisticPick(prev, teamIdToDraft, player, 'opt-force', 'Forced');

        return {
          ...prev,
          availablePlayers: prev.availablePlayers.filter((p) => p.id !== playerId),
          completedPicks: [...prev.completedPicks, optimisticPick],
          allPicks: upsertPickIntoSlot(prev.allPicks, optimisticPick, prev.currentPick),
          teamRosters: {
            ...prev.teamRosters,
            [teamIdToDraft]: [
              ...(prev.teamRosters[teamIdToDraft] || []),
              { ...player, isKeeper: false },
            ],
          },
          currentTeamId: null,
          lastUpdate: new Date(),
        };
      });

      socketRef.current.emit(SocketEvents.FORCE_PICK, { leagueId, playerId });
    },
    [leagueId, state.currentTeamId]
  );

  const undoLastPick = useCallback(() => {
    if (!socketRef.current) return;

    // OPTIMISTIC: Move board back one step
    setState((prev) => {
      const lastPick = prev.completedPicks[prev.completedPicks.length - 1];
      if (!lastPick || !lastPick.selectedPlayer) return prev;

      const player = lastPick.selectedPlayer;
      const pickOwnerId = lastPick.currentOwnerId;

      return {
        ...prev,
        // Restore available player, keeping the pool sorted by rank
        availablePlayers: [...prev.availablePlayers, player].sort(
          (a, b) => (a.rank || 9999) - (b.rank || 9999)
        ),
        completedPicks: prev.completedPicks.slice(0, -1),
        allPicks: prev.allPicks.map((p) =>
          p.overallPickNumber === lastPick.overallPickNumber ? clearPickSelection(p) : p
        ),
        teamRosters: {
          ...prev.teamRosters,
          [pickOwnerId]: (prev.teamRosters[pickOwnerId] || []).filter((p) => p.id !== player.id),
        },
        currentPick: lastPick.overallPickNumber,
        currentRound: lastPick.round,
        currentTeamId: pickOwnerId,
        lastUpdate: new Date(),
      };
    });

    socketRef.current.emit(SocketEvents.PICK_UNDONE, { leagueId });
  }, [leagueId]);

  // Commissioner post-draft pick edit. No optimistic update: it's a rare
  // corrective action and the PICK_EDITED broadcast is authoritative.
  const editPick = useCallback(
    (pickId: string, playerId: string) => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.EDIT_PICK, { leagueId, pickId, playerId });
    },
    [leagueId]
  );

  const updateOrder = useCallback(
    (teamOrder: string[]) => {
      if (!socketRef.current) return;

      setState((prev) => {
        const newOrder = teamOrder
          .map((id, index) => {
            const team = prev.draftOrder.find((t) => t.id === id);
            return team ? { ...team, draftPosition: index + 1 } : null;
          })
          .filter((t): t is TeamSummary => !!t);

        return { ...prev, draftOrder: newOrder, lastUpdate: new Date() };
      });

      socketRef.current.emit(SocketEvents.ORDER_UPDATED, { leagueId, teamOrder });
    },
    [leagueId]
  );

  const updateQueue = useCallback(
    (queueTeamId: string, playerIds: string[]) => {
      if (!socketRef.current) return;

      // Optimistic update to prevent race conditions during rapid clicks
      setState((prev) => {
        // Collect full player objects from available players or the current queue
        const currentQueue = prev.teamQueues[queueTeamId] || [];
        const updatedQueue = playerIds
          .map(
            (id) =>
              prev.availablePlayers.find((p) => p.id === id) ||
              currentQueue.find((p) => p.id === id)
          )
          .filter((p): p is PlayerSummary => !!p);

        return {
          ...prev,
          teamQueues: {
            ...prev.teamQueues,
            [queueTeamId]: updatedQueue,
          },
        };
      });

      socketRef.current.emit(SocketEvents.UPDATE_QUEUE, {
        leagueId,
        teamId: queueTeamId,
        playerIds,
      });
    },
    [leagueId]
  );

  const toggleQueue = useCallback(
    (queueTeamId: string, playerId: string) => {
      if (!socketRef.current) return;

      setState((prev) => {
        const currentQueue = prev.teamQueues[queueTeamId] || [];
        const isQueued = currentQueue.some((p) => p.id === playerId);
        let updatedQueue: PlayerSummary[];

        if (isQueued) {
          updatedQueue = currentQueue.filter((p) => p.id !== playerId);
        } else {
          // Find the player object to add - check pool, then all picks for keepers
          const player =
            prev.availablePlayers.find((p) => p.id === playerId) ||
            prev.allPicks.find((p) => p.selectedPlayer?.id === playerId)?.selectedPlayer;

          if (!player) return prev;
          updatedQueue = [...currentQueue, player];
        }

        // NOTE: emitting inside the state updater guarantees a fresh queue on
        // rapid toggles, but React may double-invoke updaters in StrictMode,
        // which can double-emit. Candidate for a rework.
        socketRef.current?.emit(SocketEvents.UPDATE_QUEUE, {
          leagueId,
          teamId: queueTeamId,
          playerIds: updatedQueue.map((p) => p.id),
        });

        return {
          ...prev,
          teamQueues: {
            ...prev.teamQueues,
            [queueTeamId]: updatedQueue,
          },
        };
      });
    },
    [leagueId]
  );

  const updateTeamName = useCallback(
    (renamedTeamId: string, name: string) => {
      if (!socketRef.current) return;

      // OPTIMISTIC UPDATE
      setState((prev) => applyTeamRename(prev, renamedTeamId, name));

      socketRef.current.emit(SocketEvents.UPDATE_TEAM, { leagueId, teamId: renamedTeamId, name });
    },
    [leagueId]
  );

  // Stable identity so consumers can safely depend on `actions` in effects/memos
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const actions = useMemo(
    () => ({
      makePick,
      proposeTrade,
      acceptTrade,
      rejectTrade,
      cancelTrade,
      startDraft,
      pauseDraft,
      resumeDraft,
      resetDraft,
      forcePick,
      undoLastPick,
      editPick,
      updateOrder,
      updateQueue,
      toggleQueue,
      updateTeamName,
      clearError,
    }),
    [
      makePick,
      proposeTrade,
      acceptTrade,
      rejectTrade,
      cancelTrade,
      startDraft,
      pauseDraft,
      resumeDraft,
      resetDraft,
      forcePick,
      undoLastPick,
      editPick,
      updateOrder,
      updateQueue,
      toggleQueue,
      updateTeamName,
      clearError,
    ]
  );

  const disconnect = useCallback(() => {
    socketRef.current?.disconnect();
  }, []);

  const reconnect = useCallback(() => {
    socketRef.current?.connect();
  }, []);

  return {
    state,
    timerSeconds,
    isMyTurn,
    myTeam,
    actions,
    disconnect,
    reconnect,
  };
}

export default useDraftSocket;
