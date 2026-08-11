// Trade Block 2.0 — Type Definitions

import type { TradeIntent, TradeBlockPhase } from '@prisma/client';

export type TradeIntentType = TradeIntent;
export type TradeBlockPhaseType = TradeBlockPhase;

export interface TradeBlockPlayerData {
  id: string;
  teamId: string;
  leagueId: string;
  playerId: string | null;
  draftCost: number | null;
  askingPrice: string | null;
  phase: TradeBlockPhase;
  createdAt: string;
  updatedAt: string;
  player: {
    id: string;
    fullName: string;
    position: string;
    nflTeam: string | null;
    rank: number | null;
    adp: number | null;
    avatarUrl: string | null;
    isKeeper?: boolean; // Added for roster views
  } | null;
  team: {
    id: string;
    name: string;
    tradeIntent: TradeIntent;
    owner: {
      name: string | null;
    } | null;
  };
}

export interface GeneralRosterPlayer {
  id: string; // player ID
  entryId: string; // roster entry ID
  fullName: string;
  position: string;
  nflTeam: string | null;
  rank: number | null;
  isKeeper: boolean;
  isOnBlock: boolean;
  draftCost: number | null;
  teamId: string;
  teamName: string;
}
