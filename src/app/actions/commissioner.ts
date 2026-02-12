'use server';

import { CommissionerService, DraftSettingsInput } from '@/services/commissioner.service';

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
        return { success: true };
    } catch (error: any) {
        console.error('Failed to update draft settings:', error);
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
