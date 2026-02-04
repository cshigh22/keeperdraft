'use server';

import { prisma } from './prisma';

export async function getTeamsByLeague(leagueId: string = 'demo-league') {
    try {
        const teams = await prisma.team.findMany({
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
        });

        return teams.map((team) => ({
            id: team.id,
            name: team.name,
            ownerId: team.ownerId,
            ownerName: team.owner.name,
            isCommissioner: team.owner.email === 'commissioner@demo.com', // Simplified for demo
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
