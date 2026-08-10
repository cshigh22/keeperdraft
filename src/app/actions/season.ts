'use server';

import { rolloverSeason } from '@/services/season-rollover.service';
import { requireCommissioner } from './commissioner';
import { revalidateLeague } from './league';

export interface StartNewSeasonInput {
  leagueId: string;
  expectedSeason: number;
  championManagerName?: string;
  championTeamName?: string;
}

export async function startNewSeasonAction(input: StartNewSeasonInput) {
  try {
    if (!input.leagueId) return { success: false as const, error: 'Missing leagueId' };
    await requireCommissioner(input.leagueId);

    const result = await rolloverSeason(input);
    await revalidateLeague(input.leagueId);

    return { success: true as const, ...result };
  } catch (error: any) {
    console.error('Failed to start new season:', error);
    return { success: false as const, error: error.message };
  }
}
