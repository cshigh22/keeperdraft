
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect, notFound } from 'next/navigation';
import { KeeperSelectionUI } from '@/components/keepers/KeeperSelection';
import { saveKeepers } from '@/app/actions/keepers';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default async function KeepersPage({
    params,
    searchParams
}: {
    params: { leagueId: string },
    searchParams: { teamId?: string }
}) {
    const { leagueId } = params;

    const session = await auth();
    if (!session?.user?.id) {
        redirect('/login');
    }
    const userId = session.user.id;

    const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: {
            commissionerId: true,
            members: { where: { userId }, select: { id: true } },
        },
    });
    if (!league) {
        notFound();
    }

    const isCommissioner = league.commissionerId === userId;
    if (!isCommissioner && league.members.length === 0) {
        notFound();
    }

    // Get league settings
    const settings = await prisma.draftSettings.findUnique({
        where: { leagueId },
    });

    if (!settings) {
        return <div>Draft settings not configured for this league.</div>;
    }

    // Resolve the team: an explicit teamId is honored for its owner or the
    // commissioner; everyone else gets bounced to their own team.
    let team = null;
    if (searchParams.teamId) {
        const requested = await prisma.team.findUnique({
            where: { id: searchParams.teamId },
            include: { owner: true },
        });
        if (requested && requested.leagueId === leagueId) {
            if (isCommissioner || requested.ownerId === userId) {
                team = requested;
            } else {
                redirect(`/leagues/${leagueId}/keepers`);
            }
        }
    }

    if (!team) {
        team = await prisma.team.findFirst({
            where: { leagueId, ownerId: userId },
            include: { owner: true },
        });
    }

    // A commissioner without their own team still needs a starting point
    if (!team && isCommissioner) {
        team = await prisma.team.findFirst({
            where: { leagueId },
            include: { owner: true },
        });
    }

    if (!team) {
        return <div>You don&apos;t have a team in this league.</div>;
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
                <Link href={`/draft?leagueId=${leagueId}`} className="text-sm text-primary hover:underline flex items-center gap-1">
                    <ArrowLeft className="w-4 h-4" /> Back to Draft Room
                </Link>
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
