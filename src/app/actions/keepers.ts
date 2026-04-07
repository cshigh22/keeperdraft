'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { KeeperService, KeeperSelection } from '@/services/keeper.service';
import { revalidateLeague } from './league';

const keeperService = new KeeperService();

async function requireTeamAccess(teamId: string, leagueId: string) {
    const session = await auth();
    if (!session?.user?.id) throw new Error('Unauthorized');

    const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { ownerId: true, leagueId: true },
    });

    if (!team || team.leagueId !== leagueId) throw new Error('Team not found');

    const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { commissionerId: true },
    });

    const isOwner = team.ownerId === session.user.id;
    const isCommissioner = league?.commissionerId === session.user.id;

    if (!isOwner && !isCommissioner) {
        throw new Error('Unauthorized to access this team');
    }

    return session;
}

export async function getPotentialKeepers(teamId: string, leagueId: string) {
    try {
        await requireTeamAccess(teamId, leagueId);
        const keepers = await keeperService.getPotentialKeepers(teamId, leagueId);
        return { success: true, data: keepers };
    } catch (error: any) {
        console.error('Failed to get potential keepers:', error);
        return { success: false, error: error.message };
    }
}

export async function saveKeepers(teamId: string, leagueId: string, selections: KeeperSelection[]) {
    try {
        await requireTeamAccess(teamId, leagueId);
        await keeperService.saveKeepers(teamId, leagueId, selections);
        await revalidateLeague(leagueId);
        return { success: true };
    } catch (error: any) {
        console.error('Failed to save keepers:', error);
        return { success: false, error: error.message };
    }
}
