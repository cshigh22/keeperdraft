'use server';

import { Prisma, Position } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { requireTeamAccess } from '@/lib/team-access';
import { ROSTERED_PLAYER_WHERE, isRosteredEntry } from '@/lib/roster-membership';
import { NFL_RELEVANT_PLAYER_WHERE } from '@/lib/player-pool';
import { totalRosterSlots } from '@/lib/roster-restrictions';
import { revalidateLeague } from './league';

// Free agency opens only once the draft is done: before that, roster building
// happens through keepers and the draft itself, and the draft-start purge
// would wipe any earlier pickups anyway.
async function assertDraftCompleted(leagueId: string) {
    const draftState = await prisma.draftState.findUnique({
        where: { leagueId },
        select: { status: true },
    });
    if (draftState?.status !== 'COMPLETED') {
        throw new Error('Free agent pickups open after the draft is complete');
    }
}

export interface FreeAgentPlayer {
    id: string;
    fullName: string;
    position: string;
    nflTeam: string | null;
    rank: number | null;
    injuryStatus: string | null;
}

/**
 * League-scoped free agent list: NFL-relevant players not on any roster in
 * this league. Roster-row-based only — a drafted-then-dropped player must
 * reappear even though their DraftPick row survives.
 */
export async function listAvailableFreeAgents(
    leagueId: string,
    opts?: { query?: string; position?: string }
): Promise<{ success: true; data: FreeAgentPlayer[] } | { success: false; error: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) throw new Error('Unauthorized');

        const membership = await prisma.leagueMember.findUnique({
            where: { userId_leagueId: { userId: session.user.id, leagueId } },
            select: { id: true },
        });
        if (!membership) throw new Error('Not a member of this league');

        const rostered = await prisma.playerRoster.findMany({
            where: { leagueId, ...ROSTERED_PLAYER_WHERE },
            select: { playerId: true },
        });

        const query = opts?.query?.trim() ?? '';
        const position = opts?.position ?? 'ALL';

        const players = await prisma.player.findMany({
            where: {
                id: { notIn: rostered.map((entry) => entry.playerId) },
                ...NFL_RELEVANT_PLAYER_WHERE,
                ...(query.length >= 2
                    ? { fullName: { contains: query, mode: 'insensitive' as const } }
                    : {}),
                ...(position !== 'ALL' && position in Position
                    ? { position: position as Position }
                    : {}),
            },
            select: {
                id: true,
                fullName: true,
                position: true,
                nflTeam: true,
                rank: true,
                injuryStatus: true,
            },
            orderBy: [{ rank: { sort: 'asc', nulls: 'last' } }, { fullName: 'asc' }],
            take: 50,
        });

        return { success: true, data: players };
    } catch (error: any) {
        console.error('Failed to list free agents:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Pick up a free agent (first-come-first-serve), optionally dropping a player
 * in the same transaction when the roster is full. Owner or commissioner.
 */
export async function pickupFreeAgent(input: {
    leagueId: string;
    teamId: string;
    playerId: string;
    dropRosterEntryId?: string;
}): Promise<{ success: boolean; error?: string }> {
    const { leagueId, teamId, playerId, dropRosterEntryId } = input;
    try {
        await requireTeamAccess(teamId, leagueId);
        await assertDraftCompleted(leagueId);

        const settings = await prisma.draftSettings.findUnique({ where: { leagueId } });
        if (!settings) throw new Error('League draft settings not found');
        const maxSize = totalRosterSlots(settings);

        await prisma.$transaction(async (tx) => {
            if (dropRosterEntryId) {
                const dropEntry = await tx.playerRoster.findFirst({
                    where: { id: dropRosterEntryId, teamId, leagueId },
                });
                if (!dropEntry || !isRosteredEntry(dropEntry)) {
                    throw new Error('Player to drop is not on your roster');
                }
                await tx.playerRoster.delete({ where: { id: dropEntry.id } });
                await tx.tradeBlockEntry.deleteMany({
                    where: { leagueId, playerId: dropEntry.playerId },
                });
            }

            // Counted after the drop, so a full roster with a drop passes.
            const rosteredCount = await tx.playerRoster.count({
                where: { leagueId, teamId, ...ROSTERED_PLAYER_WHERE },
            });
            if (rosteredCount >= maxSize) {
                throw new Error(
                    `Your roster is full (${rosteredCount}/${maxSize}). Choose a player to drop.`
                );
            }

            // A pre-draft marketplace signal row (acquiredVia FREE_AGENT, not a
            // keeper) may still exist for this player; it isn't a rostered player
            // but it does occupy the [leagueId, playerId] unique slot.
            await tx.playerRoster.deleteMany({
                where: { leagueId, playerId, isKeeper: false, acquiredVia: 'FREE_AGENT' },
            });
            await tx.tradeBlockEntry.deleteMany({ where: { leagueId, playerId } });

            // The @@unique([leagueId, playerId]) constraint is the FCFS arbiter:
            // a concurrent pickup of the same player fails here with P2002.
            await tx.playerRoster.create({
                data: { leagueId, teamId, playerId, acquiredVia: 'PICKUP', isKeeper: false },
            });
        });

        await revalidateLeague(leagueId);
        return { success: true };
    } catch (error: any) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return { success: false, error: 'That player was just picked up by another team' };
        }
        console.error('Failed to pick up free agent:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Drop a player from your own roster to free agency. Owner or commissioner.
 */
export async function dropPlayer(input: {
    leagueId: string;
    teamId: string;
    rosterEntryId: string;
}): Promise<{ success: boolean; error?: string }> {
    const { leagueId, teamId, rosterEntryId } = input;
    try {
        await requireTeamAccess(teamId, leagueId);
        await assertDraftCompleted(leagueId);

        const entry = await prisma.playerRoster.findFirst({
            where: { id: rosterEntryId, teamId, leagueId },
        });
        if (!entry || !isRosteredEntry(entry)) {
            throw new Error('Player is not on your roster');
        }

        await prisma.$transaction(async (tx) => {
            await tx.playerRoster.delete({ where: { id: entry.id } });
            // The player's trade-block listing is void once they leave the roster
            await tx.tradeBlockEntry.deleteMany({
                where: { leagueId, playerId: entry.playerId },
            });
        });

        await revalidateLeague(leagueId);
        return { success: true };
    } catch (error: any) {
        console.error('Failed to drop player:', error);
        return { success: false, error: error.message };
    }
}
