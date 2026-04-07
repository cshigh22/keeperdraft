'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { CommissionerService, DraftSettingsInput } from '@/services/commissioner.service';
import { updateRankingsFromFantasyCalc } from '@/lib/fantasycalc-api';
import { revalidateLeague } from './league';

async function requireCommissioner(leagueId: string) {
    const session = await auth();
    if (!session?.user?.id) throw new Error('Unauthorized');

    const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { commissionerId: true },
    });

    if (!league) throw new Error('League not found');
    if (league.commissionerId !== session.user.id) {
        throw new Error('Only the commissioner can perform this action');
    }

    return session;
}

export async function updateDraftSettingsAction(input: any) {
    try {
        if (!input.leagueId) return { success: false, error: 'Missing leagueId' };
        await requireCommissioner(input.leagueId);

        // Convert string dates if necessary (e.g. from JSON)
        const settings: DraftSettingsInput = { ...input };

        if (input.keeperDeadline && typeof input.keeperDeadline === 'string') {
            settings.keeperDeadline = new Date(input.keeperDeadline);
        }
        if (input.scheduledStartTime && typeof input.scheduledStartTime === 'string') {
            settings.scheduledStartTime = new Date(input.scheduledStartTime);
        }

        await CommissionerService.updateDraftSettings(settings);
        await revalidateLeague(input.leagueId);
        return { success: true };
    } catch (error: any) {
        console.error('Failed to update draft settings:', error);
        return { success: false, error: error.message };
    }
}

export async function setDraftOrderAction(leagueId: string, teamOrderList: string[]) {
    try {
        await requireCommissioner(leagueId);
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
        await requireCommissioner(leagueId);
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
        await requireCommissioner(leagueId);
        await CommissionerService.manuallyAssignPickOwner(leagueId, pickId, newOwnerId);
        return { success: true };
    } catch (error: any) {
        console.error('Failed to manually assign pick owner:', error);
        return { success: false, error: error.message };
    }
}

export async function getDraftSettingsAction(leagueId: string) {
    try {
        const session = await auth();
        if (!session?.user?.id) throw new Error('Unauthorized');

        const settings = await CommissionerService.getDraftSettings(leagueId);
        return { success: true, data: settings };
    } catch (error: any) {
        console.error('Failed to get draft settings:', error);
        return { success: false, error: error.message };
    }
}

export async function updatePlayerRankingsAction(leagueId: string) {
    try {
        await requireCommissioner(leagueId);
        const result = await updateRankingsFromFantasyCalc(false, 1, 12);
        return {
            success: result.success,
            data: {
                totalFetched: result.totalFetched,
                matched: result.matched,
                updated: result.updated,
                unmatched: result.unmatched,
            },
            errors: result.errors,
        };
    } catch (error: any) {
        console.error('Failed to update player rankings:', error);
        return { success: false, error: error.message };
    }
}
