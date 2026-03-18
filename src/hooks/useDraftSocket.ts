// Draft Socket Hook
// Manages real-time connection to the draft server

'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  StateSyncPayload,
  PickMadePayload,
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
  DraftPickSummary,
  ErrorPayload,
} from '@/types/socket';
import { SocketEvents } from '@/types/socket';

// ============================================================================
// TYPES
// ============================================================================

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface DraftState {
  isConnected: boolean;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
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
  availablePlayers: PlayerSummary[];
  teamRosters: Record<string, RosterPlayer[]>;
  pendingTrades: TradeOfferedPayload[];
  totalRounds: number;
  draftType: 'SNAKE' | 'LINEAR';
  teamQueues: Record<string, PlayerSummary[]>;
  rosterSettings?: {
    qbCount: number;
    rbCount: number;
    wrCount: number;
    teCount: number;
    flexCount: number;
    superflexCount: number;
    kCount: number;
    defCount: number;
    benchCount: number;
  };
  lastUpdate: Date | null;
  error: ErrorPayload | null;
  pendingPickId: string | null;
}

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
      myAssets: { assetType: string; id: string }[],
      theirAssets: { assetType: string; id: string }[]
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
    updateOrder: (teamOrder: string[]) => void;
    updateQueue: (teamId: string, playerIds: string[]) => void;
    toggleQueue: (teamId: string, playerId: string) => void;
    updateTeamName: (teamId: string, name: string) => void;
  };
  disconnect: () => void;
  reconnect: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

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
  availablePlayers: [],
  teamRosters: {},
  pendingTrades: [],
  totalRounds: 14,
  draftType: 'SNAKE',
  teamQueues: {},
  lastUpdate: null,
  error: null,
  pendingPickId: null,
};

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

  // Get my team from draft order
  const myTeam = state.draftOrder.find((t) => t.id === teamId) || null;

  // Check if it's my turn
  const isMyTurn = state.status === 'IN_PROGRESS' &&
    !state.isPaused &&
    state.currentTeamId === teamId;

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

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    console.log('Connecting to socket...', socketUrl);

    const socket: TypedSocket = io(socketUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log('Socket connected');
      setState((prev) => ({ ...prev, isConnected: true, error: null }));

      // Join the draft room
      socket.emit(SocketEvents.JOIN_DRAFT_ROOM, {
        leagueId,
        userId,
        teamId,
      });
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
        error: { code: 'CONN_ERROR', message: error.message }
      }));
    });

    // State sync (initial load and reconnection)
    socket.on(SocketEvents.STATE_SYNC, (payload: StateSyncPayload) => {
      console.log('[CLIENT DEBUG] STATE_SYNC received:', {
        availablePlayers: payload.availablePlayers?.length,
        draftOrder: payload.draftOrder?.length,
        status: payload.status,
      });
      setState((prev) => ({
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
        availablePlayers: payload.availablePlayers,
        teamRosters: payload.teamRosters,
        pendingTrades: payload.pendingTrades,
        totalRounds: payload.totalRounds || 14,
        draftType: payload.draftType || 'SNAKE',
        rosterSettings: payload.rosterSettings,
        teamQueues: payload.teamQueues || {},
        lastUpdate: new Date(),
      }));
    });

    // Draft start
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

    // Draft pause/resume
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

    // Draft complete
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

    // Pick made — reconcile with any optimistic state
    socket.on(SocketEvents.PICK_MADE, (payload: PickMadePayload) => {
      setState((prev) => {
        // Filter out any optimistic pick matching this pick number to avoid duplicates
        const newCompletedPicks = [
          ...prev.completedPicks.filter(p => p.overallPickNumber !== payload.pickNumber),
          payload.pick
        ];

        // Remove player (may already be removed by optimistic update)
        const newAvailablePlayers = prev.availablePlayers.filter(
          (p) => p.id !== payload.player.id
        );

        // Update allPicks by replacing the pick at this overall pick number
        // This ensures the official server pick replaces our optimistic "opt-..." pick
        const updatedAllPicks = prev.allPicks.map(p => 
          p.overallPickNumber === payload.pickNumber ? payload.pick : p
        );

        return {
          ...prev,
          completedPicks: newCompletedPicks,
          availablePlayers: newAvailablePlayers,
          allPicks: updatedAllPicks,
          currentPick: payload.nextPick?.pickNumber || prev.currentPick,
          currentRound: payload.nextPick?.round || prev.currentRound,
          currentTeamId: payload.nextPick?.teamId || null,
          currentTeam: payload.nextPick?.team || null,
          teamRosters: payload.teamRosterUpdates
            ? { ...prev.teamRosters, ...payload.teamRosterUpdates }
            : prev.teamRosters,
          pendingPickId: null, // Clear optimistic flag
          lastUpdate: new Date(),
        };
      });
      callbacks.current.onPickMade?.(payload);
    });

    // On the clock
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

    // Pick undone
    socket.on(SocketEvents.PICK_UNDONE, (payload) => {
      setState((prev) => {
        const newCompletedPicks = prev.completedPicks.filter(
          (p) => p.id !== payload.pickId
        );
        return {
          ...prev,
          completedPicks: newCompletedPicks,
          currentPick: payload.pickNumber,
          currentTeamId: payload.revertedToTeamId,
          teamRosters: payload.teamRosterUpdates
            ? { ...prev.teamRosters, ...payload.teamRosterUpdates }
            : prev.teamRosters,
          allPicks: prev.allPicks.map((p) =>
            p.id === payload.pickId ? { ...p, isComplete: false, selectedPlayer: undefined, selectedAt: undefined } : p
          ),
          lastUpdate: new Date(),
        };
      });
    });

    // Player taken (backup event) — ensure player is removed from available pool AND all queues
    socket.on(SocketEvents.PLAYER_TAKEN, (payload) => {
      // Guard against potential undefined payload issues
      if (!payload?.playerId) return;

      setState((prev) => {
        // Clean up all team queues to remove the now-unavailable player
        const updatedQueues = { ...prev.teamQueues };
        Object.keys(updatedQueues).forEach((teamId) => {
          updatedQueues[teamId] = (updatedQueues[teamId] || []).filter(
            (p) => p.id !== payload.playerId
          );
        });

        return {
          ...prev,
          availablePlayers: prev.availablePlayers.filter(
            (p) => p.id !== payload.playerId
          ),
          teamQueues: updatedQueues,
        };
      });
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
      setState((prev) => ({
        ...prev,
        pendingTrades: prev.pendingTrades.filter((t) => t.tradeId !== payload.tradeId),
        isPaused: payload.draftPaused ? true : prev.isPaused,
        pauseReason: payload.pauseReason || prev.pauseReason,
        teamRosters: payload.teamRosterUpdates
          ? { ...prev.teamRosters, ...payload.teamRosterUpdates }
          : prev.teamRosters,
        allPicks: payload.updatedDraftOrder
          ? (() => {
            const pickMap = new Map(prev.allPicks.map((p) => [p.id, p]));
            payload.updatedDraftOrder.forEach((updated) => {
              const existing = pickMap.get(updated.id);
              pickMap.set(updated.id, existing ? { ...existing, ...updated } : updated);
            });
            return Array.from(pickMap.values()).sort((a, b) => {
              if (a.season !== b.season) return a.season - b.season;
              return a.overallPickNumber - b.overallPickNumber;
            });
          })()
          : prev.allPicks,
        lastUpdate: new Date(),
      }));
      callbacks.current.onTradeAccepted?.(payload);
    });

    socket.on(SocketEvents.DRAFT_RESET, (payload: StateSyncPayload) => {
      setState((prev) => ({
        ...prev,
        ...payload,
        lastUpdate: new Date(),
      }));
    });

    socket.on(SocketEvents.TRADE_REJECTED, (payload) => {
      setState((prev) => ({
        ...prev,
        pendingTrades: prev.pendingTrades.filter((t) => t.tradeId !== payload.tradeId),
        lastUpdate: new Date(),
      }));
    });

    socket.on(SocketEvents.TRADE_CANCELLED, (payload) => {
      setState((prev) => ({
        ...prev,
        pendingTrades: prev.pendingTrades.filter((t) => t.tradeId !== payload.tradeId),
        lastUpdate: new Date(),
      }));
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
      setState((prev) => {
        const { teamId, name } = payload;
        
        // Update draftOrder
        const updatedOrder = prev.draftOrder.map(t => 
          t.id === teamId ? { ...t, name } : t
        );

        // Update currentTeam if it matches
        const updatedCurrentTeam = prev.currentTeam?.id === teamId 
          ? { ...prev.currentTeam, name } 
          : prev.currentTeam;

        // Update allPicks (currentOwnerName)
        const updatedAllPicks = prev.allPicks.map(p => 
          p.currentOwnerId === teamId ? { ...p, currentOwnerName: name } : p
        );

        // Update completedPicks
        const updatedCompletedPicks = prev.completedPicks.map(p => 
          p.currentOwnerId === teamId ? { ...p, currentOwnerName: name } : p
        );

        return {
          ...prev,
          draftOrder: updatedOrder,
          currentTeam: updatedCurrentTeam,
          allPicks: updatedAllPicks,
          completedPicks: updatedCompletedPicks,
          lastUpdate: new Date(),
        };
      });
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

  const actions = {
    makePick: useCallback((playerId: string) => {
      if (!socketRef.current || !teamId) return;

      setState((prev) => {
        // Find the player details for the optimistic update
        const player = prev.availablePlayers.find((p) => p.id === playerId);
        if (!player) return prev;

        // 1. Construct optimistic pick for the Draft Board
        const optimisticPick: DraftPickSummary = {
          id: `opt-${Date.now()}`,
          season: new Date().getFullYear(),
          round: prev.currentRound,
          pickInRound: 0, // Approximate
          overallPickNumber: prev.currentPick,
          currentOwnerId: teamId,
          currentOwnerName: prev.currentTeam?.name || 'Me',
          originalOwnerId: teamId,
          isComplete: true,
          isKeeper: false,
          selectedPlayer: player,
          selectedAt: new Date().toISOString(),
        };

        // 2. Add player to the team roster sidebar
        const newRosterPlayer: RosterPlayer = { ...player, isKeeper: false, round: prev.currentRound };
        const updatedRosters = {
          ...prev.teamRosters,
          [teamId]: [...(prev.teamRosters[teamId] || []), newRosterPlayer],
        };

        // 3. Update the allPicks list so the Draft Board fills in immediately
        const updatedAllPicks = prev.allPicks.map(p => 
          p.overallPickNumber === prev.currentPick ? optimisticPick : p
        );

        // 4. Update the queue
        const updatedQueues = {
          ...prev.teamQueues,
          [teamId]: (prev.teamQueues[teamId] || []).filter(p => p.id !== playerId)
        };

        return {
          ...prev,
          availablePlayers: prev.availablePlayers.filter((p) => p.id !== playerId),
          completedPicks: [...prev.completedPicks, optimisticPick],
          allPicks: updatedAllPicks,
          teamRosters: updatedRosters,
          teamQueues: updatedQueues,
          pendingPickId: playerId,
          currentTeamId: null, // Disable draft button until server confirms next team
          currentTeam: null,
          timerSecondsRemaining: null,
          lastUpdate: new Date(),
        };
      });

      socketRef.current.emit(SocketEvents.PICK_MADE, {
        leagueId,
        playerId,
        teamId,
      });
    }, [leagueId, teamId]),

    proposeTrade: useCallback((
      receiverTeamId: string,
      myAssets: { assetType: string; id: string }[],
      theirAssets: { assetType: string; id: string }[]
    ) => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.TRADE_OFFERED, {
        leagueId,
        receiverTeamId,
        initiatorAssets: myAssets,
        receiverAssets: theirAssets,
      });
    }, [leagueId]),

    acceptTrade: useCallback((tradeId: string) => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Move assets before server round-trip
      setState((prev) => {
        const trade = prev.pendingTrades.find((t) => t.tradeId === tradeId);
        if (!trade) return prev;

        const initiatorId = trade.initiatorTeam.id;
        const receiverId = trade.receiverTeam.id;

        // 1. Move Players between rosters
        const newRosters = { ...prev.teamRosters };
        const initiatorPlayers = [...(newRosters[initiatorId] || [])];
        const receiverPlayers = [...(newRosters[receiverId] || [])];

        trade.initiatorAssets.filter(a => a.assetType === 'PLAYER').forEach(a => {
          const playerIndex = initiatorPlayers.findIndex(p => p.id === a.player?.id);
          if (playerIndex !== -1) {
            const [p] = initiatorPlayers.splice(playerIndex, 1);
            receiverPlayers.push(p!);
          }
        });

        trade.receiverAssets.filter(a => a.assetType === 'PLAYER').forEach(a => {
          const playerIndex = receiverPlayers.findIndex(p => p.id === a.player?.id);
          if (playerIndex !== -1) {
            const [p] = receiverPlayers.splice(playerIndex, 1);
            initiatorPlayers.push(p!);
          }
        });

        newRosters[initiatorId] = initiatorPlayers;
        newRosters[receiverId] = receiverPlayers;

        // 2. Move Draft Picks in the allPicks board
        const initiatorGivesPicks = new Set(trade.initiatorAssets.filter(a => a.assetType === 'DRAFT_PICK').map(a => a.id));
        const receiverGivesPicks = new Set(trade.receiverAssets.filter(a => a.assetType === 'DRAFT_PICK').map(a => a.id));

        const updatedAllPicks = prev.allPicks.map(p => {
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
          teamRosters: newRosters,
          allPicks: updatedAllPicks,
          lastUpdate: new Date(),
        };
      });

      socketRef.current.emit(SocketEvents.TRADE_ACCEPTED, { leagueId, tradeId });
    }, [leagueId]),

    rejectTrade: useCallback((tradeId: string) => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Remove trade from list
      setState((prev) => ({
        ...prev,
        pendingTrades: prev.pendingTrades.filter((t) => t.tradeId !== tradeId),
        lastUpdate: new Date(),
      }));

      socketRef.current.emit(SocketEvents.TRADE_REJECTED, { leagueId, tradeId });
    }, [leagueId]),

    cancelTrade: useCallback((tradeId: string) => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Remove trade from list
      setState((prev) => ({
        ...prev,
        pendingTrades: prev.pendingTrades.filter((t) => t.tradeId !== tradeId),
        lastUpdate: new Date(),
      }));

      socketRef.current.emit(SocketEvents.TRADE_CANCELLED, { leagueId, tradeId });
    }, [leagueId]),

    // Commissioner actions
    startDraft: useCallback(() => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Change status
      setState((prev) => ({
        ...prev,
        status: 'IN_PROGRESS',
        lastUpdate: new Date(),
      }));

      socketRef.current.emit(SocketEvents.DRAFT_START, { leagueId });
    }, [leagueId]),

    pauseDraft: useCallback((reason?: string) => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Change status
      setState((prev) => ({
        ...prev,
        isPaused: true,
        pauseReason: reason || 'Paused by commissioner',
        lastUpdate: new Date(),
      }));

      socketRef.current.emit(SocketEvents.DRAFT_PAUSE, { leagueId, reason });
    }, [leagueId]),

    resumeDraft: useCallback(() => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Change status
      setState((prev) => ({
        ...prev,
        isPaused: false,
        pauseReason: null,
        lastUpdate: new Date(),
      }));

      socketRef.current.emit(SocketEvents.DRAFT_RESUME, { leagueId });
    }, [leagueId]),

    resetDraft: useCallback(() => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Wipe everything locally
      setState((prev) => ({
        ...initialState,
        isConnected: true,
        allPicks: prev.allPicks.map(p => ({ 
          ...p,
          isComplete: false,
          selectedPlayer: undefined,
          selectedAt: undefined
        })),
        draftOrder: prev.draftOrder,
        teamQueues: prev.teamQueues,
        lastUpdate: new Date(),
      }));

      socketRef.current.emit(SocketEvents.DRAFT_RESET, { leagueId });
    }, [leagueId]),

    forcePick: useCallback((playerId: string) => {
      if (!socketRef.current) return;
      const teamIdToDraft = state.currentTeamId;
      if (!teamIdToDraft) return;

      // OPTIMISTIC (matches makePick logic)
      setState((prev) => {
        const player = prev.availablePlayers.find((p) => p.id === playerId);
        if (!player) return prev;

        const optimisticPick: DraftPickSummary = {
          id: `opt-force-${Date.now()}`,
          season: new Date().getFullYear(),
          round: prev.currentRound,
          pickInRound: 0,
          overallPickNumber: prev.currentPick,
          currentOwnerId: teamIdToDraft,
          currentOwnerName: prev.currentTeam?.name || 'Forced',
          originalOwnerId: teamIdToDraft,
          isComplete: true,
          isKeeper: false,
          selectedPlayer: player,
          selectedAt: new Date().toISOString(),
        };

        const updatedRosters = {
          ...prev.teamRosters,
          [teamIdToDraft]: [...(prev.teamRosters[teamIdToDraft] || []), { ...player, isKeeper: false }],
        };

        return {
          ...prev,
          availablePlayers: prev.availablePlayers.filter((p) => p.id !== playerId),
          completedPicks: [...prev.completedPicks, optimisticPick],
          allPicks: prev.allPicks.map(p => p.overallPickNumber === prev.currentPick ? optimisticPick : p),
          teamRosters: updatedRosters,
          currentTeamId: null,
          lastUpdate: new Date(),
        };
      });

      socketRef.current.emit(SocketEvents.FORCE_PICK, { leagueId, playerId });
    }, [leagueId, state.currentTeamId]),

    undoLastPick: useCallback(() => {
      if (!socketRef.current) return;

      // OPTIMISTIC: Move board back one step
      setState((prev) => {
        const lastPick = prev.completedPicks[prev.completedPicks.length - 1];
        if (!lastPick || !lastPick.selectedPlayer) return prev;

        const player = lastPick.selectedPlayer;
        const teamIdUnderPick = lastPick.currentOwnerId;

        // Restore available player
        const newAvailable = [...prev.availablePlayers, player].sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

        // Remove from roster
        const updatedRosters = { ...prev.teamRosters };
        if (updatedRosters[teamIdUnderPick]) {
          updatedRosters[teamIdUnderPick] = (updatedRosters[teamIdUnderPick] || []).filter(p => p.id !== player.id);
        }

        // Clear pick on board
        const updatedAllPicks = prev.allPicks.map(p => 
          p.overallPickNumber === lastPick.overallPickNumber ? { ...p, isComplete: false, selectedPlayer: undefined, selectedAt: undefined } : p
        );

        return {
          ...prev,
          availablePlayers: newAvailable,
          completedPicks: prev.completedPicks.slice(0, -1),
          allPicks: updatedAllPicks,
          teamRosters: updatedRosters,
          currentPick: lastPick.overallPickNumber,
          currentRound: lastPick.round,
          currentTeamId: lastPick.currentOwnerId,
          lastUpdate: new Date(),
        };
      });

      socketRef.current.emit(SocketEvents.PICK_UNDONE, { leagueId });
    }, [leagueId]),

    updateOrder: useCallback((teamOrder: string[]) => {
      if (!socketRef.current) return;

      setState((prev) => {
        const newOrder = teamOrder.map((id, index) => {
          const team = prev.draftOrder.find(t => t.id === id);
          return team ? { ...team, draftPosition: index + 1 } : null;
        }).filter((t): t is TeamSummary => !!t);

        return { ...prev, draftOrder: newOrder, lastUpdate: new Date() };
      });

      socketRef.current.emit(SocketEvents.ORDER_UPDATED, { leagueId, teamOrder });
    }, [leagueId]),

    updateQueue: useCallback((teamId: string, playerIds: string[]) => {
      if (!socketRef.current) return;

      // Optimistic update to prevent race conditions during rapid clicks
      setState((prev) => {
        // Collect full player objects from available players or the current queue
        const currentQueue = prev.teamQueues[teamId] || [];
        const updatedQueue: PlayerSummary[] = playerIds.map(id => {
          return prev.availablePlayers.find(p => p.id === id) || 
                 currentQueue.find(p => p.id === id);
        }).filter((p): p is PlayerSummary => !!p);

        return {
          ...prev,
          teamQueues: {
            ...prev.teamQueues,
            [teamId]: updatedQueue
          }
        };
      });

      socketRef.current.emit(SocketEvents.UPDATE_QUEUE, { leagueId, teamId, playerIds });
    }, [leagueId]),

    toggleQueue: useCallback((teamId: string, playerId: string) => {
      if (!socketRef.current) return;

      setState((prev) => {
        const currentQueue = prev.teamQueues[teamId] || [];
        const isQueued = currentQueue.some((p) => p.id === playerId);
        let updatedQueue: PlayerSummary[];

        if (isQueued) {
          updatedQueue = currentQueue.filter((p) => p.id !== playerId);
        } else {
          // Find the player object to add - check pool, then all picks for keepers
          const player = prev.availablePlayers.find((p) => p.id === playerId) || 
                         prev.allPicks.find((p) => p.selectedPlayer?.id === playerId)?.selectedPlayer;
          
          if (!player) return prev;
          updatedQueue = [...currentQueue, player];
        }

        const playerIds = updatedQueue.map((p) => p.id);
        socketRef.current?.emit(SocketEvents.UPDATE_QUEUE, { leagueId, teamId, playerIds });

        return {
          ...prev,
          teamQueues: {
            ...prev.teamQueues,
            [teamId]: updatedQueue
          }
        };
      });
    }, [leagueId]),

    updateTeamName: useCallback((teamId: string, name: string) => {
      if (!socketRef.current) return;
      
      // OPTIMISTIC UPDATE
      setState((prev) => {
        const updatedOrder = prev.draftOrder.map(t => t.id === teamId ? { ...t, name } : t);
        const updatedCurrentTeam = prev.currentTeam?.id === teamId ? { ...prev.currentTeam, name } : prev.currentTeam;
        const updatedAllPicks = prev.allPicks.map(p => p.currentOwnerId === teamId ? { ...p, currentOwnerName: name } : p);
        const updatedCompletedPicks = prev.completedPicks.map(p => p.currentOwnerId === teamId ? { ...p, currentOwnerName: name } : p);
        
        return {
          ...prev,
          draftOrder: updatedOrder,
          currentTeam: updatedCurrentTeam,
          allPicks: updatedAllPicks,
          completedPicks: updatedCompletedPicks,
        };
      });

      socketRef.current.emit(SocketEvents.UPDATE_TEAM, { leagueId, teamId, name });
    }, [leagueId]),
  };

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  }, []);

  const reconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.connect();
    }
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
