import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ArrowLeftRight } from "lucide-react";
import {
    TradeHistoryList,
    TRADE_HISTORY_INCLUDE,
} from "@/components/trades/TradeHistoryList";

export const dynamic = "force-dynamic";

export default async function TradeHistoryPage({
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

    // Current season only — past seasons live under /history/[season]
    const trades = await prisma.trade.findMany({
        where: {
            leagueId: league.id,
            season: league.season,
            status: { in: ["COMPLETED", "VETOED"] },
        },
        include: TRADE_HISTORY_INCLUDE,
    });

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
                        <h1 className="text-3xl font-bold tracking-tight">Trade History</h1>
                        <p className="text-muted-foreground mt-1">
                            {league.name} &middot; {league.season} Season
                        </p>
                    </div>
                </div>

                {trades.length === 0 ? (
                    <Card className="text-center py-10 bg-muted/20 border-dashed">
                        <CardContent className="space-y-2">
                            <ArrowLeftRight className="w-10 h-10 text-muted-foreground/30 mx-auto" />
                            <CardTitle className="text-lg">No trades yet</CardTitle>
                            <CardDescription>
                                Trades completed this season will appear here once managers —
                                or the commissioner — start dealing. Past seasons&apos; trades
                                live in each season&apos;s archive.
                            </CardDescription>
                        </CardContent>
                    </Card>
                ) : (
                    <TradeHistoryList trades={trades} />
                )}
            </div>
        </div>
    );
}
