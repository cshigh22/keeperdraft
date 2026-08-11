import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowLeftRight, Trophy, Users, ClipboardList } from "lucide-react";
import { ChampionCard } from "@/components/champions/ChampionCard";
import {
    TradeHistoryList,
    TRADE_HISTORY_INCLUDE,
} from "@/components/trades/TradeHistoryList";
import {
    ArchivedRosterCard,
    DraftResultsGrid,
    type ArchivedPlayer,
    type HistoryPickCell,
} from "../components";

export const dynamic = "force-dynamic";

// Sort keepers to the top of a roster, then by position, then name
const POSITION_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4, DEF: 5, DST: 5 };

export default async function SeasonHistoryPage({
    params,
}: {
    params: { leagueId: string; season: string };
}) {
    const session = await auth();
    if (!session?.user?.id) {
        redirect("/login");
    }

    const membership = await prisma.leagueMember.findUnique({
        where: {
            userId_leagueId: { userId: session.user.id, leagueId: params.leagueId },
        },
    });
    if (!membership) {
        notFound();
    }

    if (!/^\d{4}$/.test(params.season)) {
        notFound();
    }
    const season = parseInt(params.season, 10);

    const league = await prisma.league.findUnique({
        where: { id: params.leagueId },
        select: { id: true, name: true, season: true },
    });
    // Only seasons strictly before the current one are history
    if (!league || season >= league.season) {
        notFound();
    }

    const [champion, rosterRows, picks, trades] = await Promise.all([
        prisma.pastWinner.findUnique({
            where: { leagueId_season: { leagueId: league.id, season } },
        }),
        prisma.rosterHistory.findMany({
            where: { leagueId: league.id, season },
            orderBy: { teamName: "asc" },
        }),
        prisma.draftPick.findMany({
            where: { leagueId: league.id, season, isComplete: true },
            include: { currentOwner: { select: { id: true, name: true } } },
            orderBy: [{ round: "asc" }, { pickInRound: "asc" }],
        }),
        prisma.trade.findMany({
            where: {
                leagueId: league.id,
                season,
                status: { in: ["COMPLETED", "VETOED"] },
            },
            include: TRADE_HISTORY_INCLUDE,
        }),
    ]);

    if (rosterRows.length === 0 && picks.length === 0 && trades.length === 0) {
        notFound();
    }

    // DraftPick has no relation for selectedPlayerId — resolve names in bulk
    const selectedPlayerIds = picks
        .map((pick) => pick.selectedPlayerId)
        .filter((id): id is string => id !== null);
    const pickedPlayers = selectedPlayerIds.length
        ? await prisma.player.findMany({
              where: { id: { in: selectedPlayerIds } },
              select: { id: true, fullName: true, position: true },
          })
        : [];
    const playerById = new Map(pickedPlayers.map((p) => [p.id, p]));

    // Archived team names win over live ones (teams get renamed between seasons)
    const archivedNameByTeamId = new Map(rosterRows.map((r) => [r.teamId, r.teamName]));

    // Group rosters by team
    const rostersByTeam = new Map<string, { teamName: string; players: ArchivedPlayer[] }>();
    for (const row of rosterRows) {
        const entry = rostersByTeam.get(row.teamId) ?? { teamName: row.teamName, players: [] };
        entry.players.push({
            playerId: row.playerId,
            playerName: row.playerName,
            position: row.position,
            nflTeam: row.nflTeam,
            isKeeper: row.isKeeper,
            keeperRound: row.keeperRound,
        });
        rostersByTeam.set(row.teamId, entry);
    }
    const teams = Array.from(rostersByTeam.values()).sort((a, b) =>
        a.teamName.localeCompare(b.teamName)
    );
    for (const team of teams) {
        team.players.sort(
            (a, b) =>
                Number(b.isKeeper) - Number(a.isKeeper) ||
                (POSITION_ORDER[a.position] ?? 9) - (POSITION_ORDER[b.position] ?? 9) ||
                a.playerName.localeCompare(b.playerName)
        );
    }

    // Shape picks into rounds
    const roundsMap = new Map<number, HistoryPickCell[]>();
    for (const pick of picks) {
        const player = pick.selectedPlayerId ? playerById.get(pick.selectedPlayerId) : undefined;
        const cells = roundsMap.get(pick.round) ?? [];
        cells.push({
            pickInRound: pick.pickInRound,
            teamName: archivedNameByTeamId.get(pick.currentOwnerId) ?? pick.currentOwner.name,
            isTraded: pick.currentOwnerId !== pick.originalOwnerId,
            playerName: player?.fullName,
            position: player?.position,
        });
        roundsMap.set(pick.round, cells);
    }
    const rounds = Array.from(roundsMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([round, cells]) => ({ round, picks: cells }));

    return (
        <div className="container mx-auto py-10 px-4">
            <div className="max-w-5xl mx-auto">
                <div className="flex items-center gap-4 mb-8">
                    <Link
                        href={`/leagues/${league.id}/history`}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">{season} Season</h1>
                        <p className="text-muted-foreground mt-1">{league.name}</p>
                    </div>
                </div>

                {champion && (
                    <section className="mb-8">
                        <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                            <Trophy className="h-5 w-5 text-amber-500" />
                            Champion
                        </h2>
                        <ChampionCard
                            season={champion.season}
                            managerName={champion.managerName}
                            index={0}
                        />
                    </section>
                )}

                {teams.length > 0 && (
                    <section className="mb-8">
                        <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                            <Users className="h-5 w-5" />
                            Final Rosters
                        </h2>
                        <div className="grid gap-4 md:grid-cols-2">
                            {teams.map((team) => (
                                <ArchivedRosterCard
                                    key={team.teamName}
                                    teamName={team.teamName}
                                    players={team.players}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {rounds.length > 0 && (
                    <section className="mb-8">
                        <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                            <ClipboardList className="h-5 w-5" />
                            Draft Results
                        </h2>
                        <DraftResultsGrid rounds={rounds} />
                    </section>
                )}

                {trades.length > 0 && (
                    <section>
                        <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                            <ArrowLeftRight className="h-5 w-5" />
                            Trades
                        </h2>
                        <TradeHistoryList trades={trades} />
                    </section>
                )}
            </div>
        </div>
    );
}
