'use server';

import { CommissionerService, DraftSettingsInput } from '@/services/commissioner.service';
import { revalidateLeague } from './league';

export async function updateDraftSettingsAction(input: any) {
    try {
        // Convert string dates if necessary (e.g. from JSON)
        const settings: DraftSettingsInput = { ...input };

        if (input.keeperDeadline && typeof input.keeperDeadline === 'string') {
            settings.keeperDeadline = new Date(input.keeperDeadline);
        }
        if (input.scheduledStartTime && typeof input.scheduledStartTime === 'string') {
            settings.scheduledStartTime = new Date(input.scheduledStartTime);
        }

        await CommissionerService.updateDraftSettings(settings);
        if (input.leagueId) {
            await revalidateLeague(input.leagueId);
        }
        return { success: true };
    } catch (error: any) {
        console.error('Failed to update draft settings:', error);
        return { success: false, error: error.message };
    }
}

export async function setDraftOrderAction(leagueId: string, teamOrderList: string[]) {
    try {
        const result = await CommissionerService.setDraftOrder({ leagueId, teamOrderList });
        await revalidateLeague(leagueId);
        return { success: true, data: result };
    } catch (error: any) {
        console.error('Failed to set draft order:', error);
        return { success: false, error: error.message };
    }
}

export async function randomizeDraftOrderAction(leagueId: string) {
    try {
        const result = await CommissionerService.randomizeDraftOrder(leagueId);
        await revalidateLeague(leagueId);
        return { success: true, data: result };
    } catch (error: any) {
        console.error('Failed to randomize draft order:', error);
        return { success: false, error: error.message };
    }
}

export async function manuallyAssignPickOwnerAction(leagueId: string, pickId: string, newOwnerId: string) {
    try {
        await CommissionerService.manuallyAssignPickOwner(leagueId, pickId, newOwnerId);
        return { success: true };
    } catch (error: any) {
        console.error('Failed to manually assign pick owner:', error);
        return { success: false, error: error.message };
    }
}

export async function getDraftSettingsAction(leagueId: string) {
    try {
        const settings = await CommissionerService.getDraftSettings(leagueId);
        return { success: true, data: settings };
    } catch (error: any) {
        console.error('Failed to get draft settings:', error);
        return { success: false, error: error.message };
    }
}
