import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const leagueId = 'demo-league';

    const keepers = await prisma.playerRoster.findMany({
        where: { leagueId, isKeeper: true }
    });

    const completedPicks = await prisma.draftPick.findMany({
        where: { leagueId, isComplete: true },
        select: { selectedPlayerId: true }
    });

    const completedIds = new Set(
        completedPicks
            .map(p => p.selectedPlayerId)
            .filter((id): id is string => id !== null)
    );

    console.log('Total Keepers:', keepers.length);
    console.log('Completed Picks:', completedPicks.length);

    const orphanKeepers = keepers.filter(k => !completedIds.has(k.playerId));
    console.log('Keepers NOT yet on a completed pick:', orphanKeepers.length);

    for (const k of orphanKeepers) {
        console.log(`- Player ${k.playerId} (Team ${k.teamId}, Round ${k.keeperRound})`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
