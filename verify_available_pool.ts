import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const leagueId = 'demo-league';

    // Get drafted IDs
    const draftedPicks = await prisma.draftPick.findMany({
        where: {
            leagueId,
            isComplete: true,
            selectedPlayerId: { not: null }
        },
        select: { selectedPlayerId: true }
    });

    const draftedIds = draftedPicks
        .map(p => p.selectedPlayerId)
        .filter((id): id is string => id !== null);

    // Get keepers
    const keepers = await prisma.playerRoster.findMany({
        where: { leagueId, isKeeper: true },
        select: { playerId: true }
    });
    const keeperIds = keepers.map(k => k.playerId);

    const excludeIds = new Set([...draftedIds, ...keeperIds]);

    // Get available players (from server perspective)
    const availablePlayers = await prisma.player.findMany({
        where: {
            id: { notIn: Array.from(excludeIds) },
            status: 'ACTIVE'
        },
        take: 10
    });

    console.log('Sample Available Players:', availablePlayers.map(p => p.fullName));

    // Check if any keeper is in the available list
    const overlap = availablePlayers.filter(p => excludeIds.has(p.id));
    console.log('Overlap with excluded IDs:', overlap.length);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
