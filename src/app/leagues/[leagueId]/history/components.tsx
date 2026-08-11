// Presentational pieces for the Past Seasons pages. Server components only —
// the roster accordions use native <details> so no client JS ships.

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { positionBadgeColors } from '@/components/draft/position-styles';
import { ChevronDown } from 'lucide-react';

export function HistoryPositionBadge({ position }: { position: string }) {
    return (
        <Badge
            className={cn(
                'text-[9px] px-1.5 py-0 font-mono h-5 shrink-0 border',
                positionBadgeColors[position] ?? 'bg-muted text-muted-foreground'
            )}
        >
            {position}
        </Badge>
    );
}

export function HistoryKeeperBadge({ keeperRound }: { keeperRound: number | null }) {
    return (
        <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/20 text-[8px] h-3.5 px-1 font-bold uppercase tracking-tighter">
            Keeper {keeperRound ? `(Rd ${keeperRound})` : ''}
        </Badge>
    );
}

export interface ArchivedPlayer {
    playerId: string;
    playerName: string;
    position: string;
    nflTeam: string | null;
    isKeeper: boolean;
    keeperRound: number | null;
}

export function ArchivedRosterCard({
    teamName,
    players,
}: {
    teamName: string;
    players: ArchivedPlayer[];
}) {
    return (
        <details className="border rounded-xl overflow-hidden bg-card/50 group" open>
            <summary className="flex items-center justify-between px-4 py-3 bg-muted/20 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                <span className="text-sm font-semibold">{teamName}</span>
                <span className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                        {players.length} players
                    </Badge>
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </span>
            </summary>
            <div className="p-2 space-y-1">
                {players.map((player) => (
                    <div
                        key={player.playerId}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40"
                    >
                        <HistoryPositionBadge position={player.position} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <p className="text-xs font-medium truncate">{player.playerName}</p>
                                {player.isKeeper && (
                                    <HistoryKeeperBadge keeperRound={player.keeperRound} />
                                )}
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                                {player.nflTeam || 'FA'}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </details>
    );
}

export interface HistoryPickCell {
    pickInRound: number | null;
    teamName: string;
    isTraded: boolean;
    playerName?: string;
    position?: string;
}

export function DraftResultsGrid({
    rounds,
}: {
    rounds: { round: number; picks: HistoryPickCell[] }[];
}) {
    return (
        <div className="space-y-6">
            {rounds.map(({ round, picks }) => (
                <div key={round}>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                        Round {round}
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {picks.map((pick) => (
                            <div
                                key={`${round}.${pick.pickInRound ?? '?'}-${pick.teamName}`}
                                className="border rounded-lg p-2.5 bg-card/50 space-y-1"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-mono text-muted-foreground">
                                        {round}.{pick.pickInRound ?? '?'}
                                    </span>
                                    {pick.isTraded && (
                                        <Badge variant="outline" className="text-[8px] h-3.5 px-1">
                                            TRADED
                                        </Badge>
                                    )}
                                </div>
                                {pick.playerName ? (
                                    <div className="flex items-center gap-1.5">
                                        {pick.position && (
                                            <HistoryPositionBadge position={pick.position} />
                                        )}
                                        <p className="text-xs font-medium truncate">{pick.playerName}</p>
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground">—</p>
                                )}
                                <p className="text-[10px] text-muted-foreground truncate">
                                    {pick.teamName}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}
