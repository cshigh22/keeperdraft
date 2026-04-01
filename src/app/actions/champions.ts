'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import type { KeeperHighlight } from '@/types/champions';

// ============================================================================
// ADD PAST WINNER
// ============================================================================

export async function addPastWinner(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const leagueId = formData.get('leagueId') as string;
  const season = parseInt(formData.get('season') as string);
  const managerName = formData.get('managerName') as string;
  const teamName = formData.get('teamName') as string;
  const highlightsRaw = formData.get('keeperHighlights') as string;

  if (!leagueId || !season || !managerName || !teamName) {
    throw new Error('Missing required fields');
  }

  // Verify commissioner
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { commissionerId: true },
  });

  if (league?.commissionerId !== session.user.id) {
    throw new Error('Only the commissioner can add past winners');
  }

  let keeperHighlights: KeeperHighlight[] | undefined;
  if (highlightsRaw) {
    try {
      keeperHighlights = JSON.parse(highlightsRaw);
    } catch {
      // Ignore malformed JSON
    }
  }

  await prisma.pastWinner.create({
    data: {
      leagueId,
      season,
      managerName,
      teamName,
      keeperHighlights: keeperHighlights ? (keeperHighlights as unknown as import('@prisma/client').Prisma.InputJsonValue) : undefined,
    },
  });

  revalidatePath(`/leagues/${leagueId}`);
  return { success: true };
}

// ============================================================================
// UPDATE PAST WINNER
// ============================================================================

export async function updatePastWinner(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const id = formData.get('id') as string;
  const managerName = formData.get('managerName') as string | undefined;
  const teamName = formData.get('teamName') as string | undefined;
  const highlightsRaw = formData.get('keeperHighlights') as string | undefined;

  if (!id) throw new Error('Missing winner ID');

  const winner = await prisma.pastWinner.findUnique({
    where: { id },
    include: { league: { select: { commissionerId: true, id: true } } },
  });

  if (!winner || winner.league.commissionerId !== session.user.id) {
    throw new Error('Unauthorized');
  }

  const data: Record<string, unknown> = {};
  if (managerName) data.managerName = managerName;
  if (teamName) data.teamName = teamName;
  if (highlightsRaw) {
    try {
      data.keeperHighlights = JSON.parse(highlightsRaw);
    } catch {
      // skip
    }
  }

  await prisma.pastWinner.update({ where: { id }, data });

  revalidatePath(`/leagues/${winner.league.id}`);
  return { success: true };
}

// ============================================================================
// REMOVE PAST WINNER
// ============================================================================

export async function removePastWinner(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const id = formData.get('id') as string;
  if (!id) throw new Error('Missing winner ID');

  const winner = await prisma.pastWinner.findUnique({
    where: { id },
    include: { league: { select: { commissionerId: true, id: true } } },
  });

  if (!winner || winner.league.commissionerId !== session.user.id) {
    throw new Error('Unauthorized');
  }

  await prisma.pastWinner.delete({ where: { id } });

  revalidatePath(`/leagues/${winner.league.id}`);
  return { success: true };
}
