// Socket.IO Event Types and Interfaces
// Centralized type definitions for real-time communication

import type { DraftStatus, TradeStatus, Position } from '@prisma/client';

// ============================================================================
// SOCKET EVENT NAMES
// ============================================================================

export const SocketEvents = {
  // Connection events
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  JOIN_DRAFT_ROOM: 'join_draft_room',
  LEAVE_DRAFT_ROOM: 'leave_draft_room',

  // Draft lifecycle events
  DRAFT_START: 'draft_start',
  DRAFT_PAUSE: 'draft_pause',
  DRAFT_RESUME: 'draft_resume',
  DRAFT_RESET: 'draft_reset',
  DRAFT_COMPLETE: 'draft_complete',

  // Timer events
  TIMER_TICK: 'timer_tick',
  TIMER_EXPIRED: 'timer_expired',

  // Pick events
  PICK_MADE: 'pick_made',
  PICK_UNDONE: 'pick_undone',
  ON_THE_CLOCK: 'on_the_clock',
  FORCE_PICK: 'force_pick',

  // Trade events
  TRADE_OFFERED: 'trade_offered',
  TRADE_ACCEPTED: 'trade_accepted',
  TRADE_REJECTED: 'trade_rejected',
  TRADE_CANCELLED: 'trade_cancelled',
  TRADE_PROCESSING: 'trade_processing',
  TRADE_COMPLETED: 'trade_completed',

  // Order/Settings events
  ORDER_UPDATED: 'order_updated',
  SETTINGS_UPDATED: 'settings_updated',

  // State sync events
  STATE_SYNC: 'state_sync',
  PLAYER_TAKEN: 'player_taken',

  // Queue events
  QUEUE_UPDATED: 'queue_updated',
  UPDATE_QUEUE: 'update_queue',

  // Error events
  ERROR: 'error',
} as const;

export type SocketEventName = typeof SocketEvents[keyof typeof SocketEvents];

// ============================================================================
// PAYLOAD TYPES
// ============================================================================

// Player summary for broadcasts
export interface PlayerSummary {
  id: string;
  sleeperId: string;
  fullName: string;
  position: Position;
  nflTeam: string | null;
  rank: number | null;
  adp?: number | null;
  bye?: number | null;
  injuryStatus?: string | null;
  keptByTeam?: string | null; // Team name if this player is kept
}

export interface RosterPlayer extends PlayerSummary {
  isKeeper: boolean;
  acquiredAt?: string;
  round?: number;
}

// Team summary for broadcasts
export interface TeamSummary {
  id: string;
  name: string;
  ownerId: string | null;
  ownerName: string;
  draftPosition: number;
}

// Draft pick summary
export interface DraftPickSummary {
  id: string;
  season: number;
  round: number;
  pickInRound: number;
  overallPickNumber: number;
  currentOwnerId: string;
  currentOwnerName: string;
  originalOwnerId: string;
  isComplete: boolean;
  selectedPlayer?: PlayerSummary;
  selectedAt?: string;
}

// Trade asset for broadcasts
export interface TradeAssetPayload {
  id: string;
  assetType: 'DRAFT_PICK' | 'PLAYER' | 'FUTURE_PICK';
  fromTeamId: string;
  fromTeamName: string;
  // For DRAFT_PICK
  draftPick?: {
    id: string;
    round: number;
    season: number;
    overallPickNumber?: number;
  };
  // For PLAYER
  player?: PlayerSummary;
  // For FUTURE_PICK
  futurePickSeason?: number;
  futurePickRound?: number;
}

// ============================================================================
// EVENT PAYLOADS
// ============================================================================

// Join/Leave room
export interface JoinDraftRoomPayload {
  leagueId: string;
  userId: string;
  teamId?: string;
}

// Draft start
export interface DraftStartPayload {
  leagueId: string;
  startedAt: string;
  currentPick: number;
  currentTeamId: string;
  currentTeam: TeamSummary;
  timerDuration: number;
  draftOrder: TeamSummary[];
}

// Timer tick
export interface TimerTickPayload {
  leagueId: string;
  secondsRemaining: number;
  currentPick: number;
  currentTeamId: string;
}

// Pick made
export interface PickMadePayload {
  leagueId: string;
  pick: DraftPickSummary;
  player: PlayerSummary;
  teamId: string;
  teamName: string;
  pickNumber: number;
  round: number;
  nextPick?: {
    pickNumber: number;
    round: number;
    teamId: string;
    team: TeamSummary;
  };
  teamRosterUpdates?: Record<string, RosterPlayer[]>;
  timestamp: string;
}

// Pick undone
export interface PickUndonePayload {
  leagueId: string;
  pickId: string;
  pickNumber: number;
  playerId: string;
  playerName: string;
  revertedToTeamId: string;
  teamRosterUpdates?: Record<string, RosterPlayer[]>;
  timestamp: string;
}

// On the clock
export interface OnTheClockPayload {
  leagueId: string;
  teamId: string;
  team: TeamSummary;
  pickNumber: number;
  round: number;
  timerDuration: number;
  timerStartedAt: string;
}

// Trade offered
export interface TradeOfferedPayload {
  leagueId: string;
  tradeId: string;
  initiatorTeam: TeamSummary;
  receiverTeam: TeamSummary;
  initiatorAssets: TradeAssetPayload[];
  receiverAssets: TradeAssetPayload[];
  expiresAt?: string;
  timestamp: string;
}

// Trade accepted
export interface TradeAcceptedPayload {
  leagueId: string;
  tradeId: string;
  initiatorTeam: TeamSummary;
  receiverTeam: TeamSummary;
  initiatorAssets: TradeAssetPayload[];
  receiverAssets: TradeAssetPayload[];
  // Updated draft order if picks were traded
  updatedDraftOrder?: DraftPickSummary[];
  teamRosterUpdates?: Record<string, RosterPlayer[]>;
  // If trade occurred while on the clock
  draftPaused: boolean;
  pauseReason?: string;
  timestamp: string;
}

// Trade rejected/cancelled
export interface TradeRejectedPayload {
  leagueId: string;
  tradeId: string;
  rejectedBy: 'initiator' | 'receiver' | 'commissioner' | 'expired';
  timestamp: string;
}

// Order updated
export interface OrderUpdatedPayload {
  leagueId: string;
  newOrder: TeamSummary[];
  updatedBy: string;
  reason: 'commissioner_set' | 'trade' | 'randomized';
  timestamp: string;
}

// Draft paused/resumed
export interface DraftPausePayload {
  leagueId: string;
  isPaused: boolean;
  reason?: string;
  pausedBy?: string;
  timerSecondsRemaining: number;
  timestamp: string;
}

// Roster settings
export interface RosterSettings {
  qbCount: number;
  rbCount: number;
  wrCount: number;
  teCount: number;
  flexCount: number;
  superflexCount: number;
  kCount: number;
  defCount: number;
  benchCount: number;
}

// State sync (full state for reconnection)
export interface StateSyncPayload {
  leagueId: string;
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
  allPicks: DraftPickSummary[]; // Include all picks (for trade purposes)
  availablePlayers: PlayerSummary[];
  teamRosters: Record<string, RosterPlayer[]>; // Players owned by each team
  teamRosterUpdates?: Record<string, RosterPlayer[]>; // Optimization for trade/pick updates
  pendingTrades: TradeOfferedPayload[];
  totalRounds?: number;
  draftType?: 'SNAKE' | 'LINEAR';
  rosterSettings?: RosterSettings;
  teamQueues: Record<string, PlayerSummary[]>; // Players in each team's queue
  timestamp: string;
}

// Error payload
export interface ErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// CLIENT -> SERVER EVENTS
// ============================================================================

export interface ClientToServerEvents {
  [SocketEvents.JOIN_DRAFT_ROOM]: (payload: JoinDraftRoomPayload) => void;
  [SocketEvents.LEAVE_DRAFT_ROOM]: (payload: { leagueId: string }) => void;

  // Commissioner actions
  [SocketEvents.DRAFT_START]: (payload: { leagueId: string }) => void;
  [SocketEvents.DRAFT_PAUSE]: (payload: { leagueId: string; reason?: string }) => void;
  [SocketEvents.DRAFT_RESUME]: (payload: { leagueId: string }) => void;
  [SocketEvents.DRAFT_RESET]: (payload: { leagueId: string }) => void;
  [SocketEvents.FORCE_PICK]: (payload: { leagueId: string; playerId: string }) => void;
  [SocketEvents.PICK_UNDONE]: (payload: { leagueId: string }) => void;
  [SocketEvents.ORDER_UPDATED]: (payload: { leagueId: string; teamOrder: string[] }) => void;

  // User actions
  [SocketEvents.PICK_MADE]: (payload: { leagueId: string; playerId: string; teamId: string }) => void;
  [SocketEvents.TRADE_OFFERED]: (payload: {
    leagueId: string;
    receiverTeamId: string;
    initiatorAssets: { assetType: string; id: string }[];
    receiverAssets: { assetType: string; id: string }[];
  }) => void;
  [SocketEvents.TRADE_ACCEPTED]: (payload: { leagueId: string; tradeId: string }) => void;
  [SocketEvents.TRADE_REJECTED]: (payload: { leagueId: string; tradeId: string }) => void;
  [SocketEvents.TRADE_CANCELLED]: (payload: { leagueId: string; tradeId: string }) => void;
  [SocketEvents.UPDATE_QUEUE]: (payload: { leagueId: string; teamId: string; playerIds: string[] }) => void;
}

// ============================================================================
// SERVER -> CLIENT EVENTS
// ============================================================================

export interface ServerToClientEvents {
  [SocketEvents.STATE_SYNC]: (payload: StateSyncPayload) => void;
  [SocketEvents.DRAFT_START]: (payload: DraftStartPayload) => void;
  [SocketEvents.DRAFT_PAUSE]: (payload: DraftPausePayload) => void;
  [SocketEvents.DRAFT_RESUME]: (payload: DraftPausePayload) => void;
  [SocketEvents.DRAFT_RESET]: (payload: StateSyncPayload) => void;
  [SocketEvents.DRAFT_COMPLETE]: (payload: { leagueId: string; completedAt: string }) => void;
  [SocketEvents.TIMER_TICK]: (payload: TimerTickPayload) => void;
  [SocketEvents.TIMER_EXPIRED]: (payload: { leagueId: string; teamId: string; pickNumber: number }) => void;
  [SocketEvents.PICK_MADE]: (payload: PickMadePayload) => void;
  [SocketEvents.PICK_UNDONE]: (payload: PickUndonePayload) => void;
  [SocketEvents.ON_THE_CLOCK]: (payload: OnTheClockPayload) => void;
  [SocketEvents.PLAYER_TAKEN]: (payload: { leagueId: string; playerId: string; teamId: string }) => void;
  [SocketEvents.TRADE_OFFERED]: (payload: TradeOfferedPayload) => void;
  [SocketEvents.TRADE_ACCEPTED]: (payload: TradeAcceptedPayload) => void;
  [SocketEvents.TRADE_REJECTED]: (payload: TradeRejectedPayload) => void;
  [SocketEvents.TRADE_CANCELLED]: (payload: TradeRejectedPayload) => void;
  [SocketEvents.TRADE_PROCESSING]: (payload: { leagueId: string; tradeId: string }) => void;
  [SocketEvents.TRADE_COMPLETED]: (payload: TradeAcceptedPayload) => void;
  [SocketEvents.ORDER_UPDATED]: (payload: OrderUpdatedPayload) => void;
  [SocketEvents.SETTINGS_UPDATED]: (payload: { leagueId: string; settings: Record<string, unknown> }) => void;
  [SocketEvents.QUEUE_UPDATED]: (payload: { leagueId: string; teamId: string; queue: PlayerSummary[] }) => void;
  [SocketEvents.ERROR]: (payload: ErrorPayload) => void;
}

// ============================================================================
// INTER-SERVER EVENTS (for scaling)
// ============================================================================

export interface InterServerEvents {
  ping: () => void;
}

// ============================================================================
// SOCKET DATA (per-connection data)
// ============================================================================

export interface SocketData {
  userId: string;
  teamId?: string;
  leagueId?: string;
  isCommissioner: boolean;
}
