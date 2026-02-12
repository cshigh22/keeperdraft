'use server';

import { KeeperService, KeeperSelection } from '@/services/keeper.service';

// Assuming mock session or actual session
// If using mock session from client, we need to pass userId. 
// But ideally server actions should verify session.
// For now, let's accept userId/teamId as arguments, but in prod we'd get them from session.
// Wait, the existing code uses a mock session on the client.
// So let's accept teamId and leagueId.

const keeperService = new KeeperService();

export async function getPotentialKeepers(teamId: string, leagueId: string) {
    try {
        const keepers = await keeperService.getPotentialKeepers(teamId, leagueId);
        return { success: true, data: keepers };
    } catch (error: any) {
        console.error('Failed to get potential keepers:', error);
        return { success: false, error: error.message };
    }
}

export async function saveKeepers(teamId: string, leagueId: string, selections: KeeperSelection[]) {
    try {
        await keeperService.saveKeepers(teamId, leagueId, selections);
        return { success: true };
    } catch (error: any) {
        console.error('Failed to save keepers:', error);
        return { success: false, error: error.message };
    }
}
