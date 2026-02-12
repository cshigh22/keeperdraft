
import { PrismaClient } from '@prisma/client';
import { KeeperSelectionUI } from '@/components/keepers/KeeperSelection';
import { saveKeepers } from '@/app/actions/keepers';

const prisma = new PrismaClient();

export default async function KeepersPage({
    params,
    searchParams
}: {
    params: { leagueId: string },
    searchParams: { teamId?: string }
}) {
    const { leagueId } = params;

    // Get league settings
    const settings = await prisma.draftSettings.findUnique({
        where: { leagueId },
    });

    if (!settings) {
        return <div>Draft settings not configured for this league.</div>;
    }

    // Find the team
    let team;
    if (searchParams.teamId) {
        team = await prisma.team.findUnique({
            where: { id: searchParams.teamId },
            include: { owner: true }
        });
    }

    // Fallback if no teamId provided or not found
    if (!team) {
        team = await prisma.team.findFirst({
            where: { leagueId },
            include: { owner: true }
        });
    }

    if (!team) {
        return <div>No team found for this league.</div>;
    }

    // Fetch ALL active players (the full player pool)
    const allPlayers = await prisma.player.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { rank: 'asc' },
    });

    // Fetch existing keeper selections for this team
    const existingKeeperRoster = await prisma.playerRoster.findMany({
        where: {
            teamId: team.id,
            leagueId,
            isKeeper: true,
        },
    });

    // Build existing keepers map: { playerId: keeperRound | null }
    const existingKeepers: Record<string, number | null> = {};
    for (const roster of existingKeeperRoster) {
        existingKeepers[roster.playerId] = roster.keeperRound;
    }

    // Fetch keepers from OTHER teams (to show as unavailable)
    const otherTeamKeepers = await prisma.playerRoster.findMany({
        where: {
            leagueId,
            isKeeper: true,
            teamId: { not: team.id },
        },
        include: {
            team: { select: { name: true } },
        },
    });

    // Build map: { playerId: teamName }
    const keptByOtherTeams: Record<string, string> = {};
    for (const k of otherTeamKeepers) {
        keptByOtherTeams[k.playerId] = k.team.name;
    }

    // Server Action wrapper
    async function saveKeepersAction(selections: any[]) {
        'use server';
        await saveKeepers(team!.id, leagueId, selections);
    }

    return (
        <div className="container mx-auto py-8 px-4">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Keeper Selection</h1>
                    <p className="text-muted-foreground mt-1">
                        {team.name} &middot; Select up to {settings.maxKeepers} keepers
                    </p>
                </div>
                <a href="/draft" className="text-sm text-primary hover:underline">
                    ← Back to Draft Room
                </a>
            </div>
            <KeeperSelectionUI
                players={JSON.parse(JSON.stringify(allPlayers))}
                existingKeepers={existingKeepers}
                keptByOtherTeams={keptByOtherTeams}
                maxKeepers={settings.maxKeepers}
                totalRounds={settings.totalRounds}
                deadline={settings.keeperDeadline}
                onSave={saveKeepersAction}
            />
        </div>
    );
}
