// FantasyCalc API Integration
// Fetches real fantasy rankings to replace Sleeper's search_rank

import { prisma } from './prisma';

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
    errors: [],
  };

  try {
    console.log('[FantasyCalc] Fetching rankings...');
    const rankings = await fetchFantasyCalcRankings(isDynasty, numQbs, numTeams);
    result.totalFetched = rankings.length;
    console.log(`[FantasyCalc] Fetched ${rankings.length} player rankings`);

    // Step 1: Reset all ranks to 9999 (unranked) so players not in
    // FantasyCalc's list sink to the bottom
    await prisma.player.updateMany({
      data: {
        rank: 9999,
        positionRank: null,
      },
    });

    // Step 2: Update each ranked player by matching on sleeperId
    let batchUpdates = 0;
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
        } else {
          result.unmatched++;
        }
      } catch (error) {
        result.errors.push(`Error updating ${entry.player.name} (sleeperId: ${sleeperId}): ${error}`);
      }
    }

    result.success = true;
    console.log(`[FantasyCalc] Rankings update complete:`, {
      fetched: result.totalFetched,
      matched: result.matched,
      updated: result.updated,
      unmatched: result.unmatched,
      errors: result.errors.length,
    });

  } catch (error) {
    result.errors.push(`Fatal error: ${error}`);
    console.error('[FantasyCalc] Rankings update failed:', error);
  }

  return result;
}
