'use server';

import { revalidatePath } from 'next/cache';

export async function revalidateLeague(leagueId: string) {
    revalidatePath(`/leagues/${leagueId}`);
    revalidatePath('/leagues');
}
