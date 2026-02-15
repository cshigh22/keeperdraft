// Trade Processor
// Handles atomic trade creation, acceptance, and asset swapping

import type { PrismaClient, TradeStatus, TradeAssetType } from '@prisma/client';
import type {
  TradeAssetPayload,
  TeamSummary,
  DraftPickSummary,
  TradeOfferedPayload,
} from '@/types/socket';

interface CreateTradeInput {
  leagueId: string;
  initiatorTeamId: string;
  receiverTeamId: string;
  initiatorAssets: { assetType: string; id: string }[];
  receiverAssets: { assetType: string; id: string }[];
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

export class TradeProcessor {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

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

    // Validate all assets
    await this.validateAssets(leagueId, initiatorTeamId, initiatorAssets);
    await this.validateAssets(leagueId, receiverTeamId, receiverAssets);

    // Create the trade with assets
    const trade = await this.prisma.trade.create({
      data: {
        leagueId,
        initiatorTeamId,
        receiverTeamId,
        status: 'PENDING',
        expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours default
        assets: {
          create: [
            ...initiatorAssets.map((asset) => {
              const isFuture = asset.assetType === 'FUTURE_PICK';
              let futureSeason: number | undefined;
              let futureRound: number | undefined;

              if (isFuture) {
                const parts = asset.id.split(':');
                futureSeason = parseInt(parts[2] || '0');
                futureRound = parseInt(parts[3] || '0');
              }

              return {
                fromTeamId: initiatorTeamId,
                assetType: this.mapAssetType(asset.assetType),
                ...(asset.assetType === 'DRAFT_PICK' && { draftPickId: asset.id }),
                ...(asset.assetType === 'PLAYER' && { playerId: asset.id }),
                ...(isFuture && {
                  futurePickSeason: futureSeason,
                  futurePickRound: futureRound,
                }),
              };
            }),
            ...receiverAssets.map((asset) => {
              const isFuture = asset.assetType === 'FUTURE_PICK';
              let futureSeason: number | undefined;
              let futureRound: number | undefined;

              if (isFuture) {
                const parts = asset.id.split(':');
                futureSeason = parseInt(parts[2] || '0');
                futureRound = parseInt(parts[3] || '0');
              }

              return {
                fromTeamId: receiverTeamId,
                assetType: this.mapAssetType(asset.assetType),
                ...(asset.assetType === 'DRAFT_PICK' && { draftPickId: asset.id }),
                ...(asset.assetType === 'PLAYER' && { playerId: asset.id }),
                ...(isFuture && {
                  futurePickSeason: futureSeason,
                  futurePickRound: futureRound,
                }),
              };
            }),
          ],
        },
      },
      include: {
        assets: {
          include: {
            draftPick: true,
            player: true,
            fromTeam: { include: { owner: { select: { name: true } } } },
          },
        },
      },
    });

    // Build response payload
    return {
      leagueId,
      tradeId: trade.id,
      initiatorTeam: {
        id: initiatorTeam.id,
        name: initiatorTeam.name,
        ownerId: initiatorTeam.ownerId,
        ownerName: initiatorTeam.owner?.name || 'Open Slot',
        draftPosition: initiatorTeam.draftPosition || 0,
      },
      receiverTeam: {
        id: receiverTeam.id,
        name: receiverTeam.name,
        ownerId: receiverTeam.ownerId,
        ownerName: receiverTeam.owner?.name || 'Open Slot',
        draftPosition: receiverTeam.draftPosition || 0,
      },
      initiatorAssets: trade.assets
        .filter((a) => a.fromTeamId === initiatorTeamId)
        .map((a) => this.mapTradeAsset(a)),
      receiverAssets: trade.assets
        .filter((a) => a.fromTeamId === receiverTeamId)
        .map((a) => this.mapTradeAsset(a)),
      expiresAt: trade.expiresAt?.toISOString(),
      timestamp: trade.proposedAt.toISOString(),
    };
  }

  // ===========================================================================
  // ACCEPT TRADE - ATOMIC ASSET SWAP
  // ===========================================================================

  async acceptTrade(tradeId: string, forcedByCommissioner: boolean = false): Promise<TradeResult> {
    // Get the trade with all details
    const trade = await this.prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        initiatorTeam: { include: { owner: { select: { name: true } } } },
        receiverTeam: { include: { owner: { select: { name: true } } } },
        assets: {
          include: {
            draftPick: true,
            player: true,
            fromTeam: { include: { owner: { select: { name: true } } } },
          },
        },
      },
    });

    if (!trade) {
      throw new Error('Trade not found');
    }

    if (trade.status !== 'PENDING') {
      throw new Error(`Trade cannot be accepted - status is ${trade.status}`);
    }

    // Check expiration
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
      // Update trade status to processing
      await tx.trade.update({
        where: { id: tradeId },
        data: {
          status: 'PROCESSING',
          respondedAt: new Date(),
        },
      });

      // Swap draft picks
      for (const asset of trade.assets) {
        if (asset.assetType === 'DRAFT_PICK' && asset.draftPickId) {
          const newOwnerId = asset.fromTeamId === trade.initiatorTeamId
            ? trade.receiverTeamId
            : trade.initiatorTeamId;

          const updatedPick = await tx.draftPick.update({
            where: { id: asset.draftPickId },
            data: { currentOwnerId: newOwnerId },
            include: {
              currentOwner: { include: { owner: { select: { name: true } } } },
            },
          });

          updatedPicks.push({
            id: updatedPick.id,
            season: updatedPick.season,
            round: updatedPick.round,
            pickInRound: updatedPick.pickInRound || 0,
            overallPickNumber: updatedPick.overallPickNumber || 0,
            currentOwnerId: updatedPick.currentOwnerId,
            currentOwnerName: updatedPick.currentOwner.owner?.name || 'Open Slot',
            originalOwnerId: updatedPick.originalOwnerId,
            isComplete: updatedPick.isComplete,
          });
        } else if (asset.assetType === 'FUTURE_PICK' && asset.futurePickSeason && asset.futurePickRound) {
          const newOwnerId = asset.fromTeamId === trade.initiatorTeamId
            ? trade.receiverTeamId
            : trade.initiatorTeamId;

          // For future picks, we MUST find the record by season, round, and the original owner.
          // Since we didn't store originalOwnerId in TradeAsset, we'll try to find any existing
          // incomplete pick record that matches.

          let pick = await tx.draftPick.findFirst({
            where: {
              leagueId: trade.leagueId,
              season: asset.futurePickSeason,
              round: asset.futurePickRound,
              // Check if fromTeamId is currently the owner
              currentOwnerId: asset.fromTeamId,
              isComplete: false,
            },
            include: {
              currentOwner: { include: { owner: { select: { name: true } } } },
            },
          });

          if (pick) {
            // Update existing record
            pick = await tx.draftPick.update({
              where: { id: pick.id },
              data: { currentOwnerId: newOwnerId },
              include: {
                currentOwner: { include: { owner: { select: { name: true } } } },
              },
            });
          } else {
            // Create new record (this assumes fromTeamId IS the original owner for virtual picks)
            pick = await tx.draftPick.create({
              data: {
                leagueId: trade.leagueId,
                season: asset.futurePickSeason,
                round: asset.futurePickRound,
                originalOwnerId: asset.fromTeamId,
                currentOwnerId: newOwnerId,
              },
              include: {
                currentOwner: { include: { owner: { select: { name: true } } } },
              },
            });
          }

          updatedPicks.push({
            id: pick.id,
            season: pick.season,
            round: pick.round,
            pickInRound: pick.pickInRound || 0,
            overallPickNumber: pick.overallPickNumber || 0,
            currentOwnerId: pick.currentOwnerId,
            currentOwnerName: pick.currentOwner.owner?.name || 'Open Slot',
            originalOwnerId: pick.originalOwnerId,
            isComplete: pick.isComplete,
          });
        }
      }

      // Swap players
      for (const asset of trade.assets) {
        if (asset.assetType === 'PLAYER' && asset.playerId) {
          const newTeamId = asset.fromTeamId === trade.initiatorTeamId
            ? trade.receiverTeamId
            : trade.initiatorTeamId;

          // Update the roster entry
          await tx.playerRoster.updateMany({
            where: {
              teamId: asset.fromTeamId,
              playerId: asset.playerId,
              leagueId: trade.leagueId,
            },
            data: {
              teamId: newTeamId,
              acquiredVia: 'TRADED',
              acquiredAt: new Date(),
              // Note: isKeeper status is preserved
            },
          });
        }
      }

      // Mark trade as completed
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
      initiatorTeam: {
        id: trade.initiatorTeam.id,
        name: trade.initiatorTeam.name,
        ownerId: trade.initiatorTeam.ownerId,
        ownerName: trade.initiatorTeam.owner?.name || 'Open Slot',
        draftPosition: trade.initiatorTeam.draftPosition || 0,
      },
      receiverTeam: {
        id: trade.receiverTeam.id,
        name: trade.receiverTeam.name,
        ownerId: trade.receiverTeam.ownerId,
        ownerName: trade.receiverTeam.owner?.name || 'Open Slot',
        draftPosition: trade.receiverTeam.draftPosition || 0,
      },
      initiatorAssets: initiatorAssets.map((a) => this.mapTradeAsset(a)),
      receiverAssets: receiverAssets.map((a) => this.mapTradeAsset(a)),
      updatedPicks: updatedPicks.length > 0 ? updatedPicks : undefined,
    };
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

    // Verify the user can reject (receiver or commissioner)
    if (trade.receiverTeam.ownerId !== rejectedByUserId) {
      const league = await this.prisma.league.findUnique({
        where: { id: trade.leagueId },
      });

      if (league?.commissionerId !== rejectedByUserId) {
        throw new Error('Unauthorized to reject this trade');
      }
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

    // Verify the user can cancel (initiator or commissioner)
    if (trade.initiatorTeam.ownerId !== cancelledByUserId) {
      const league = await this.prisma.league.findUnique({
        where: { id: trade.leagueId },
      });

      if (league?.commissionerId !== cancelledByUserId) {
        throw new Error('Unauthorized to cancel this trade');
      }
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
    // Verify commissioner
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

    // Update notes if provided
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

  private async validateAssets(
    leagueId: string,
    teamId: string,
    assets: { assetType: string; id: string }[]
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
        const parts = asset.id.split(':'); // FUTURE_PICK:originalOwnerId:season:round
        if (parts.length < 4) continue;

        const originalOwnerId = parts[1];
        const season = parseInt(parts[2] || '0');
        const round = parseInt(parts[3] || '0');

        const pick = await this.prisma.draftPick.findFirst({
          where: {
            leagueId,
            season,
            round,
            originalOwnerId,
          },
        });

        if (pick) {
          if (pick.currentOwnerId !== teamId) {
            throw new Error(`Team does not own future pick ${asset.id}`);
          }
        } else {
          // If no record, it belongs to original owner
          if (teamId !== originalOwnerId) {
            throw new Error(`Team does not own future pick ${asset.id}`);
          }
        }
      }
    }
  }

  private async validateAssetsForSwap(leagueId: string, teamId: string, assets: any[]): Promise<void> {
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
      } else if (asset.assetType === 'FUTURE_PICK' && asset.futurePickSeason && asset.futurePickRound) {
        // Find if this pick record already exists to check current owner
        const pick = await this.prisma.draftPick.findFirst({
          where: {
            leagueId,
            season: asset.futurePickSeason,
            round: asset.futurePickRound,
            originalOwnerId: asset.fromTeamId, // FUTURE_PICK in asset table tracks fromTeamId
          },
        });

        if (pick) {
          if (pick.currentOwnerId !== teamId) {
            throw new Error(`Future pick is no longer owned by team`);
          }
        } else {
          // If no record exists, the fromTeamId MUST be the original owner
          // We can't verify "original owner" easily here without the full ID string,
          // but we already validated it when the trade was PROPOSED.
          // For extra safety, we could check if fromTeamId is the one who "should" have it.
        }
      }
    }
  }

  // ===========================================================================
  // MAPPING HELPERS
  // ===========================================================================

  private mapAssetType(type: string): TradeAssetType {
    switch (type) {
      case 'DRAFT_PICK':
        return 'DRAFT_PICK';
      case 'PLAYER':
        return 'PLAYER';
      case 'FUTURE_PICK':
        return 'FUTURE_PICK';
      default:
        throw new Error(`Invalid asset type: ${type}`);
    }
  }

  private mapTradeAsset(asset: any): TradeAssetPayload {
    return {
      id: asset.id,
      assetType: asset.assetType,
      fromTeamId: asset.fromTeamId,
      fromTeamName: asset.fromTeam?.name || '',
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
  // QUERY METHODS
  // ===========================================================================

  async getPendingTradesForTeam(teamId: string): Promise<any[]> {
    return this.prisma.trade.findMany({
      where: {
        OR: [
          { initiatorTeamId: teamId },
          { receiverTeamId: teamId },
        ],
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
      orderBy: { proposedAt: 'desc' },
    });
  }

  async getTradeHistory(leagueId: string, limit: number = 50): Promise<any[]> {
    return this.prisma.trade.findMany({
      where: {
        leagueId,
        status: { in: ['COMPLETED', 'REJECTED', 'CANCELLED', 'VETOED'] },
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
      orderBy: { respondedAt: 'desc' },
      take: limit,
    });
  }
}
