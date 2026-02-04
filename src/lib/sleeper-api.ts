// Sleeper API Integration
// Server-side utility to fetch and sync player data from Sleeper

import { prisma } from './prisma';
import type { Position, PlayerStatus } from '@prisma/client';

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

export const SleeperAPI = {
  /**
   * Fetch all NFL players from Sleeper API
   * Note: This is a large payload (~8MB) - call sparingly
   */
  async fetchAllPlayers(): Promise<Record<string, SleeperPlayer>> {
    const response = await fetch(`${SLEEPER_API_BASE}/players/nfl`, {
      headers: {
        'Accept': 'application/json',
      },
      // Cache for 24 hours
      next: { revalidate: 86400 },
    });

    if (!response.ok) {
      throw new Error(`Sleeper API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  },

  /**
   * Fetch trending players (adds, drops)
   */
  async fetchTrendingPlayers(type: 'add' | 'drop', limit: number = 25): Promise<any[]> {
    const response = await fetch(
      `${SLEEPER_API_BASE}/players/nfl/trending/${type}?limit=${limit}`,
      {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      throw new Error(`Sleeper API error: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Fetch league data from Sleeper
   */
  async fetchLeague(leagueId: string): Promise<any> {
    const response = await fetch(`${SLEEPER_API_BASE}/league/${leagueId}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Sleeper API error: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Fetch rosters for a Sleeper league
   */
  async fetchRosters(leagueId: string): Promise<any[]> {
    const response = await fetch(`${SLEEPER_API_BASE}/league/${leagueId}/rosters`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Sleeper API error: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Fetch users in a Sleeper league
   */
  async fetchLeagueUsers(leagueId: string): Promise<any[]> {
    const response = await fetch(`${SLEEPER_API_BASE}/league/${leagueId}/users`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Sleeper API error: ${response.status}`);
    }

    return response.json();
  },
};

// ============================================================================
// DATABASE SEEDING
// ============================================================================

/**
 * Map Sleeper position to our Position enum
 */
function mapPosition(sleeperPosition: string): Position | null {
  const positionMap: Record<string, Position> = {
    'QB': 'QB',
    'RB': 'RB',
    'WR': 'WR',
    'TE': 'TE',
    'K': 'K',
    'DEF': 'DEF',
  };

  return positionMap[sleeperPosition] || null;
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

    // Filter to fantasy-relevant positions
    const relevantPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
    
    // Process in batches to avoid memory issues
    const BATCH_SIZE = 500;
    
    for (let i = 0; i < playerEntries.length; i += BATCH_SIZE) {
      const batch = playerEntries.slice(i, i + BATCH_SIZE);
      
      const playersToUpsert = batch
        .filter(([_, player]) => {
          // Only include fantasy-relevant positions with valid data
          return (
            player.position &&
            relevantPositions.has(player.position) &&
            player.full_name &&
            player.player_id
          );
        })
        .map(([sleeperId, player]) => ({
          sleeperId,
          firstName: player.first_name || '',
          lastName: player.last_name || '',
          fullName: player.full_name,
          position: mapPosition(player.position)!,
          nflTeam: player.team || null,
          age: player.age || null,
          yearsExp: player.years_exp || null,
          status: mapStatus(player.status),
          injuryStatus: player.injury_status || null,
          rank: player.search_rank || null,
        }));

      // Use upsert for each player
      for (const playerData of playersToUpsert) {
        try {
          const existing = await prisma.player.findUnique({
            where: { sleeperId: playerData.sleeperId },
          });

          if (existing) {
            await prisma.player.update({
              where: { sleeperId: playerData.sleeperId },
              data: playerData,
            });
            result.updatedPlayers++;
          } else {
            await prisma.player.create({
              data: playerData,
            });
            result.insertedPlayers++;
          }
        } catch (error) {
          result.errors.push(`Error processing ${playerData.fullName}: ${error}`);
          result.skippedPlayers++;
        }
      }

      console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(playerEntries.length / BATCH_SIZE)}`);
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
      } catch (error) {
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
    // Fetch Sleeper data
    const [sleeperLeague, rosters, users] = await Promise.all([
      SleeperAPI.fetchLeague(sleeperLeagueId),
      SleeperAPI.fetchRosters(sleeperLeagueId),
      SleeperAPI.fetchLeagueUsers(sleeperLeagueId),
    ]);

    // Update league with Sleeper ID
    await prisma.league.update({
      where: { id: ourLeagueId },
      data: { sleeperId: sleeperLeagueId },
    });

    // Create user map
    const userMap = new Map(users.map((u: any) => [u.user_id, u]));

    // Process each roster
    for (const roster of rosters) {
      const sleeperUser = userMap.get(roster.owner_id);
      if (!sleeperUser) continue;

      // Find or create team
      const team = await prisma.team.findFirst({
        where: {
          leagueId: ourLeagueId,
          sleeperId: roster.roster_id.toString(),
        },
      });

      if (team && roster.players) {
        // Sync players on roster
        for (const playerId of roster.players) {
          const player = await prisma.player.findUnique({
            where: { sleeperId: playerId },
          });

          if (player) {
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
      }
    }

    result.success = true;
  } catch (error) {
    result.errors.push(`Sync error: ${error}`);
  }

  return result;
}

export default SleeperAPI;
