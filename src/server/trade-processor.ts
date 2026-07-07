// Trade Processor
// Handles atomic trade creation, acceptance, and asset swapping

import type { Prisma, PrismaClient, TradeAsset, TradeAssetType } from '@prisma/client';
import type {
  TradeAssetPayload,
  TeamSummary,
  DraftPickSummary,
  TradeOfferedPayload,
} from '@/types/socket';
import { toTeamSummary, toTradeAssetPayload } from './mappers';

// ============================================================================
// TYPES
// ============================================================================

// Asset reference as sent by clients when proposing a trade
interface AssetInput {
  assetType: string;
  id: string;
}

interface CreateTradeInput {
  leagueId: string;
  initiatorTeamId: string;
  receiverTeamId: string;
  initiatorAssets: AssetInput[];
  receiverAssets: AssetInput[];
  expiresAt?: Date;
}

interface TradeResult {
  tradeId: string;
  initiatorTeam: TeamSummary;
  receiverTeam: TeamSummary;
  initiatorAssets: TradeAssetPayload[];
  receiverAssets: TradeAssetPayload[];
  updatedPicks?: DraftPickSummary[];
}

const TRADE_INCLUDE = {
  initiatorTeam: { include: { owner: { select: { name: true } } } },
  receiverTeam: { include: { owner: { select: { name: true } } } },
  assets: {
    include: {
      draftPick: true,
      player: true,
    },
  },
} satisfies Prisma.TradeInclude;

type TradeWithDetails = Prisma.TradeGetPayload<{ include: typeof TRADE_INCLUDE }>;

const DEFAULT_TRADE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================================
// HELPERS
// ============================================================================

const VALID_ASSET_TYPES: readonly TradeAssetType[] = ['DRAFT_PICK', 'PLAYER', 'FUTURE_PICK'];

function toTradeAssetType(type: string): TradeAssetType {
  if ((VALID_ASSET_TYPES as readonly string[]).includes(type)) {
    return type as TradeAssetType;
  }
  throw new Error(`Invalid asset type: ${type}`);
}

// Future picks have no DraftPick row yet, so clients reference them with a
// composite ID: "FUTURE_PICK:originalOwnerId:season:round"
function parseFutureAssetId(id: string): {
  originalOwnerId: string | undefined;
  season: number;
  round: number;
} {
  const parts = id.split(':');
  return {
    originalOwnerId: parts[1],
    season: parseInt(parts[2] || '0'),
    round: parseInt(parts[3] || '0'),
  };
}

function buildAssetCreateInput(
  asset: AssetInput,
  fromTeamId: string
): Prisma.TradeAssetUncheckedCreateWithoutTradeInput {
  const base = {
    fromTeamId,
    assetType: toTradeAssetType(asset.assetType),
  };

  switch (asset.assetType) {
    case 'DRAFT_PICK':
      return { ...base, draftPickId: asset.id };
    case 'PLAYER':
      return { ...base, playerId: asset.id };
    case 'FUTURE_PICK': {
      const { season, round } = parseFutureAssetId(asset.id);
      return { ...base, futurePickSeason: season, futurePickRound: round };
    }
    default:
      return base;
  }
}

export class TradeProcessor {
  constructor(private readonly prisma: PrismaClient) {}

  // ===========================================================================
  // CREATE TRADE
  // ===========================================================================

  async createTrade(input: CreateTradeInput): Promise<TradeOfferedPayload> {
    const {
      leagueId,
      initiatorTeamId,
      receiverTeamId,
      initiatorAssets,
      receiverAssets,
      expiresAt,
    } = input;

    // Validate teams exist in the league
    const [initiatorTeam, receiverTeam] = await Promise.all([
      this.prisma.team.findFirst({
        where: { id: initiatorTeamId, leagueId },
        include: { owner: { select: { name: true } } },
      }),
      this.prisma.team.findFirst({
        where: { id: receiverTeamId, leagueId },
        include: { owner: { select: { name: true } } },
      }),
    ]);

    if (!initiatorTeam || !receiverTeam) {
      throw new Error('Invalid teams for trade');
    }

    await this.validateAssets(leagueId, initiatorTeamId, initiatorAssets);
    await this.validateAssets(leagueId, receiverTeamId, receiverAssets);

    const trade = await this.prisma.trade.create({
      data: {
        leagueId,
        initiatorTeamId,
        receiverTeamId,
        status: 'PENDING',
        expiresAt: expiresAt || new Date(Date.now() + DEFAULT_TRADE_TTL_MS),
        assets: {
          create: [
            ...initiatorAssets.map((asset) => buildAssetCreateInput(asset, initiatorTeamId)),
            ...receiverAssets.map((asset) => buildAssetCreateInput(asset, receiverTeamId)),
          ],
        },
      },
      include: {
        assets: {
          include: {
            draftPick: true,
            player: true,
          },
        },
      },
    });

    return {
      leagueId,
      tradeId: trade.id,
      initiatorTeam: toTeamSummary(initiatorTeam),
      receiverTeam: toTeamSummary(receiverTeam),
      initiatorAssets: trade.assets
        .filter((a) => a.fromTeamId === initiatorTeamId)
        .map((a) => toTradeAssetPayload(a, initiatorTeam.name)),
      receiverAssets: trade.assets
        .filter((a) => a.fromTeamId === receiverTeamId)
        .map((a) => toTradeAssetPayload(a, receiverTeam.name)),
      expiresAt: trade.expiresAt?.toISOString(),
      timestamp: trade.proposedAt.toISOString(),
    };
  }

  // ===========================================================================
  // ACCEPT TRADE - ATOMIC ASSET SWAP
  // ===========================================================================

  async acceptTrade(tradeId: string, forcedByCommissioner: boolean = false): Promise<TradeResult> {
    const trade = await this.prisma.trade.findUnique({
      where: { id: tradeId },
      include: TRADE_INCLUDE,
    });

    if (!trade) {
      throw new Error('Trade not found');
    }

    if (trade.status !== 'PENDING') {
      throw new Error(`Trade cannot be accepted - status is ${trade.status}`);
    }

    if (trade.expiresAt && trade.expiresAt < new Date()) {
      await this.prisma.trade.update({
        where: { id: tradeId },
        data: { status: 'CANCELLED' },
      });
      throw new Error('Trade has expired');
    }

    // Re-validate assets before swap (assets might have changed)
    const initiatorAssets = trade.assets.filter((a) => a.fromTeamId === trade.initiatorTeamId);
    const receiverAssets = trade.assets.filter((a) => a.fromTeamId === trade.receiverTeamId);

    await this.validateAssetsForSwap(trade.leagueId, trade.initiatorTeamId, initiatorAssets);
    await this.validateAssetsForSwap(trade.leagueId, trade.receiverTeamId, receiverAssets);

    // Perform atomic swap in transaction
    const updatedPicks: DraftPickSummary[] = [];

    await this.prisma.$transaction(async (tx) => {
      await tx.trade.update({
        where: { id: tradeId },
        data: {
          status: 'PROCESSING',
          respondedAt: new Date(),
        },
      });

      // The counterparty receives each asset
      const recipientOf = (asset: TradeAsset): string =>
        asset.fromTeamId === trade.initiatorTeamId ? trade.receiverTeamId : trade.initiatorTeamId;

      // Swap draft picks
      for (const asset of trade.assets) {
        if (asset.assetType === 'DRAFT_PICK' && asset.draftPickId) {
          const updatedPick = await tx.draftPick.update({
            where: { id: asset.draftPickId },
            data: { currentOwnerId: recipientOf(asset) },
            include: {
              currentOwner: { include: { owner: { select: { name: true } } } },
            },
          });
          updatedPicks.push(toDraftPickSummary(updatedPick));
        } else if (
          asset.assetType === 'FUTURE_PICK' &&
          asset.futurePickSeason &&
          asset.futurePickRound
        ) {
          const pick = await this.transferFuturePick(tx, trade, asset, recipientOf(asset));
          updatedPicks.push(toDraftPickSummary(pick));
        }
      }

      // Swap players
      for (const asset of trade.assets) {
        if (asset.assetType === 'PLAYER' && asset.playerId) {
          await tx.playerRoster.updateMany({
            where: {
              teamId: asset.fromTeamId,
              playerId: asset.playerId,
              leagueId: trade.leagueId,
            },
            data: {
              teamId: recipientOf(asset),
              acquiredVia: 'TRADED',
              acquiredAt: new Date(),
              // Note: isKeeper status is preserved
            },
          });
        }
      }

      await tx.trade.update({
        where: { id: tradeId },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          forcedByCommissioner,
        },
      });
    });

    return {
      tradeId,
      initiatorTeam: toTeamSummary(trade.initiatorTeam),
      receiverTeam: toTeamSummary(trade.receiverTeam),
      initiatorAssets: initiatorAssets.map((a) => toTradeAssetPayload(a, trade.initiatorTeam.name)),
      receiverAssets: receiverAssets.map((a) => toTradeAssetPayload(a, trade.receiverTeam.name)),
      updatedPicks: updatedPicks.length > 0 ? updatedPicks : undefined,
    };
  }

  // Future picks may not have a DraftPick row yet: update the existing row if
  // the sender owns one, otherwise materialize it with the sender as original owner.
  private async transferFuturePick(
    tx: Prisma.TransactionClient,
    trade: TradeWithDetails,
    asset: TradeAsset,
    newOwnerId: string
  ) {
    const ownerInclude = {
      currentOwner: { include: { owner: { select: { name: true } } } },
    } as const;

    const existingPick = await tx.draftPick.findFirst({
      where: {
        leagueId: trade.leagueId,
        season: asset.futurePickSeason!,
        round: asset.futurePickRound!,
        currentOwnerId: asset.fromTeamId,
        isComplete: false,
      },
      include: ownerInclude,
    });

    if (existingPick) {
      return tx.draftPick.update({
        where: { id: existingPick.id },
        data: { currentOwnerId: newOwnerId },
        include: ownerInclude,
      });
    }

    return tx.draftPick.create({
      data: {
        leagueId: trade.leagueId,
        season: asset.futurePickSeason!,
        round: asset.futurePickRound!,
        originalOwnerId: asset.fromTeamId,
        currentOwnerId: newOwnerId,
      },
      include: ownerInclude,
    });
  }

  // ===========================================================================
  // REJECT TRADE
  // ===========================================================================

  async rejectTrade(tradeId: string, rejectedByUserId: string): Promise<void> {
    const trade = await this.prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        receiverTeam: true,
      },
    });

    if (!trade) {
      throw new Error('Trade not found');
    }

    if (trade.status !== 'PENDING') {
      throw new Error(`Trade cannot be rejected - status is ${trade.status}`);
    }

    if (trade.receiverTeam.ownerId !== rejectedByUserId) {
      await this.requireCommissioner(trade.leagueId, rejectedByUserId, 'reject');
    }

    await this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        status: 'REJECTED',
        respondedAt: new Date(),
      },
    });
  }

  // ===========================================================================
  // CANCEL TRADE
  // ===========================================================================

  async cancelTrade(tradeId: string, cancelledByUserId: string): Promise<void> {
    const trade = await this.prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        initiatorTeam: true,
      },
    });

    if (!trade) {
      throw new Error('Trade not found');
    }

    if (trade.status !== 'PENDING') {
      throw new Error(`Trade cannot be cancelled - status is ${trade.status}`);
    }

    if (trade.initiatorTeam.ownerId !== cancelledByUserId) {
      await this.requireCommissioner(trade.leagueId, cancelledByUserId, 'cancel');
    }

    await this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        status: 'CANCELLED',
        respondedAt: new Date(),
      },
    });
  }

  // ===========================================================================
  // COMMISSIONER FORCE TRADE
  // ===========================================================================

  async forceTrade(
    tradeId: string,
    commissionerUserId: string,
    notes?: string
  ): Promise<TradeResult> {
    const trade = await this.prisma.trade.findUnique({
      where: { id: tradeId },
    });

    if (!trade) {
      throw new Error('Trade not found');
    }

    const league = await this.prisma.league.findUnique({
      where: { id: trade.leagueId },
    });

    if (league?.commissionerId !== commissionerUserId) {
      throw new Error('Only the commissioner can force trades');
    }

    if (notes) {
      await this.prisma.trade.update({
        where: { id: tradeId },
        data: { commissionerNotes: notes },
      });
    }

    return this.acceptTrade(tradeId, true);
  }

  // ===========================================================================
  // VALIDATION HELPERS
  // ===========================================================================

  private async requireCommissioner(
    leagueId: string,
    userId: string,
    action: string
  ): Promise<void> {
    const league = await this.prisma.league.findUnique({
      where: { id: leagueId },
    });

    if (league?.commissionerId !== userId) {
      throw new Error(`Unauthorized to ${action} this trade`);
    }
  }

  // Validates client-proposed assets (referenced by entity/composite ID)
  private async validateAssets(
    leagueId: string,
    teamId: string,
    assets: AssetInput[]
  ): Promise<void> {
    for (const asset of assets) {
      if (asset.assetType === 'DRAFT_PICK') {
        const pick = await this.prisma.draftPick.findFirst({
          where: {
            id: asset.id,
            leagueId,
            currentOwnerId: teamId,
            isComplete: false,
          },
        });

        if (!pick) {
          throw new Error(`Team does not own draft pick ${asset.id} or pick has been used`);
        }
      } else if (asset.assetType === 'PLAYER') {
        const roster = await this.prisma.playerRoster.findFirst({
          where: {
            playerId: asset.id,
            teamId,
            leagueId,
          },
        });

        if (!roster) {
          throw new Error(`Team does not have player ${asset.id} on roster`);
        }
      } else if (asset.assetType === 'FUTURE_PICK') {
        if (asset.id.split(':').length < 4) continue;
        const { originalOwnerId, season, round } = parseFutureAssetId(asset.id);

        const pick = await this.prisma.draftPick.findFirst({
          where: {
            leagueId,
            season,
            round,
            originalOwnerId,
          },
        });

        // With no pick record, the future pick still belongs to its original owner
        const currentOwnerId = pick ? pick.currentOwnerId : originalOwnerId;
        if (currentOwnerId !== teamId) {
          throw new Error(`Team does not own future pick ${asset.id}`);
        }
      }
    }
  }

  // Re-validates persisted TradeAsset rows just before the swap
  private async validateAssetsForSwap(
    leagueId: string,
    teamId: string,
    assets: TradeAsset[]
  ): Promise<void> {
    for (const asset of assets) {
      if (asset.assetType === 'DRAFT_PICK' && asset.draftPickId) {
        const pick = await this.prisma.draftPick.findFirst({
          where: {
            id: asset.draftPickId,
            leagueId,
            currentOwnerId: teamId,
            isComplete: false,
          },
        });

        if (!pick) {
          throw new Error(`Draft pick ${asset.draftPickId} is no longer available for trade`);
        }
      } else if (asset.assetType === 'PLAYER' && asset.playerId) {
        const roster = await this.prisma.playerRoster.findFirst({
          where: {
            playerId: asset.playerId,
            teamId,
            leagueId,
          },
        });

        if (!roster) {
          throw new Error(`Player ${asset.playerId} is no longer on team roster`);
        }
      } else if (
        asset.assetType === 'FUTURE_PICK' &&
        asset.futurePickSeason &&
        asset.futurePickRound
      ) {
        const pick = await this.prisma.draftPick.findFirst({
          where: {
            leagueId,
            season: asset.futurePickSeason,
            round: asset.futurePickRound,
            originalOwnerId: asset.fromTeamId, // FUTURE_PICK in asset table tracks fromTeamId
          },
        });

        if (pick && pick.currentOwnerId !== teamId) {
          throw new Error(`Future pick is no longer owned by team`);
        }
        // If no record exists, the fromTeamId MUST be the original owner.
        // We can't verify "original owner" easily here without the full ID string,
        // but we already validated it when the trade was PROPOSED.
      }
    }
  }

  // ===========================================================================
  // QUERY METHODS
  // ===========================================================================

  async getPendingTradesForTeam(teamId: string): Promise<TradeWithDetails[]> {
    return this.prisma.trade.findMany({
      where: {
        OR: [{ initiatorTeamId: teamId }, { receiverTeamId: teamId }],
        status: 'PENDING',
      },
      include: TRADE_INCLUDE,
      orderBy: { proposedAt: 'desc' },
    });
  }

  async getTradeHistory(leagueId: string, limit: number = 50): Promise<TradeWithDetails[]> {
    return this.prisma.trade.findMany({
      where: {
        leagueId,
        status: { in: ['COMPLETED', 'REJECTED', 'CANCELLED', 'VETOED'] },
      },
      include: TRADE_INCLUDE,
      orderBy: { respondedAt: 'desc' },
      take: limit,
    });
  }
}

// ============================================================================
// LOCAL MAPPERS
// ============================================================================

interface PickWithOwnerName {
  id: string;
  season: number;
  round: number;
  pickInRound: number | null;
  overallPickNumber: number | null;
  currentOwnerId: string;
  originalOwnerId: string;
  isComplete: boolean;
  isKeeper: boolean;
  currentOwner: { owner: { name: string | null } | null };
}

function toDraftPickSummary(pick: PickWithOwnerName): DraftPickSummary {
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
  };
}
