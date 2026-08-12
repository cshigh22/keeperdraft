// Shared DB-row → socket-payload mappers for the Socket.IO server processes
// (DraftStateManager, TradeProcessor).

import type { Player, TradeAssetType } from '@prisma/client';
import type { PlayerSummary, TeamSummary, TradeAssetPayload } from '@/types/socket';

// ============================================================================
// ROW SHAPES
// Structural types so any Prisma query result with these fields fits.
// ============================================================================

export interface TeamRecord {
  id: string;
  name: string;
  ownerId: string | null;
  draftPosition: number | null;
  owner: { name: string | null } | null;
}

export interface TradeAssetRecord {
  id: string;
  assetType: TradeAssetType;
  fromTeamId: string;
  futurePickSeason: number | null;
  futurePickRound: number | null;
  draftPick: {
    id: string;
    round: number;
    pickInRound: number | null;
    season: number;
    overallPickNumber: number | null;
  } | null;
  player: Player | null;
}

// ============================================================================
// MAPPERS
// ============================================================================

export function toPlayerSummary(player: Player): PlayerSummary {
  return {
    id: player.id,
    sleeperId: player.sleeperId,
    fullName: player.fullName,
    position: player.position,
    nflTeam: player.nflTeam,
    rank: player.rank,
    adp: player.adp,
    bye: player.byeWeek,
  };
}

export function toTeamSummary(team: TeamRecord): TeamSummary {
  return {
    id: team.id,
    name: team.name,
    ownerId: team.ownerId,
    ownerName: team.owner?.name || 'Open Slot',
    draftPosition: team.draftPosition || 0,
  };
}

export function toTradeAssetPayload(
  asset: TradeAssetRecord,
  fromTeamName: string
): TradeAssetPayload {
  return {
    id: asset.id,
    assetType: asset.assetType,
    fromTeamId: asset.fromTeamId,
    fromTeamName,
    draftPick: asset.draftPick
      ? {
          id: asset.draftPick.id,
          round: asset.draftPick.round,
          pickInRound: asset.draftPick.pickInRound ?? undefined,
          season: asset.draftPick.season,
          overallPickNumber: asset.draftPick.overallPickNumber ?? undefined,
        }
      : undefined,
    player: asset.player ? toPlayerSummary(asset.player) : undefined,
    futurePickSeason: asset.futurePickSeason ?? undefined,
    futurePickRound: asset.futurePickRound ?? undefined,
  };
}
