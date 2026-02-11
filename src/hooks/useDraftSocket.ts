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
  lastUpdate: null,
  error: null,
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

    // Timer tick
    socket.on(SocketEvents.TIMER_TICK, (payload: TimerTickPayload) => {
      setState((prev) => ({
        ...prev,
        timerSecondsRemaining: payload.secondsRemaining,
      }));
    });

    // Pick made
    socket.on(SocketEvents.PICK_MADE, (payload: PickMadePayload) => {
      setState((prev) => {
        const newCompletedPicks = [...prev.completedPicks, payload.pick];
        const newAvailablePlayers = prev.availablePlayers.filter(
          (p) => p.id !== payload.player.id
        );

        return {
          ...prev,
          completedPicks: newCompletedPicks,
          availablePlayers: newAvailablePlayers,
          currentPick: payload.nextPick?.pickNumber || prev.currentPick,
          currentRound: payload.nextPick?.round || prev.currentRound,
          currentTeamId: payload.nextPick?.teamId || null,
          currentTeam: payload.nextPick?.team || null,
          teamRosters: payload.teamRosterUpdates
            ? { ...prev.teamRosters, ...payload.teamRosterUpdates }
            : prev.teamRosters,
          allPicks: (() => {
            const pickMap = new Map(prev.allPicks.map((p) => [p.id, p]));
            pickMap.set(payload.pick.id, payload.pick);
            return Array.from(pickMap.values()).sort((a, b) => {
              if (a.season !== b.season) return a.season - b.season;
              return a.overallPickNumber - b.overallPickNumber;
            });
          })(),
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

    // Player taken (backup event)
    socket.on(SocketEvents.PLAYER_TAKEN, (payload) => {
      setState((prev) => ({
        ...prev,
        availablePlayers: prev.availablePlayers.filter(
          (p) => p.id !== payload.playerId
        ),
      }));
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
      socketRef.current.emit(SocketEvents.TRADE_ACCEPTED, { leagueId, tradeId });
    }, [leagueId]),

    rejectTrade: useCallback((tradeId: string) => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.TRADE_REJECTED, { leagueId, tradeId });
    }, [leagueId]),

    cancelTrade: useCallback((tradeId: string) => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.TRADE_CANCELLED, { leagueId, tradeId });
    }, [leagueId]),

    // Commissioner actions
    startDraft: useCallback(() => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.DRAFT_START, { leagueId });
    }, [leagueId]),

    pauseDraft: useCallback((reason?: string) => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.DRAFT_PAUSE, { leagueId, reason });
    }, [leagueId]),

    resumeDraft: useCallback(() => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.DRAFT_RESUME, { leagueId });
    }, [leagueId]),

    resetDraft: useCallback(() => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.DRAFT_RESET, { leagueId });
    }, [leagueId]),

    forcePick: useCallback((playerId: string) => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.FORCE_PICK, { leagueId, playerId });
    }, [leagueId]),

    undoLastPick: useCallback(() => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.PICK_UNDONE, { leagueId });
    }, [leagueId]),

    updateOrder: useCallback((teamOrder: string[]) => {
      if (!socketRef.current) return;
      socketRef.current.emit(SocketEvents.ORDER_UPDATED, { leagueId, teamOrder });
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
    isMyTurn,
    myTeam,
    actions,
    disconnect,
    reconnect,
  };
}

export default useDraftSocket;
