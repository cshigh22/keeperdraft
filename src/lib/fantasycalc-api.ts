// FantasyCalc API Integration
// Fetches real fantasy rankings to replace Sleeper's search_rank

import { prisma } from './prisma';
import { SleeperAPI } from './sleeper-api';
import { UNRANKED_RANK } from './rank';

// ============================================================================
// TYPES
// ============================================================================

interface FantasyCalcPlayer {
  player: {
    id: number;
    name: string;
    sleeperId: string;
    position: string;
    maybeTeam: string | null;
    maybeAge: number | null;
  };
  value: number;
  overallRank: number;
  positionRank: number;
  redraftValue: number;
  maybeTier: number | null;
}

interface RankingUpdateResult {
  success: boolean;
  totalFetched: number;
  matched: number;
  updated: number;
  unmatched: number;
  kdefRanked: number;
  errors: string[];
}

// ============================================================================
// API CLIENT
// ============================================================================

const FANTASYCALC_API_BASE = 'https://api.fantasycalc.com';

/**
 * Fetch current redraft rankings from FantasyCalc
 * Params:
 *  - isDynasty: false for redraft rankings
 *  - numQbs: 1 for standard leagues, 2 for superflex
 *  - numTeams: league size (default 12)
 */
export async function fetchFantasyCalcRankings(
  isDynasty: boolean = false,
  numQbs: number = 1,
  numTeams: number = 12
): Promise<FantasyCalcPlayer[]> {
  const url = `${FANTASYCALC_API_BASE}/values/current?isDynasty=${isDynasty}&numQbs=${numQbs}&numTeams=${numTeams}`;
  
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`FantasyCalc API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// ============================================================================
// DATABASE UPDATE
// ============================================================================

/**
 * Update player rankings in the database using FantasyCalc data.
 * Matches players by Sleeper ID for accuracy.
 * 
 * This should be run before a draft (e.g. night before or morning of).
 * Rankings will be reflected on the next state sync in a live draft.
 */
export async function updateRankingsFromFantasyCalc(
  isDynasty: boolean = false,
  numQbs: number = 1,
  numTeams: number = 12
): Promise<RankingUpdateResult> {
  const result: RankingUpdateResult = {
    success: false,
    totalFetched: 0,
    matched: 0,
    updated: 0,
    unmatched: 0,
    kdefRanked: 0,
    errors: [],
  };

  try {
    console.log('[FantasyCalc] Fetching rankings...');
    const rankings = await fetchFantasyCalcRankings(isDynasty, numQbs, numTeams);
    result.totalFetched = rankings.length;
    console.log(`[FantasyCalc] Fetched ${rankings.length} player rankings`);

    // Step 1: Reset all ranks to unranked so players not covered by any
    // source below sink to the bottom
    await prisma.player.updateMany({
      data: {
        rank: UNRANKED_RANK,
        positionRank: null,
      },
    });

    // Step 2: Update each ranked player by matching on sleeperId
    let batchUpdates = 0;
    let maxOverallRank = rankings.length;
    for (const entry of rankings) {
      const sleeperId = entry.player.sleeperId;
      if (!sleeperId) {
        result.unmatched++;
        continue;
      }

      try {
        const updateResult = await prisma.player.updateMany({
          where: { sleeperId },
          data: {
            rank: entry.overallRank,
            positionRank: entry.positionRank,
          },
        });

        if (updateResult.count > 0) {
          result.matched++;
          result.updated++;
          batchUpdates++;
          maxOverallRank = Math.max(maxOverallRank, entry.overallRank);
        } else {
          result.unmatched++;
        }
      } catch (error) {
        result.errors.push(`Error updating ${entry.player.name} (sleeperId: ${sleeperId}): ${error}`);
      }
    }

    // Step 3: FantasyCalc has no K/DEF rankings, so rank them by last
    // season's standard fantasy points from Sleeper, continuing the overall
    // numbering after FantasyCalc's list. Failures here keep the FC ranks.
    try {
      result.kdefRanked = await rankKickersAndDefensesByStats(maxOverallRank);
    } catch (error) {
      result.errors.push(`K/DEF ranking failed (FantasyCalc ranks still applied): ${error}`);
      console.error('[FantasyCalc] K/DEF ranking failed:', error);
    }

    result.success = true;
    console.log(`[FantasyCalc] Rankings update complete:`, {
      fetched: result.totalFetched,
      matched: result.matched,
      updated: result.updated,
      unmatched: result.unmatched,
      kdefRanked: result.kdefRanked,
      errors: result.errors.length,
    });

  } catch (error) {
    result.errors.push(`Fatal error: ${error}`);
    console.error('[FantasyCalc] Rankings update failed:', error);
  }

  return result;
}

/**
 * Rank K and DEF players by last completed season's standard fantasy points
 * (Sleeper stats). Overall ranks continue after `startRank` so K/DEF sort
 * below FantasyCalc-ranked players but in quality order. Players without
 * stats stay at UNRANKED_RANK. Returns how many players were ranked.
 */
async function rankKickersAndDefensesByStats(startRank: number): Promise<number> {
  // Last completed season: the season year is always behind the calendar
  // year by the time drafts happen (the 2025 season ends in Jan 2026)
  const season = new Date().getFullYear() - 1;
  const stats = await SleeperAPI.fetchSeasonStats(season);

  const players = await prisma.player.findMany({
    where: { position: { in: ['K', 'DEF'] } },
    select: { id: true, sleeperId: true, position: true },
  });

  const scored = players
    .map((player) => ({ player, points: stats[player.sleeperId]?.pts_std ?? 0 }))
    .filter((entry) => entry.points > 0)
    .sort((a, b) => b.points - a.points);

  const positionCounters: Record<string, number> = {};
  await prisma.$transaction(
    scored.map((entry, index) => {
      positionCounters[entry.player.position] = (positionCounters[entry.player.position] ?? 0) + 1;
      return prisma.player.update({
        where: { id: entry.player.id },
        data: {
          rank: startRank + index + 1,
          positionRank: positionCounters[entry.player.position],
        },
      });
    })
  );

  console.log(`[FantasyCalc] Ranked ${scored.length} K/DEF players by ${season} season points`);
  return scored.length;
}
