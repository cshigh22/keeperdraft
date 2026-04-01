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

export interface RumorData {
  id: string;
  leagueId: string;
  content: string;
  source: string | null;
  isSystem: boolean;
  createdAt: string;
}



export interface ROIResult {
  label: string;
  description: string;
  percentage: number; // 0-100
  color: 'green' | 'yellow' | 'red';
}

/**
 * Calculate keeper value ROI.
 * Compares the round the player was drafted/acquired at (draftCost)
 * to their estimated production tier based on rank.
 */
export function calculateROI(
  draftCost: number | null,
  rank: number | null,
  totalRounds: number = 14,
  totalPlayers: number = 168 // 12 teams * 14 rounds
): ROIResult {
  if (draftCost === null || rank === null) {
    return {
      label: 'N/A',
      description: 'Insufficient data',
      percentage: 50,
      color: 'yellow',
    };
  }

  // Estimated production round: which round does their rank correspond to?
  const productionRound = Math.max(1, Math.ceil((rank / totalPlayers) * totalRounds));
  const costStr = getOrdinalRound(draftCost);
  const prodStr = getOrdinalRound(productionRound);

  // ROI: how much better they are than their cost
  // High ratio = great value (low cost, high production)
  const roiRatio = draftCost / productionRound;
  const percentage = Math.min(100, Math.max(5, roiRatio * 50));

  let color: 'green' | 'yellow' | 'red';
  if (roiRatio >= 2) color = 'green';
  else if (roiRatio >= 1) color = 'yellow';
  else color = 'red';

  return {
    label: `${costStr} Cost → ${prodStr} Production`,
    description:
      color === 'green'
        ? 'Excellent keeper value'
        : color === 'yellow'
          ? 'Fair keeper value'
          : 'Below expected value',
    percentage,
    color,
  };
}

function getOrdinalRound(round: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'] as const;
  const v = round % 100;
  const suffix = suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0] ?? 'th';
  return round + suffix + ' Rd';
}
