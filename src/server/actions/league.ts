'use server';

import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';

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
        // Determine the user ID - for now we'll create a dummy user or use a fixed ID since auth is mocked.
        // In a real app we'd get the session user.
        // For this implementation, we will check if a user with email 'commissioner@example.com' exists, if not create one.
        // This is a placeholder for actual auth integration.

        let user = await prisma.user.findUnique({ where: { email: 'commissioner@example.com' } });
        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: 'commissioner@example.com',
                    name: 'League Commissioner',
                    passwordHash: 'placeholder', // In real app this would be hashed
                    isAdmin: true,
                },
            });
        }
        const userId = user.id;

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

            // 4. Create other placeholder teams to fill the league
            for (let i = 2; i <= maxTeams; i++) {
                // Create dummy users for other teams for now, or just placeholder teams?
                // The requirement says "create the league". Usually other users join later.
                // But `DraftStateManager` expects `maxTeams` to match `teams.length`?
                // Actually `state.draftOrder` comes from `teams`. If we only have 1 team, draft order is 1 team.
                // But `DraftPick` generation needs to know the number of teams.
                // Let's create placeholder teams so the draft structure is valid immediately.

                /* 
                   Wait, usually users join via invite.
                   But to "set up the league... including amount of players", we might need to reserve spots.
                   For this MVP, let's just create the commissioner's team.
                   The Draft Picks generation depends on knowing the final number of teams.
                   Common practice: Generate picks only when league is full or upon "Finalize Teams" action.
                   However, the prompt says "commissioner should... set up... including amount of players".
                   And the implementation plan said: "**Generate empty `DraftPick` records** based on `maxTeams`".
                   
                   If we generate picks for 10 teams but only 1 exists, who owns the other picks?
                   We probably need placeholder teams or "Empty Slots".
                   Let's create placeholder teams owned by the commissioner or a system user for now to make the draft board visualizable.
                */

                await tx.team.create({
                    data: {
                        name: `Team ${i}`,
                        leagueId: league.id,
                        ownerId: userId, // Temporarily owned by commissioner
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

        // TODO: Set cookie for session persistence since we're using mock auth
        // In a real server action we can't easily set client-side cookies/localstorage.
        // We'll rely on the redirect and the client handling the new league ID.
        // For the "Mock Session", the user usually manually sets it.
        // We might need to handle this in the UI after redirect, or assume the user is already "logged in" as commissioner.

    } catch (error) {
        console.error('Failed to create league:', error);
        return { message: 'Failed to create league. Please try again.' };
    }

    redirect('/draft'); // Redirect to draft room
}
