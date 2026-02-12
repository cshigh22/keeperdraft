
import { PrismaClient, AcquisitionType } from '@prisma/client';

const prisma = new PrismaClient();

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
            // 5. Clear ALL roster entries for this team before setting new keepers.
            // Pre-draft, the roster should only contain keeper selections.
            // The draft process will populate the rest of the roster.
            await tx.playerRoster.deleteMany({
                where: {
                    teamId,
                    leagueId,
                },
            });

            // 6. Set new keepers (upsert: create roster entry if player not already on team)
            for (const selection of selections) {
                // Check if player is already on ANY team in this league
                const existingRoster = await tx.playerRoster.findUnique({
                    where: {
                        leagueId_playerId: {
                            leagueId,
                            playerId: selection.playerId,
                        }
                    }
                });

                if (existingRoster && existingRoster.teamId !== teamId) {
                    // Player is on another team — skip or error
                    const player = await tx.player.findUnique({ where: { id: selection.playerId } });
                    throw new Error(`${player?.fullName || selection.playerId} is already on another team`);
                }

                // Upsert: update if on roster, create if not
                await tx.playerRoster.upsert({
                    where: {
                        teamId_playerId: {
                            teamId,
                            playerId: selection.playerId,
                        }
                    },
                    create: {
                        teamId,
                        playerId: selection.playerId,
                        leagueId,
                        isKeeper: true,
                        keeperRound: selection.keeperRound,
                        acquiredVia: 'KEEPER',
                    },
                    update: {
                        isKeeper: true,
                        keeperRound: selection.keeperRound,
                    },
                });
            }
        });
    }
}
