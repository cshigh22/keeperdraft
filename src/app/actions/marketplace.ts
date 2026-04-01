'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import type { TradeIntent } from '@prisma/client';

// ============================================================================
// UPDATE TRADE INTENT
// ============================================================================

export async function updateTradeIntent(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const teamId = formData.get('teamId') as string;
  const intent = formData.get('intent') as TradeIntent;

  if (!teamId || !intent) throw new Error('Missing required fields');

  // Verify ownership
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { ownerId: true, leagueId: true, name: true },
  });

  if (!team) throw new Error('Team not found');

  const league = await prisma.league.findUnique({
    where: { id: team.leagueId },
    select: { commissionerId: true },
  });

  const isOwner = team.ownerId === session.user.id;
  const isCommissioner = league?.commissionerId === session.user.id;

  if (!isOwner && !isCommissioner) {
    throw new Error('Unauthorized');
  }

  await prisma.team.update({
    where: { id: teamId },
    data: { tradeIntent: intent },
  });

  // Auto-generate rumor on intent change
  const intentLabels: Record<TradeIntent, string> = {
    FIRE_SALE: 'is running a fire sale 🔥',
    BUYING: 'is looking to buy 💰',
    LISTENING: 'is open to proposals 👂',
    NOT_TRADING: 'has locked their roster 🔒',
  };

  await prisma.leagueRumor.create({
    data: {
      leagueId: team.leagueId,
      content: `${team.name} ${intentLabels[intent]}`,
      source: 'Front Office Sources',
      isSystem: true,
    },
  });

  revalidatePath(`/leagues/${team.leagueId}`);
  return { success: true };
}

// ============================================================================
// ADD TO TRADE BLOCK
// ============================================================================

export async function addToTradeBlock(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const teamId = formData.get('teamId') as string;
  const playerId = formData.get('playerId') as string;
  const draftCost = formData.get('draftCost') ? parseInt(formData.get('draftCost') as string) : null;
  const askingPrice = (formData.get('askingPrice') as string) || null;
  const phase = (formData.get('phase') as 'PRE_DRAFT' | 'DRAFT') || 'PRE_DRAFT';

  if (!teamId || !playerId) throw new Error('Missing required fields');

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { ownerId: true, leagueId: true, name: true },
  });

  if (!team) throw new Error('Team not found');

  const league = await prisma.league.findUnique({
    where: { id: team.leagueId },
    select: { commissionerId: true },
  });

  if (team.ownerId !== session.user.id && league?.commissionerId !== session.user.id) {
    throw new Error('Unauthorized');
  }

  // Get player name for rumor
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { fullName: true },
  });

  await prisma.tradeBlockEntry.upsert({
    where: { teamId_playerId: { teamId, playerId } },
    create: {
      teamId,
      leagueId: team.leagueId,
      playerId,
      phase,
      draftCost,
      askingPrice,
    },
    update: {
      draftCost,
      askingPrice,
      phase,
    },
  });

  // Auto rumor
  if (player) {
    await prisma.leagueRumor.create({
      data: {
        leagueId: team.leagueId,
        content: `${player.fullName} has been placed on the trade block by ${team.name}`,
        source: 'League Insider',
        isSystem: true,
      },
    });
  }

  revalidatePath(`/leagues/${team.leagueId}`);
  return { success: true };
}

// ============================================================================
// REMOVE FROM TRADE BLOCK
// ============================================================================

export async function removeFromTradeBlock(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const teamId = formData.get('teamId') as string;
  const playerId = formData.get('playerId') as string;

  if (!teamId || !playerId) throw new Error('Missing required fields');

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { ownerId: true, leagueId: true },
  });

  if (!team) throw new Error('Team not found');
  if (team.ownerId !== session.user.id) throw new Error('Unauthorized');

  await prisma.tradeBlockEntry.deleteMany({
    where: { teamId, playerId },
  });

  revalidatePath(`/leagues/${team.leagueId}`);
  return { success: true };
}

// ============================================================================
// POST LEAGUE RUMOR
// ============================================================================

export async function postLeagueRumor(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');

  const leagueId = formData.get('leagueId') as string;
  const content = formData.get('content') as string;
  const source = (formData.get('source') as string) || 'Anonymous';

  if (!leagueId || !content) throw new Error('Missing required fields');

  // Only commissioner can post manual rumors
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { commissionerId: true },
  });

  if (league?.commissionerId !== session.user.id) {
    throw new Error('Only the commissioner can post rumors');
  }

  await prisma.leagueRumor.create({
    data: {
      leagueId,
      content,
      source,
      isSystem: false,
    },
  });

  revalidatePath(`/leagues/${leagueId}`);
  return { success: true };
}
