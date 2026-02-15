'use server';

import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';

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

export async function createLeague(prevState: CreateLeagueState, formData: FormData): Promise<CreateLeagueState> {
    const name = formData.get('name') as string;
    const maxTeamsStr = formData.get('maxTeams') as string;
    const maxTeams = parseInt(maxTeamsStr) || 12;
    const draftType = (formData.get('draftType') as string || 'SNAKE') as 'LINEAR' | 'SNAKE';
    const maxKeepersStr = formData.get('maxKeepers') as string;
    const maxKeepers = parseInt(maxKeepersStr) || 0;

    // Roster settings
    const qbCount = parseInt(formData.get('qbCount') as string) || 0;
    const rbCount = parseInt(formData.get('rbCount') as string) || 0;
    const wrCount = parseInt(formData.get('wrCount') as string) || 0;
    const teCount = parseInt(formData.get('teCount') as string) || 0;
    const flexCount = parseInt(formData.get('flexCount') as string) || 0;
    const superflexCount = parseInt(formData.get('superflexCount') as string) || 0;
    const kCount = parseInt(formData.get('kCount') as string) || 0;
    const defCount = parseInt(formData.get('defCount') as string) || 0;
    const benchCount = parseInt(formData.get('benchCount') as string) || 0;

    // Validation
    const errors: CreateLeagueState['errors'] = {};
    if (!name?.trim()) errors.name = ['League name is required'];
    if (isNaN(maxTeams) || maxTeams < 4 || maxTeams > 32) errors.maxTeams = ['Teams must be between 4 and 32'];
    if (!['LINEAR', 'SNAKE'].includes(draftType)) errors.draftType = ['Invalid draft type'];
    if (isNaN(maxKeepers) || maxKeepers < 0) errors.maxKeepers = ['Keepers cannot be negative'];

    if (Object.keys(errors).length > 0) {
        return { errors };
    }

    // Calculate total rounds: roster spots minus keeper slots (keepers are excluded from the draft board)
    const totalRosterSize = qbCount + rbCount + wrCount + teCount + flexCount + superflexCount + kCount + defCount + benchCount;
    const totalRounds = Math.max(1, totalRosterSize - maxKeepers);

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

        // Use a longer timeout for the transaction if needed, but standard should be fine with batching
        const leagueId = await prisma.$transaction(async (tx) => {
            // 1. Create League
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
                            qbCount,
                            rbCount,
                            wrCount,
                            teCount,
                            flexCount,
                            superflexCount,
                            kCount,
                            defCount,
                            benchCount,
                            totalRounds,
                            timerDurationSeconds: 90,
                        },
                    },
                    // Initialize DraftState as well
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
            const commTeam = await tx.team.create({
                data: {
                    name: 'Commissioner Team',
                    leagueId: league.id,
                    ownerId: userId,
                    draftPosition: 1,
                },
            });

            // 3. Create Placeholder Teams
            const placeholderTeamsData = [];
            for (let i = 2; i <= maxTeams; i++) {
                placeholderTeamsData.push({
                    name: `Team ${i}`,
                    leagueId: league.id,
                    ownerId: null,
                    draftPosition: i,
                });
            }

            if (placeholderTeamsData.length > 0) {
                await tx.team.createMany({
                    data: placeholderTeamsData
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

            // 5. Generate Draft Picks
            const allTeams = await tx.team.findMany({
                where: { leagueId: league.id },
                orderBy: { draftPosition: 'asc' },
            });

            const teamMap = new Map(allTeams.map(t => [t.draftPosition, t.id]));
            const dbPicks = [];

            for (let r = 1; r <= totalRounds; r++) {
                for (let p = 1; p <= maxTeams; p++) {
                    const overallPickNumber = (r - 1) * maxTeams + p;

                    let ownerPos = p;
                    if (draftType === 'SNAKE' && r % 2 === 0) {
                        ownerPos = maxTeams - p + 1;
                    }

                    const ownerId = teamMap.get(ownerPos);
                    if (!ownerId) throw new Error(`Could not find team for draft position ${ownerPos}`);

                    dbPicks.push({
                        leagueId: league.id,
                        season: league.season,
                        round: r,
                        pickInRound: p,
                        overallPickNumber,
                        originalOwnerId: ownerId,
                        currentOwnerId: ownerId,
                        isComplete: false,
                    });
                }
            }

            await tx.draftPick.createMany({
                data: dbPicks,
            });

            return league.id;
        }, {
            timeout: 15000 // Increase timeout to 15s to be safe
        });

    } catch (error) {
        console.error('Failed to create league:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return { message: `Failed to create league: ${errorMessage}. Please try again.` };
    }

    redirect('/leagues');
}

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

    // Existing token check?
    const existing = await prisma.leagueInvite.findFirst({
        where: { leagueId, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' }
    });

    if (existing) return existing.token;

    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const invite = await prisma.leagueInvite.create({
        data: {
            leagueId,
            token,
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
        }
    });

    return invite.token;
}

export async function joinLeague(token: string) {
    const session = await auth();
    if (!session?.user?.id) {
        redirect(`/login?callbackUrl=/join/${token}`);
    }
    const userId = session.user.id;

    const invite = await prisma.leagueInvite.findUnique({
        where: { token },
        include: { league: true }
    });

    if (!invite || invite.expiresAt < new Date()) {
        throw new Error('Invalid or expired invite');
    }

    // Check if user is already a member
    const existingMember = await prisma.leagueMember.findUnique({
        where: { userId_leagueId: { userId, leagueId: invite.leagueId } }
    });

    if (existingMember) {
        redirect(`/leagues/${invite.leagueId}`);
    }

    // Find first empty team (no owner assigned yet)
    const emptyTeam = await prisma.team.findFirst({
        where: {
            leagueId: invite.leagueId,
            ownerId: null,
        },
        orderBy: { draftPosition: 'asc' }
    });

    if (!emptyTeam) {
        throw new Error('League is full');
    }

    await prisma.$transaction([
        prisma.leagueMember.create({
            data: {
                userId,
                leagueId: invite.leagueId,
                role: 'MEMBER'
            }
        }),
        prisma.team.update({
            where: { id: emptyTeam.id },
            data: {
                ownerId: userId,
                name: `${session.user.name}'s Team`
            }
        })
    ]);

    redirect(`/leagues/${invite.leagueId}`);
}
export async function updateLeague(leagueId: string, prevState: any, formData: FormData) {
    const session = await auth();
    if (!session?.user?.id) {
        return { message: 'Unauthorized' };
    }

    const name = formData.get('name') as string;
    const draftType = formData.get('draftType') as any;
    const maxKeepers = parseInt(formData.get('maxKeepers') as string) || 0;
    const qbCount = parseInt(formData.get('qbCount') as string) || 0;
    const rbCount = parseInt(formData.get('rbCount') as string) || 0;
    const wrCount = parseInt(formData.get('wrCount') as string) || 0;
    const teCount = parseInt(formData.get('teCount') as string) || 0;
    const flexCount = parseInt(formData.get('flexCount') as string) || 0;
    const superflexCount = parseInt(formData.get('superflexCount') as string) || 0;
    const kCount = parseInt(formData.get('kCount') as string) || 0;
    const defCount = parseInt(formData.get('defCount') as string) || 0;
    const benchCount = parseInt(formData.get('benchCount') as string) || 0;
    const timerDurationSeconds = parseInt(formData.get('timerDurationSeconds') as string) || 90;

    try {
        const league = await prisma.league.findUnique({
            where: { id: leagueId },
            include: { draftState: true }
        });

        if (!league || league.commissionerId !== session.user.id) {
            return { message: 'Unauthorized or League not found' };
        }

        // Calculate total rounds: roster spots minus keeper slots
        const totalRosterSize = qbCount + rbCount + wrCount + teCount + flexCount + superflexCount + kCount + defCount + benchCount;
        const totalRounds = Math.max(1, totalRosterSize - maxKeepers);

        await prisma.$transaction(async (tx) => {
            // Update League name
            await tx.league.update({
                where: { id: leagueId },
                data: { name }
            });

            // Update Draft Settings
            // We use the service logic but within this transaction if possible, 
            // but since services usually use the global prisma, we'll just do it here.
            await tx.draftSettings.update({
                where: { leagueId },
                data: {
                    draftType,
                    maxKeepers,
                    qbCount,
                    rbCount,
                    wrCount,
                    teCount,
                    flexCount,
                    superflexCount,
                    kCount,
                    defCount,
                    benchCount,
                    totalRounds,
                    timerDurationSeconds,
                }
            });

            // If draft hasn't started, regenerate picks to reflect new settings/type
            if (league.draftState?.status === 'NOT_STARTED') {
                // Delete existing picks
                await tx.draftPick.deleteMany({
                    where: { leagueId }
                });

                // Get teams to map positions
                const allTeams = await tx.team.findMany({
                    where: { leagueId },
                    orderBy: { draftPosition: 'asc' },
                });

                const teamMap = new Map(allTeams.map(t => [t.draftPosition, t.id]));
                const maxTeams = allTeams.length;
                const dbPicks = [];

                for (let r = 1; r <= totalRounds; r++) {
                    for (let p = 1; p <= maxTeams; p++) {
                        const overallPickNumber = (r - 1) * maxTeams + p;

                        let ownerPos = p;
                        if (draftType === 'SNAKE' && r % 2 === 0) {
                            ownerPos = maxTeams - p + 1;
                        }

                        const ownerId = teamMap.get(ownerPos);
                        if (!ownerId) continue; // Should not happen

                        dbPicks.push({
                            leagueId: league.id,
                            season: league.season,
                            round: r,
                            pickInRound: p,
                            overallPickNumber,
                            originalOwnerId: ownerId,
                            currentOwnerId: ownerId,
                            isComplete: false,
                        });
                    }
                }

                if (dbPicks.length > 0) {
                    await tx.draftPick.createMany({
                        data: dbPicks,
                    });
                }
            }
        });

        return { success: true, message: 'League updated successfully' };
    } catch (error) {
        console.error('Update league failed:', error);
        return { message: 'Failed to update league' };
    }
}
