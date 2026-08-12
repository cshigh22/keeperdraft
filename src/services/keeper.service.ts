
import { prisma } from '@/lib/prisma';

export type KeeperSelection = {
    playerId: string;
    keeperRound: number | null;
};

export class KeeperService {
    /**
     * Get all players on a team's roster that are eligible to be keepers.
     * By default, all players are eligible, but we can add logic here for tenure, etc.
     */
    async getPotentialKeepers(teamId: string, leagueId: string) {
        // 1. Get current roster
        // 2. Get draft settings for validation rules (max keepers, etc.) - handled in UI mostly, but good to have context

        const roster = await prisma.playerRoster.findMany({
            where: {
                teamId,
                leagueId,
            },
            include: {
                player: true,
            },
            orderBy: {
                player: {
                    rank: 'asc',
                },
            },
        });

        return roster;
    }

    /**
     * Save the selected keepers for a team.
     * Validates:
     * - Keeper count <= maxKeepers
     * - Keeper deadline has not passed
     * - Players are actually on the team's roster
     */
    async saveKeepers(teamId: string, leagueId: string, selections: KeeperSelection[]) {
        // 1. Get league settings
        const settings = await prisma.draftSettings.findUnique({
            where: { leagueId },
        });

        if (!settings) {
            throw new Error('Draft settings not found');
        }

        // 2. Validate deadline
        if (settings.keeperDeadline && new Date() > settings.keeperDeadline) {
            throw new Error('Keeper deadline has passed');
        }

        // 3. Validate max keepers
        if (selections.length > settings.maxKeepers) {
            throw new Error(`Cannot keep more than ${settings.maxKeepers} players`);
        }

        // 4. Validate unique rounds (optional, but good practice if each keeper takes a specific round slot)
        // For now, let's allow it, but we might want to enforce unique rounds if multiple keepers can't cost the same round.
        // Actually, usually they cost *a* pick in that round. If they have two 3rd round picks from trades, they can keep two 3rd rounders.
        // We'll trust the logic for now, but verification happens better with full pick context (Phase 2).

        return await prisma.$transaction(async (tx) => {
            // 5. Keepers can only be picked from the team's own roster.
            const roster = await tx.playerRoster.findMany({
                where: { teamId, leagueId },
            });
            const rosterByPlayer = new Map(roster.map((r) => [r.playerId, r]));

            for (const selection of selections) {
                if (!rosterByPlayer.has(selection.playerId)) {
                    const player = await tx.player.findUnique({ where: { id: selection.playerId } });
                    throw new Error(`${player?.fullName || selection.playerId} is not on your roster`);
                }
            }

            const selectedIds = selections.map((s) => s.playerId);

            // 6. Deselection: rows that only existed as keeper picks are removed;
            // players acquired another way stay on the roster, just unflagged.
            await tx.playerRoster.deleteMany({
                where: {
                    teamId,
                    leagueId,
                    acquiredVia: 'KEEPER',
                    playerId: { notIn: selectedIds },
                },
            });
            await tx.playerRoster.updateMany({
                where: {
                    teamId,
                    leagueId,
                    isKeeper: true,
                    playerId: { notIn: selectedIds },
                },
                data: { isKeeper: false, keeperRound: null },
            });

            // 7. Selection: flag the existing rows so acquiredVia/acquiredAt survive.
            for (const selection of selections) {
                await tx.playerRoster.update({
                    where: {
                        teamId_playerId: {
                            teamId,
                            playerId: selection.playerId,
                        },
                    },
                    data: {
                        isKeeper: true,
                        keeperRound: selection.keeperRound,
                    },
                });
            }
        });
    }
}
