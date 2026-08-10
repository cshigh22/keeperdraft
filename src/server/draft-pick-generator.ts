// Draft pick slot generation, shared by the commissioner service (Next.js),
// the socket server's DraftStateManager, and season rollover. This is the only
// code allowed to create or re-slot DraftPick rows for a season.

import type { DraftType, Prisma } from '@prisma/client';

// Team pick order for a given round, based on draft type
export function buildRoundOrder(
  draftType: DraftType,
  round: number,
  teamOrder: string[]
): string[] {
  switch (draftType) {
    case 'SNAKE':
      return round % 2 === 0 ? [...teamOrder].reverse() : teamOrder;
    case 'LINEAR':
      return teamOrder;
    case 'THIRD_ROUND_REVERSAL': {
      const cycle = Math.floor((round - 1) / 2) % 2;
      const isReversedRound = round > 1 && (round === 2 || round === 3 || cycle === 1);
      return isReversedRound ? [...teamOrder].reverse() : teamOrder;
    }
    default:
      return teamOrder;
  }
}

// "round:originalOwnerId" -> currentOwnerId for picks that were traded, so
// trades "follow the team" when the order is regenerated. Callers must pass
// slotted rows for a single season only — unslotted (pickInRound: null) rows
// are trade-materialized future picks and belong to a different board.
export function buildTradeMap(
  picks: { round: number; originalOwnerId: string; currentOwnerId: string }[]
): Map<string, string> {
  const tradeMap = new Map<string, string>();
  for (const pick of picks) {
    if (pick.currentOwnerId !== pick.originalOwnerId) {
      tradeMap.set(`${pick.round}:${pick.originalOwnerId}`, pick.currentOwnerId);
    }
  }
  return tradeMap;
}

export interface GeneratePickSlotsParams {
  leagueId: string;
  season: number; // caller supplies — never derived from the clock
  teamOrderList: string[]; // index 0 = pick 1
  totalRounds: number;
  draftType: DraftType;
  // "round:originalOwnerId" -> currentOwnerId, for picks that were traded
  tradeMap: Map<string, string>;
}

// Upserts every pick slot for the given order. Uses upsert (not delete+create)
// so existing pick IDs survive — TradeAssets reference them.
export async function generatePickSlots(
  tx: Prisma.TransactionClient,
  { leagueId, season, teamOrderList, totalRounds, draftType, tradeMap }: GeneratePickSlotsParams
): Promise<number> {
  // Adoption pre-pass: trade proposals materialize future-season picks as rows
  // with pickInRound/overallPickNumber NULL (trade-processor createFuturePick).
  // Postgres treats NULLs as distinct in the unique index, so the upsert below
  // would never match them and would create a duplicate slot, silently losing
  // the traded ownership. Instead, slot those rows in place — preserving their
  // id (TradeAsset.draftPickId references it) and their currentOwnerId.
  const unslotted = await tx.draftPick.findMany({
    where: { leagueId, season, pickInRound: null },
    select: { id: true, round: true, originalOwnerId: true },
  });
  const unslottedByKey = new Map(unslotted.map((p) => [`${p.round}:${p.originalOwnerId}`, p]));

  let picksUpdated = 0;

  for (let round = 1; round <= totalRounds; round++) {
    const orderForRound = buildRoundOrder(draftType, round, teamOrderList);

    for (const [index, teamId] of orderForRound.entries()) {
      const pickInRound = index + 1;
      const overallPickNumber = (round - 1) * teamOrderList.length + pickInRound;

      const adoptee = unslottedByKey.get(`${round}:${teamId}`);
      if (adoptee) {
        await tx.draftPick.update({
          where: { id: adoptee.id },
          data: { pickInRound, overallPickNumber },
        });
        unslottedByKey.delete(`${round}:${teamId}`);
        picksUpdated++;
        continue;
      }

      // If this team's pick in this round was previously traded, the trade
      // follows the team
      const currentOwnerId = tradeMap.get(`${round}:${teamId}`) || teamId;

      await tx.draftPick.upsert({
        where: {
          leagueId_season_round_pickInRound: { leagueId, season, round, pickInRound },
        },
        update: {
          originalOwnerId: teamId,
          currentOwnerId,
          overallPickNumber,
        },
        create: {
          leagueId,
          season,
          round,
          pickInRound,
          overallPickNumber,
          originalOwnerId: teamId,
          currentOwnerId,
        },
      });
      picksUpdated++;
    }
  }

  // Clean up any extra picks if the number of teams or rounds decreased.
  // Unslotted rows are excluded: deleting one would SetNull the TradeAsset
  // that references it and destroy the trade record.
  await tx.draftPick.deleteMany({
    where: {
      leagueId,
      season,
      pickInRound: { not: null },
      OR: [{ round: { gt: totalRounds } }, { pickInRound: { gt: teamOrderList.length } }],
    },
  });

  return picksUpdated;
}
