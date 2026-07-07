// Sleeper API Integration
// Server-side utility to fetch and sync player data from Sleeper

import { prisma } from './prisma';
import type { Position, PlayerStatus, Prisma } from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  position: string;
  team: string | null;
  age: number | null;
  years_exp: number | null;
  status: string;
  injury_status: string | null;
  search_rank: number | null;
}

interface SleeperTrendingPlayer {
  player_id: string;
  count: number;
}

interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
}

interface SleeperUser {
  user_id: string;
  display_name?: string;
}

interface SeedResult {
  success: boolean;
  totalPlayers: number;
  insertedPlayers: number;
  updatedPlayers: number;
  skippedPlayers: number;
  errors: string[];
}

// ============================================================================
// SLEEPER API CLIENT
// ============================================================================

const SLEEPER_API_BASE = 'https://api.sleeper.app/v1';

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86400;

async function fetchFromSleeper<T>(path: string, revalidateSeconds?: number): Promise<T> {
  const response = await fetch(`${SLEEPER_API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
    ...(revalidateSeconds !== undefined && { next: { revalidate: revalidateSeconds } }),
  });

  if (!response.ok) {
    throw new Error(`Sleeper API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export const SleeperAPI = {
  /**
   * Fetch all NFL players from Sleeper API
   * Note: This is a large payload (~8MB) - call sparingly (cached for 24h)
   */
  fetchAllPlayers(): Promise<Record<string, SleeperPlayer>> {
    return fetchFromSleeper('/players/nfl', DAY_SECONDS);
  },

  /**
   * Fetch trending players (adds, drops), cached for 1 hour
   */
  fetchTrendingPlayers(type: 'add' | 'drop', limit: number = 25): Promise<SleeperTrendingPlayer[]> {
    return fetchFromSleeper(`/players/nfl/trending/${type}?limit=${limit}`, HOUR_SECONDS);
  },

  /**
   * Fetch league data from Sleeper
   */
  fetchLeague(leagueId: string): Promise<Record<string, unknown>> {
    return fetchFromSleeper(`/league/${leagueId}`);
  },

  /**
   * Fetch rosters for a Sleeper league
   */
  fetchRosters(leagueId: string): Promise<SleeperRoster[]> {
    return fetchFromSleeper(`/league/${leagueId}/rosters`);
  },

  /**
   * Fetch users in a Sleeper league
   */
  fetchLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
    return fetchFromSleeper(`/league/${leagueId}/users`);
  },
};

// ============================================================================
// DATABASE SEEDING
// ============================================================================

const SUPPORTED_POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const UNRANKED_RANK = 9999;

/**
 * Map Sleeper position to our Position enum
 */
function mapPosition(sleeperPosition: string): Position | null {
  return (SUPPORTED_POSITIONS as readonly string[]).includes(sleeperPosition)
    ? (sleeperPosition as Position)
    : null;
}

/**
 * Map Sleeper status to our PlayerStatus enum
 */
function mapStatus(sleeperStatus: string): PlayerStatus {
  const statusMap: Record<string, PlayerStatus> = {
    'Active': 'ACTIVE',
    'Inactive': 'INACTIVE',
    'Injured Reserve': 'INJURED_RESERVE',
    'Practice Squad': 'PRACTICE_SQUAD',
    'Free Agent': 'FREE_AGENT',
  };

  return statusMap[sleeperStatus] || 'ACTIVE';
}

function toPlayerData(sleeperId: string, player: SleeperPlayer): Prisma.PlayerCreateInput {
  return {
    sleeperId,
    firstName: player.first_name || '',
    lastName: player.last_name || '',
    fullName: player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim(),
    position: mapPosition(player.position)!,
    nflTeam: player.team || null,
    age: player.age || null,
    yearsExp: player.years_exp || null,
    status: mapStatus(player.status),
    injuryStatus: player.injury_status || null,
    rank: player.search_rank && player.search_rank > 0 ? player.search_rank : UNRANKED_RANK,
  };
}

/**
 * Seed the database with NFL players from Sleeper API
 * Call this once to populate the Player table
 */
export async function seedPlayersFromSleeper(): Promise<SeedResult> {
  const result: SeedResult = {
    success: false,
    totalPlayers: 0,
    insertedPlayers: 0,
    updatedPlayers: 0,
    skippedPlayers: 0,
    errors: [],
  };

  try {
    console.log('Fetching players from Sleeper API...');
    const sleeperPlayers = await SleeperAPI.fetchAllPlayers();
    const playerEntries = Object.entries(sleeperPlayers);
    result.totalPlayers = playerEntries.length;

    console.log(`Fetched ${result.totalPlayers} players from Sleeper`);

    // Teams (DEF) are identified by position 'DEF' in Sleeper
    const playersToProcess = playerEntries
      .filter(
        ([, player]) =>
          player.player_id &&
          player.position &&
          (SUPPORTED_POSITIONS as readonly string[]).includes(player.position)
      )
      .map(([sleeperId, player]) => toPlayerData(sleeperId, player));

    // Upsert one-by-one (createMany has no upsert); log progress per batch
    const BATCH_SIZE = 1000;

    for (const [index, playerData] of playersToProcess.entries()) {
      try {
        await prisma.player.upsert({
          where: { sleeperId: playerData.sleeperId },
          update: playerData,
          create: playerData,
        });
        // Can't easily distinguish inserted vs updated without another query,
        // so count everything processed as updated
        result.updatedPlayers++;
      } catch (error) {
        result.errors.push(`Error processing ${playerData.fullName}: ${error}`);
        result.skippedPlayers++;
      }

      if ((index + 1) % BATCH_SIZE === 0 || index === playersToProcess.length - 1) {
        console.log(
          `Processed ${index + 1}/${playersToProcess.length} players`
        );
      }
    }

    result.success = true;
    console.log('Player seeding complete:', result);
  } catch (error) {
    result.errors.push(`Fatal error: ${error}`);
    console.error('Player seeding failed:', error);
  }

  return result;
}

/**
 * Update player rankings from Sleeper (can be run periodically)
 */
export async function updatePlayerRankings(): Promise<{ updated: number; errors: string[] }> {
  const result = { updated: 0, errors: [] as string[] };

  try {
    const sleeperPlayers = await SleeperAPI.fetchAllPlayers();

    for (const [sleeperId, player] of Object.entries(sleeperPlayers)) {
      try {
        await prisma.player.updateMany({
          where: { sleeperId },
          data: {
            rank: player.search_rank || null,
            status: mapStatus(player.status),
            injuryStatus: player.injury_status || null,
            nflTeam: player.team || null,
          },
        });
        result.updated++;
      } catch {
        // Player might not exist in our DB - that's okay
      }
    }
  } catch (error) {
    result.errors.push(`Error updating rankings: ${error}`);
  }

  return result;
}

/**
 * Sync a Sleeper league's rosters to our database
 */
export async function syncSleeperLeague(
  ourLeagueId: string,
  sleeperLeagueId: string
): Promise<{ success: boolean; errors: string[] }> {
  const result = { success: false, errors: [] as string[] };

  try {
    // fetchLeague result is unused, but the call validates the league exists
    // (throws on 404) before we start writing
    const [, rosters, users] = await Promise.all([
      SleeperAPI.fetchLeague(sleeperLeagueId),
      SleeperAPI.fetchRosters(sleeperLeagueId),
      SleeperAPI.fetchLeagueUsers(sleeperLeagueId),
    ]);

    // Link our league to the Sleeper league
    await prisma.league.update({
      where: { id: ourLeagueId },
      data: { sleeperId: sleeperLeagueId },
    });

    const userById = new Map(users.map((u) => [u.user_id, u]));

    for (const roster of rosters) {
      if (!roster.owner_id || !userById.has(roster.owner_id)) continue;

      const team = await prisma.team.findFirst({
        where: {
          leagueId: ourLeagueId,
          sleeperId: roster.roster_id.toString(),
        },
      });

      if (!team || !roster.players) continue;

      for (const sleeperPlayerId of roster.players) {
        const player = await prisma.player.findUnique({
          where: { sleeperId: sleeperPlayerId },
        });

        if (!player) continue;

        await prisma.playerRoster.upsert({
          where: {
            teamId_playerId: {
              teamId: team.id,
              playerId: player.id,
            },
          },
          create: {
            teamId: team.id,
            playerId: player.id,
            leagueId: ourLeagueId,
            isKeeper: false,
            acquiredVia: 'FREE_AGENT',
          },
          update: {},
        });
      }
    }

    result.success = true;
  } catch (error) {
    result.errors.push(`Sync error: ${error}`);
  }

  return result;
}

export default SleeperAPI;
