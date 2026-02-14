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
    const maxTeams = parseInt(formData.get('maxTeams') as string);
    const draftType = formData.get('draftType') as 'LINEAR' | 'SNAKE';
    const maxKeepers = parseInt(formData.get('maxKeepers') as string);

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
    if (!name) errors.name = ['League name is required'];
    if (!maxTeams || maxTeams < 4 || maxTeams > 32) errors.maxTeams = ['Teams must be between 4 and 32'];
    if (!['LINEAR', 'SNAKE'].includes(draftType)) errors.draftType = ['Invalid draft type'];
    if (maxKeepers < 0) errors.maxKeepers = ['Keepers cannot be negative'];

    if (Object.keys(errors).length > 0) {
        return { errors };
    }

    // Calculate total rounds
    const totalRosterSize = qbCount + rbCount + wrCount + teCount + flexCount + superflexCount + kCount + defCount + benchCount;
    // If roster size is 0 (unlikely but possible if user sets all to 0), default to something safe or error?
    // User asked for 0 to be an option, but a league with 0 roster spots seems odd. We'll assume at least 1 spot or just let it be.
    // Standard logic: rounds = roster size.
    const totalRounds = Math.max(1, totalRosterSize);

    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { message: 'You must be logged in to create a league.' };
        }
        const userId = session.user.id;

        // Transaction to create everything
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
                            // Roster settings
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
                            timerDurationSeconds: 90, // Default
                        },
                    },
                },
            });

            // 2. Create Commissioner Team
            const team = await tx.team.create({
                data: {
                    name: 'Commissioner Team',
                    leagueId: league.id,
                    ownerId: userId,
                    draftPosition: 1, // Default to first pick
                },
            });

            // 3. Add to League Members
            await tx.leagueMember.create({
                data: {
                    userId,
                    leagueId: league.id,
                    role: 'COMMISSIONER',
                },
            });

            // 4. Create placeholder teams for remaining slots
            for (let i = 2; i <= maxTeams; i++) {
                await tx.team.create({
                    data: {
                        name: `Team ${i}`,
                        leagueId: league.id,
                        ownerId: null, // No owner until someone joins via invite
                        draftPosition: i,
                    },
                });
            }

            // 5. Generate Draft Picks
            const picks = [];
            for (let r = 1; r <= totalRounds; r++) {
                for (let p = 1; p <= maxTeams; p++) {
                    // Calculate overall pick
                    // Draft type only affects WHO picks, not the pick number itself in linear storage.
                    // But `originalOwner` needs to be correct.
                    // Linear: Round 1: 1..10, Round 2: 1..10
                    // Snake: Round 1: 1..10, Round 2: 10..1

                    let ownerDraftPosition = p;
                    if (draftType === 'SNAKE' && r % 2 === 0) {
                        ownerDraftPosition = maxTeams - p + 1;
                    }

                    // We need to find the team with this draft position.
                    // Since we just created teams with draftPosition 1..maxTeams, we can find them.
                    // NOTE: We can't query `tx.team` easily here because we just created them.
                    // But we know their creation order or properties.
                    // Actually, we can fetch them back or rely on deterministic creation.
                    // Let's fetch them all to be safe.
                    // Optimization: We know we created teams with draftPosition = i.
                }
            }

            // Fetch all teams we just created
            const allTeams = await tx.team.findMany({
                where: { leagueId: league.id },
                orderBy: { draftPosition: 'asc' },
            });

            const dbPicks = [];
            const teamMap = new Map(allTeams.map(t => [t.draftPosition, t.id]));

            for (let r = 1; r <= totalRounds; r++) {
                for (let p = 1; p <= maxTeams; p++) {
                    const overallPickNumber = (r - 1) * maxTeams + p;

                    let ownerPos = p;
                    if (draftType === 'SNAKE' && r % 2 === 0) {
                        ownerPos = maxTeams - p + 1;
                    }

                    const ownerId = teamMap.get(ownerPos as number);
                    if (!ownerId) throw new Error(`Could not find team for position ${ownerPos}`);

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
        });

    } catch (error) {
        console.error('Failed to create league:', error instanceof Error ? error.message : error);
        console.error('Full error:', error);
        return { message: 'Failed to create league. Please try again.' };
    }

    redirect('/leagues'); // Redirect to leagues list
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
