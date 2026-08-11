import { ShieldAlert } from "lucide-react";
import type { Prisma } from "@prisma/client";

// Shared between /leagues/[leagueId]/trades (current season) and
// /leagues/[leagueId]/history/[season] (archived seasons).

const tradeDateFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
});

export type TradeWithRelations = Prisma.TradeGetPayload<{
    include: {
        assets: { include: { draftPick: true; player: true } };
        initiatorTeam: { select: { id: true; name: true } };
        receiverTeam: { select: { id: true; name: true } };
    };
}>;

export const TRADE_HISTORY_INCLUDE = {
    assets: { include: { draftPick: true, player: true } },
    initiatorTeam: { select: { id: true, name: true } },
    receiverTeam: { select: { id: true, name: true } },
} satisfies Prisma.TradeInclude;

function assetLabel(asset: TradeWithRelations["assets"][number]): string {
    if (asset.player) {
        return `${asset.player.fullName} (${asset.player.position})`;
    }
    if (asset.draftPick) {
        return `${asset.draftPick.season} Round ${asset.draftPick.round}`;
    }
    // Legacy future-pick assets created before picks were materialized up front
    if (asset.futurePickSeason && asset.futurePickRound) {
        return `${asset.futurePickSeason} Round ${asset.futurePickRound}`;
    }
    return "Draft pick";
}

function TradeSide({ teamName, assets }: { teamName: string; assets: string[] }) {
    return (
        <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {teamName} sent
            </p>
            {assets.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Nothing</p>
            ) : (
                <ul className="space-y-1">
                    {assets.map((label, i) => (
                        <li key={i} className="text-sm">
                            {label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export function TradeHistoryList({ trades }: { trades: TradeWithRelations[] }) {
    // Newest first by the same date each card displays
    const sorted = [...trades].sort(
        (a, b) =>
            (b.processedAt ?? b.proposedAt).getTime() -
            (a.processedAt ?? a.proposedAt).getTime()
    );

    return (
        <div className="space-y-4">
            {sorted.map((trade) => {
                const initiatorAssets = trade.assets
                    .filter((a) => a.fromTeamId === trade.initiatorTeamId)
                    .map(assetLabel);
                const receiverAssets = trade.assets
                    .filter((a) => a.fromTeamId === trade.receiverTeamId)
                    .map(assetLabel);

                return (
                    <div
                        key={trade.id}
                        className="p-4 rounded-xl border bg-card/50 space-y-3"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-base font-semibold">
                                {trade.initiatorTeam.name}
                                <span className="text-muted-foreground mx-2">↔</span>
                                {trade.receiverTeam.name}
                            </p>
                            <div className="flex items-center gap-2">
                                {trade.status === "VETOED" && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 text-destructive text-xs font-medium px-2.5 py-0.5">
                                        Vetoed
                                    </span>
                                )}
                                {trade.forcedByCommissioner && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-600 text-xs font-medium px-2.5 py-0.5">
                                        <ShieldAlert className="h-3 w-3" />
                                        Executed by commissioner
                                    </span>
                                )}
                                <span className="text-xs text-muted-foreground">
                                    {tradeDateFormat.format(trade.processedAt ?? trade.proposedAt)}
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <TradeSide
                                teamName={trade.initiatorTeam.name}
                                assets={initiatorAssets}
                            />
                            <TradeSide
                                teamName={trade.receiverTeam.name}
                                assets={receiverAssets}
                            />
                        </div>

                        {trade.commissionerNotes && (
                            <p className="text-xs text-muted-foreground italic border-t pt-2">
                                {trade.commissionerNotes}
                            </p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
