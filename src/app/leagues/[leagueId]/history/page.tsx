import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { ArrowLeft, History, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeagueHistoryPage({
    params,
}: {
    params: { leagueId: string };
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

    const league = await prisma.league.findUnique({
        where: { id: params.leagueId },
        select: { id: true, name: true, season: true },
    });
    if (!league) {
        notFound();
    }

    const [rosterSeasons, draftSeasons, pastWinners] = await Promise.all([
        prisma.rosterHistory.findMany({
            where: { leagueId: league.id },
            select: { season: true },
            distinct: ["season"],
        }),
        prisma.draftPick.findMany({
            where: { leagueId: league.id, isComplete: true, season: { lt: league.season } },
            select: { season: true },
            distinct: ["season"],
        }),
        prisma.pastWinner.findMany({
            where: { leagueId: league.id },
            select: { season: true, managerName: true },
        }),
    ]);

    const championBySeason = new Map(pastWinners.map((w) => [w.season, w.managerName]));

    const seasons = Array.from(
        new Set([
            ...rosterSeasons.map((r) => r.season),
            ...draftSeasons.map((d) => d.season),
        ])
    )
        .filter((season) => season < league.season)
        .sort((a, b) => b - a);

    return (
        <div className="container mx-auto py-10 px-4">
            <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-4 mb-6">
                    <Link
                        href={`/leagues/${league.id}`}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Past Seasons</h1>
                        <p className="text-muted-foreground mt-1">{league.name}</p>
                    </div>
                </div>

                {seasons.length === 0 ? (
                    <Card className="text-center py-10 bg-muted/20 border-dashed">
                        <CardContent className="space-y-2">
                            <History className="w-10 h-10 text-muted-foreground/30 mx-auto" />
                            <CardTitle className="text-lg">No archived seasons yet</CardTitle>
                            <CardDescription>
                                History is written when you start a new season — each rollover
                                archives every team&apos;s final roster and that year&apos;s draft.
                            </CardDescription>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {seasons.map((season) => {
                            const champion = championBySeason.get(season);
                            return (
                                <Link
                                    key={season}
                                    href={`/leagues/${league.id}/history/${season}`}
                                    className="flex items-center justify-between p-4 rounded-xl border bg-card/50 hover:bg-muted/40 transition-colors"
                                >
                                    <div>
                                        <p className="text-lg font-semibold">{season} Season</p>
                                        {champion ? (
                                            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                                <Trophy className="h-3 w-3 text-amber-500" />
                                                {champion}
                                            </p>
                                        ) : (
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                No champion recorded
                                            </p>
                                        )}
                                    </div>
                                    <span className="text-sm text-muted-foreground">View →</span>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
