// Trade Processor
// Handles atomic trade creation, acceptance, and asset swapping

import type { Prisma, PrismaClient, TradeAsset, TradeAssetType } from '@prisma/client';
import type {
  TradeAssetPayload,
  TeamSummary,
  DraftPickSummary,
  TradeOfferedPayload,
} from '@/types/socket';
import { getRosterFeasibility } from '@/lib/roster-restrictions';
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

// One side of a trade, normalized for the feasibility check
interface TradeSideAssets {
  teamId: string;
  teamName: string;
  playerIds: string[];
  draftPickIds: string[];
  futurePickSeasons: number[];
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
  fromTeamId: string,
  // Materialized DraftPick row ids for FUTURE_PICK assets, keyed by asset id
  futurePickIds: Map<string, string>
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
      return {
        ...base,
        draftPickId: futurePickIds.get(asset.id),
        futurePickSeason: season,
        futurePickRound: round,
      };
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

    // Block roster-breaking trades before the offer is ever sent
    const toSide = (
      teamId: string,
      teamName: string,
      assets: AssetInput[]
    ): TradeSideAssets => ({
      teamId,
      teamName,
      playerIds: assets.filter((a) => a.assetType === 'PLAYER').map((a) => a.id),
      draftPickIds: assets.filter((a) => a.assetType === 'DRAFT_PICK').map((a) => a.id),
      futurePickSeasons: assets
        .filter((a) => a.assetType === 'FUTURE_PICK')
        .map((a) => parseFutureAssetId(a.id).season),
    });

    await this.assertTradeFeasible(
      leagueId,
      toSide(initiatorTeamId, initiatorTeam.name, initiatorAssets),
      toSide(receiverTeamId, receiverTeam.name, receiverAssets)
    );

    // Give every future pick a real DraftPick row now, so acceptance can
    // transfer it by id exactly like a board pick instead of guessing which
    // row matches a (season, round) pair at execution time.
    const futurePickIds = new Map<string, string>();
    for (const [teamId, assets] of [
      [initiatorTeamId, initiatorAssets],
      [receiverTeamId, receiverAssets],
    ] as const) {
      for (const asset of assets) {
        if (asset.assetType === 'FUTURE_PICK') {
          futurePickIds.set(asset.id, await this.materializeFuturePick(leagueId, teamId, asset.id));
        }
      }
    }

    const trade = await this.prisma.trade.create({
      data: {
        leagueId,
        initiatorTeamId,
        receiverTeamId,
        status: 'PENDING',
        expiresAt: expiresAt || new Date(Date.now() + DEFAULT_TRADE_TTL_MS),
        assets: {
          create: [
            ...initiatorAssets.map((asset) =>
              buildAssetCreateInput(asset, initiatorTeamId, futurePickIds)
            ),
            ...receiverAssets.map((asset) =>
              buildAssetCreateInput(asset, receiverTeamId, futurePickIds)
            ),
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

    // Re-check feasibility against current state — picks and rosters may have
    // changed since the proposal. A commissioner force skips this guard.
    if (!forcedByCommissioner) {
      const toSide = (
        teamId: string,
        teamName: string,
        assets: TradeAsset[]
      ): TradeSideAssets => ({
        teamId,
        teamName,
        playerIds: assets.map((a) => a.playerId).filter((id): id is string => Boolean(id)),
        // Materialized future picks carry a draftPickId too; the season lookup
        // in assertTradeFeasible keeps them out of current-season math.
        draftPickIds: assets.map((a) => a.draftPickId).filter((id): id is string => Boolean(id)),
        futurePickSeasons: assets
          .filter((a) => !a.draftPickId && a.futurePickSeason)
          .map((a) => a.futurePickSeason!),
      });

      await this.assertTradeFeasible(
        trade.leagueId,
        toSide(trade.initiatorTeamId, trade.initiatorTeam.name, initiatorAssets),
        toSide(trade.receiverTeamId, trade.receiverTeam.name, receiverAssets)
      );
    }

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

      // Swap draft picks. Board picks and materialized future picks both
      // carry a draftPickId and transfer by id.
      for (const asset of trade.assets) {
        if (
          asset.draftPickId &&
          (asset.assetType === 'DRAFT_PICK' || asset.assetType === 'FUTURE_PICK')
        ) {
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

  // ===========================================================================
  // FEASIBILITY GUARD
  // ===========================================================================

  // Rejects a trade that would leave either team worse off in its ability to
  // field a legal lineup: unable to fill required starting slots with its
  // remaining current-season picks, or holding more players + picks than the
  // roster has room for. Comparing post-trade against pre-trade (rather than
  // demanding absolute feasibility) lets already-broken rosters still make
  // neutral or improving trades.
  private async assertTradeFeasible(
    leagueId: string,
    sideA: TradeSideAssets,
    sideB: TradeSideAssets
  ): Promise<void> {
    const [league, settings] = await Promise.all([
      this.prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } }),
      this.prisma.draftSettings.findUnique({ where: { leagueId } }),
    ]);

    // Without settings there is no roster shape to validate against
    if (!league || !settings) return;
    const season = league.season;

    const allPlayerIds = [...sideA.playerIds, ...sideB.playerIds];
    const allPickIds = [...sideA.draftPickIds, ...sideB.draftPickIds];

    const [tradedPlayers, tradedPicks, boardPickCount] = await Promise.all([
      allPlayerIds.length
        ? this.prisma.player.findMany({
            where: { id: { in: allPlayerIds } },
            select: { id: true, position: true },
          })
        : [],
      allPickIds.length
        ? this.prisma.draftPick.findMany({
            where: { id: { in: allPickIds } },
            select: { id: true, season: true },
          })
        : [],
      this.prisma.draftPick.count({ where: { leagueId, season } }),
    ]);

    const positionById = new Map(tradedPlayers.map((p) => [p.id, p.position]));
    const pickSeasonById = new Map(tradedPicks.map((p) => [p.id, p.season]));

    // Only current-season picks affect this draft's math
    const currentSeasonPicks = (side: TradeSideAssets): number =>
      side.draftPickIds.filter((id) => pickSeasonById.get(id) === season).length +
      side.futurePickSeasons.filter((s) => s === season).length;

    const evaluate = async (self: TradeSideAssets, other: TradeSideAssets): Promise<void> => {
      const rosterEntries = await this.prisma.playerRoster.findMany({
        where: { leagueId, teamId: self.teamId, acquiredVia: { not: 'FREE_AGENT' } },
        select: { playerId: true, player: { select: { position: true } } },
      });

      // Before the board exists every team implicitly owns a full slate
      const remainingPicks =
        boardPickCount > 0
          ? await this.prisma.draftPick.count({
              where: { leagueId, season, currentOwnerId: self.teamId, isComplete: false },
            })
          : settings.totalRounds;

      const prePositions = rosterEntries.map((entry) => entry.player.position);
      const pre = getRosterFeasibility(prePositions, settings, remainingPicks);

      const outgoing = new Set(self.playerIds);
      const incomingPositions = other.playerIds
        .map((id) => positionById.get(id))
        .filter((pos): pos is NonNullable<typeof pos> => Boolean(pos));
      const postPositions: string[] = [
        ...rosterEntries
          .filter((entry) => !outgoing.has(entry.playerId))
          .map((entry) => entry.player.position),
        ...incomingPositions,
      ];
      const postRemaining = remainingPicks - currentSeasonPicks(self) + currentSeasonPicks(other);

      const post = getRosterFeasibility(postPositions, settings, postRemaining);

      if (post.starterShortfall > pre.starterShortfall) {
        throw new Error(
          `Trade blocked: ${self.teamName} would have ${postRemaining} pick${
            postRemaining === 1 ? '' : 's'
          } left but still needs ${post.unfilledStarterLabels.join(', ')}`
        );
      }
      if (post.capacityOverflow > pre.capacityOverflow) {
        throw new Error(
          `Trade blocked: ${self.teamName} would end up with more players than roster spots`
        );
      }
    };

    await evaluate(sideA, sideB);
    await evaluate(sideB, sideA);
  }

  // Ensures a future pick referenced by composite id has a concrete DraftPick
  // row, returning its id. validateAssets has already confirmed ownership: an
  // existing row's currentOwner matches the sender, and a missing row means
  // the sender is the pick's original owner.
  private async materializeFuturePick(
    leagueId: string,
    fromTeamId: string,
    assetId: string
  ): Promise<string> {
    const { originalOwnerId, season, round } = parseFutureAssetId(assetId);
    const ownerId = originalOwnerId || fromTeamId;

    const existing = await this.prisma.draftPick.findFirst({
      where: { leagueId, season, round, originalOwnerId: ownerId },
    });
    if (existing) return existing.id;

    const created = await this.prisma.draftPick.create({
      data: {
        leagueId,
        season,
        round,
        originalOwnerId: ownerId,
        currentOwnerId: fromTeamId,
      },
    });
    return created.id;
  }

  // LEGACY PATH — only for FUTURE_PICK assets persisted before future picks
  // were materialized at proposal time (no draftPickId on the asset). Update
  // the existing row if the sender owns one, otherwise materialize it with
  // the sender as original owner.
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
      if (
        asset.draftPickId &&
        (asset.assetType === 'DRAFT_PICK' || asset.assetType === 'FUTURE_PICK')
      ) {
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
