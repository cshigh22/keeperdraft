'use server';

import { prisma } from './prisma';
import { auth } from '@/auth';

export async function getTeamsByLeague(leagueId: string = 'demo-league') {
    try {
        const [league, teams] = await Promise.all([
            prisma.league.findUnique({
                where: { id: leagueId },
                select: { commissionerId: true }
            }),
            prisma.team.findMany({
                where: { leagueId },
                include: {
                    owner: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                        },
                    },
                },
                orderBy: {
                    draftPosition: 'asc',
                },
            })
        ]);

        return teams.map((team) => ({
            id: team.id,
            name: team.name,
            ownerId: team.ownerId,
            ownerName: team.owner?.name || team.owner?.email || 'Open Slot',
            isCommissioner: team.ownerId === league?.commissionerId,
        }));
    } catch (error) {
        console.error('Error fetching teams:', error);
        return [];
    }
}

export async function getLeagueInfo(leagueId: string = 'demo-league') {
    try {
        const league = await prisma.league.findUnique({
            where: { id: leagueId },
            include: {
                _count: {
                    select: {
                        teams: true,
                        draftPicks: true,
                    },
                },
            },
        });
        return league;
    } catch (error) {
        console.error('Error fetching league info:', error);
        return null;
    }
}

export async function getMyTeam(leagueId: string) {
    try {
        const session = await auth();
        if (!session?.user?.id) return null;

        const team = await prisma.team.findFirst({
            where: {
                leagueId,
                ownerId: session.user.id,
            },
        });

        if (!team) return null;

        const league = await prisma.league.findUnique({
            where: { id: leagueId },
            select: { commissionerId: true }
        });

        return {
            ...team,
            isCommissioner: team.ownerId === league?.commissionerId,
        };
    } catch (error) {
        console.error('Error fetching my team:', error);
        return null;
    }
}
