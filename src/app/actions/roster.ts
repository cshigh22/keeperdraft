'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

/**
 * Search global player database.
 */
export async function searchGlobalPlayers(query: string) {
  if (!query || query.length < 2) return [];

  const players = await prisma.player.findMany({
    where: {
      fullName: {
        contains: query,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      fullName: true,
      position: true,
      nflTeam: true,
      rank: true,
    },
    orderBy: { rank: 'asc' },
    take: 20,
  });

  return players;
}

/**
 * Manually add a player to a team's roster (Commissioner only).
 */
export async function addPlayerToTeamRoster(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const leagueId = formData.get('leagueId') as string;
  const teamId = formData.get('teamId') as string;
  const playerId = formData.get('playerId') as string;

  if (!leagueId || !teamId || !playerId) {
    throw new Error('Missing required fields');
  }

  // Verify status
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { commissionerId: true },
  });

  if (league?.commissionerId !== session.user.id) {
    throw new Error('Only the commissioner can manually add players to rosters');
  }

  // The commissioner check above only covers leagueId; the team must belong
  // to that same league or this becomes a cross-league write.
  const team = await prisma.team.findFirst({
    where: { id: teamId, leagueId },
    select: { id: true },
  });

  if (!team) {
    throw new Error('Team not found in this league');
  }

  // Check if player is already on another roster in this league
  const existing = await prisma.playerRoster.findFirst({
    where: { leagueId, playerId },
    include: { team: { select: { name: true } } },
  });

  if (existing) {
    throw new Error(`Player is already on ${existing.team.name}'s roster`);
  }

  // Add to roster
  await prisma.playerRoster.create({
    data: {
      leagueId,
      teamId,
      playerId,
      acquiredVia: 'FREE_AGENT',
      isKeeper: false,
    },
  });

  revalidatePath(`/leagues/${leagueId}`);
  return { success: true };
}

/**
 * Remove a player from a roster (Commissioner only).
 */
export async function removePlayerFromRoster(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const leagueId = formData.get('leagueId') as string;
  const rosterEntryId = formData.get('entryId') as string;

  if (!leagueId || !rosterEntryId) throw new Error('Missing required fields');

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { commissionerId: true },
  });

  if (league?.commissionerId !== session.user.id) {
    throw new Error('Unauthorized');
  }

  // Scoped to the league the caller was authorized for; a foreign league's
  // entry reads the same as a nonexistent one.
  const rosterEntry = await prisma.playerRoster.findFirst({
    where: { id: rosterEntryId, leagueId },
    select: { id: true, teamId: true, playerId: true },
  });

  if (!rosterEntry) {
    throw new Error('Roster entry not found');
  }

  await prisma.playerRoster.delete({ where: { id: rosterEntry.id } });

  // The player's trade-block listing is void once they leave the roster
  await prisma.tradeBlockEntry.deleteMany({
    where: { teamId: rosterEntry.teamId, playerId: rosterEntry.playerId },
  });

  revalidatePath(`/leagues/${leagueId}`);
  return { success: true };
}
