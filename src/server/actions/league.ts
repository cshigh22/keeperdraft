'use server';

import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { CommissionerService } from '@/services/commissioner.service';
import { DEFAULT_IR_SLOT_COUNT } from '@/lib/roster-restrictions';
import type { DraftType } from '@prisma/client';

// ============================================================================
// TYPES & HELPERS
// ============================================================================

interface CreateLeagueState {
    message?: string;
    errors?: {
        name?: string[];
        maxTeams?: string[];
        draftType?: string[];
        maxKeepers?: string[];
        roster?: string[];
    };
}

interface UpdateLeagueState {
    success?: boolean;
    message?: string;
}

const ROSTER_COUNT_FIELDS = [
    'qbCount',
    'rbCount',
    'wrCount',
    'teCount',
    'flexCount',
    'superflexCount',
    'kCount',
    'defCount',
    'benchCount',
] as const;

type RosterCounts = Record<(typeof ROSTER_COUNT_FIELDS)[number], number>;

function parseIntField(formData: FormData, field: string, fallback: number = 0): number {
    return parseInt(formData.get(field) as string) || fallback;
}

function parseRosterCounts(formData: FormData): RosterCounts {
    return Object.fromEntries(
        ROSTER_COUNT_FIELDS.map((field) => [field, parseIntField(formData, field)])
    ) as RosterCounts;
}

// Not parseIntField: an explicit 0 (IR spots disabled) must survive, and 0 is
// falsy so `|| fallback` would silently turn it back into the default.
function parseIrSlotCount(formData: FormData): number {
    const parsed = parseInt(formData.get('irSlotCount') as string);
    return Number.isNaN(parsed) ? DEFAULT_IR_SLOT_COUNT : Math.max(0, parsed);
}

// Total rounds = roster spots minus keeper slots (keepers are excluded from the draft board)
function calculateTotalRounds(rosterCounts: RosterCounts, maxKeepers: number): number {
    const totalRosterSize = Object.values(rosterCounts).reduce((sum, count) => sum + count, 0);
    return Math.max(1, totalRosterSize - maxKeepers);
}

// Regenerates draft picks for the current team order. Must run OUTSIDE any
// transaction: CommissionerService.setDraftOrder uses the global prisma client
// and needs to see committed league/team/settings rows.
async function regeneratePicksInDraftOrder(leagueId: string): Promise<void> {
    const teams = await prisma.team.findMany({
        where: { leagueId },
        orderBy: { draftPosition: 'asc' },
    });

    if (teams.length > 0) {
        await CommissionerService.setDraftOrder({
            leagueId,
            teamOrderList: teams.map((t) => t.id),
        });
    }
}

// ============================================================================
// CREATE LEAGUE
// ============================================================================

export async function createLeague(prevState: CreateLeagueState, formData: FormData): Promise<CreateLeagueState> {
    const name = formData.get('name') as string;
    const maxTeams = parseIntField(formData, 'maxTeams', 12);
    const draftType = ((formData.get('draftType') as string) || 'SNAKE') as 'LINEAR' | 'SNAKE';
    const maxKeepers = parseIntField(formData, 'maxKeepers');
    const irSlotCount = parseIrSlotCount(formData);
    const rosterCounts = parseRosterCounts(formData);

    // Validation
    const errors: CreateLeagueState['errors'] = {};
    if (!name?.trim()) errors.name = ['League name is required'];
    if (isNaN(maxTeams) || maxTeams < 4 || maxTeams > 32) errors.maxTeams = ['Teams must be between 4 and 32'];
    if (!['LINEAR', 'SNAKE'].includes(draftType)) errors.draftType = ['Invalid draft type'];
    if (isNaN(maxKeepers) || maxKeepers < 0) errors.maxKeepers = ['Keepers cannot be negative'];

    if (Object.keys(errors).length > 0) {
        return { errors };
    }

    const totalRounds = calculateTotalRounds(rosterCounts, maxKeepers);

    let leagueId: string | undefined;

    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { message: 'You must be logged in to create a league.' };
        }
        const userId = session.user.id;

        // VERIFY USER EXISTS IN DB (Prevents FK violation if session is stale/mock)
        const userExists = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!userExists) {
            console.error(`User ID ${userId} from session not found in database.`);
            return {
                message: 'Your session is valid but your user record was not found in the database. Please sign out and sign back in to refresh your account.'
            };
        }

        leagueId = await prisma.$transaction(async (tx) => {
            // 1. Create League with settings and initial draft state
            const league = await tx.league.create({
                data: {
                    name,
                    maxTeams,
                    season: new Date().getFullYear(),
                    commissionerId: userId,
                    draftSettings: {
                        create: {
                            draftType,
                            maxKeepers,
                            irSlotCount,
                            ...rosterCounts,
                            totalRounds,
                            timerDurationSeconds: 90,
                        },
                    },
                    draftState: {
                        create: {
                            status: 'NOT_STARTED',
                            currentRound: 1,
                            currentPick: 1,
                        }
                    }
                },
            });

            // 2. Create Commissioner Team
            await tx.team.create({
                data: {
                    name: 'Commissioner Team',
                    leagueId: league.id,
                    ownerId: userId,
                    draftPosition: 1,
                },
            });

            // 3. Create Placeholder Teams
            if (maxTeams > 1) {
                await tx.team.createMany({
                    data: Array.from({ length: maxTeams - 1 }, (_, i) => ({
                        name: `Team ${i + 2}`,
                        leagueId: league.id,
                        ownerId: null,
                        draftPosition: i + 2,
                    })),
                });
            }

            // 4. Add to League Members
            await tx.leagueMember.create({
                data: {
                    userId,
                    leagueId: league.id,
                    role: 'COMMISSIONER',
                },
            });

            return league.id;
        }, {
            timeout: 15000 // Increase timeout to 15s to be safe
        });

        // 5. Generate draft picks (outside the transaction — see helper note)
        await regeneratePicksInDraftOrder(leagueId);

    } catch (error) {
        console.error('Failed to create league:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return { message: `Failed to create league: ${errorMessage}. Please try again.` };
    }

    redirect(`/leagues/${leagueId}`);
}

// ============================================================================
// INVITES & MEMBERSHIP
// ============================================================================

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export async function generateInvite(leagueId: string) {
    const session = await auth();
    if (!session?.user?.id) throw new Error('Unauthorized');

    const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { commissionerId: true }
    });

    if (league?.commissionerId !== session.user.id) {
        throw new Error('Only the commissioner can generate invites');
    }

    // A fresh token every time: invites are single-use, so handing out the same
    // one twice would leave the second person unable to join.
    const invite = await prisma.leagueInvite.create({
        data: {
            leagueId,
            token: randomBytes(18).toString('base64url'),
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        }
    });

    return invite.token;
}

// Redeems a single-use invite. Called from a form submission rather than on page
// load, so merely visiting a link — or being made to visit one — cannot burn an
// invite or add someone to a league.
export async function joinLeague(token: string) {
    const session = await auth();
    if (!session?.user?.id) {
        redirect(`/login?callbackUrl=/join/${token}`);
    }
    const userId = session.user.id;
    const userName = session.user.name;

    const invite = await prisma.leagueInvite.findUnique({
        where: { token },
        select: { id: true, leagueId: true, expiresAt: true, usedAt: true }
    });

    if (!invite || invite.expiresAt < new Date()) {
        throw new Error('Invalid or expired invite');
    }

    // Already a member? Just go to the league, leaving the invite unspent
    const existingMember = await prisma.leagueMember.findUnique({
        where: { userId_leagueId: { userId, leagueId: invite.leagueId } }
    });

    if (existingMember) {
        redirect(`/leagues/${invite.leagueId}`);
    }

    if (invite.usedAt) {
        throw new Error('This invite has already been used');
    }

    await prisma.$transaction(async (tx) => {
        // Claim the invite first. The usedAt filter makes this a no-op for
        // everyone but the winner if two people redeem the same link at once.
        const claimedInvite = await tx.leagueInvite.updateMany({
            where: { id: invite.id, usedAt: null },
            data: { usedAt: new Date(), usedByUserId: userId }
        });

        if (claimedInvite.count === 0) {
            throw new Error('This invite has already been used');
        }

        const emptyTeam = await tx.team.findFirst({
            where: { leagueId: invite.leagueId, ownerId: null },
            orderBy: { draftPosition: 'asc' }
        });

        if (!emptyTeam) {
            throw new Error('League is full');
        }

        // Same guard on the team slot, for the same reason
        const claimedTeam = await tx.team.updateMany({
            where: { id: emptyTeam.id, ownerId: null },
            data: { ownerId: userId, name: `${userName}'s Team` }
        });

        if (claimedTeam.count === 0) {
            throw new Error('That team slot was just taken — please try again');
        }

        await tx.leagueMember.create({
            data: { userId, leagueId: invite.leagueId, role: 'MEMBER' }
        });
    });

    redirect(`/leagues/${invite.leagueId}`);
}

// ============================================================================
// UPDATE LEAGUE
// ============================================================================

export async function updateLeague(
    leagueId: string,
    prevState: UpdateLeagueState | null,
    formData: FormData
): Promise<UpdateLeagueState> {
    const session = await auth();
    if (!session?.user?.id) {
        return { message: 'Unauthorized' };
    }

    const name = formData.get('name') as string;
    const draftType = formData.get('draftType') as DraftType;
    const maxKeepers = parseIntField(formData, 'maxKeepers');
    const irSlotCount = parseIrSlotCount(formData);
    const rosterCounts = parseRosterCounts(formData);
    const timerDurationSeconds = parseIntField(formData, 'timerDurationSeconds', 90);

    try {
        const league = await prisma.league.findUnique({
            where: { id: leagueId },
            include: { draftState: true }
        });

        if (!league || league.commissionerId !== session.user.id) {
            return { message: 'Unauthorized or League not found' };
        }

        const totalRounds = calculateTotalRounds(rosterCounts, maxKeepers);

        await prisma.$transaction(async (tx) => {
            await tx.league.update({
                where: { id: leagueId },
                data: { name }
            });

            await tx.draftSettings.update({
                where: { leagueId },
                data: {
                    draftType,
                    maxKeepers,
                    irSlotCount,
                    ...rosterCounts,
                    totalRounds,
                    timerDurationSeconds,
                }
            });
        });

        // Regenerate picks AFTER the transaction commits so setDraftOrder reads
        // the newly committed totalRounds value from the database
        if (league.draftState?.status === 'NOT_STARTED') {
            await regeneratePicksInDraftOrder(leagueId);
        }

        return { success: true, message: 'League updated successfully' };
    } catch (error) {
        console.error('Update league failed:', error);
        return { message: 'Failed to update league' };
    }
}

// ============================================================================
// DELETE LEAGUE
// ============================================================================

export async function deleteLeague(leagueId: string): Promise<UpdateLeagueState> {
    const session = await auth();
    if (!session?.user?.id) {
        return { message: 'Unauthorized' };
    }

    try {
        const league = await prisma.league.findUnique({
            where: { id: leagueId },
            select: { commissionerId: true },
        });

        if (!league || league.commissionerId !== session.user.id) {
            return { message: 'Only the commissioner can delete this league' };
        }

        // DraftActivityLog references the league by plain string (no FK), so it
        // must be cleaned up explicitly; every other relation cascades in the DB.
        await prisma.$transaction([
            prisma.draftActivityLog.deleteMany({ where: { leagueId } }),
            prisma.league.delete({ where: { id: leagueId } }),
        ]);

        revalidatePath('/leagues');
        return { success: true };
    } catch (error) {
        console.error('Delete league failed:', error);
        return { message: 'Failed to delete league' };
    }
}
