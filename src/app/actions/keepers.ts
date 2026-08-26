'use server';

import { KeeperService, KeeperSelection } from '@/services/keeper.service';
import { requireTeamAccess } from '@/lib/team-access';
import { revalidateLeague } from './league';

const keeperService = new KeeperService();

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
