'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TeamSummary, DraftPickSummary, RosterSettings } from '@/types/socket';

interface TeamRostersProps {
    teams: TeamSummary[];
    completedPicks: DraftPickSummary[];
    rosterSettings?: RosterSettings;
    myTeamId?: string;
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF', 'BENCH'];

// Helper to determine position style
const positionColors: Record<string, string> = {
    QB: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
    RB: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800',
    WR: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
    TE: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
    K: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800',
    DEF: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
    FLEX: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800',
    SUPERFLEX: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950 dark:text-pink-300 dark:border-pink-800',
    BENCH: 'bg-gray-50 text-gray-600 border-gray-100 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-800',
};

export function TeamRosters({
    teams,
    completedPicks,
    rosterSettings,
    myTeamId,
}: TeamRostersProps) {
    // Group picks by team
    const teamPicks = React.useMemo(() => {
        const map = new Map<string, DraftPickSummary[]>();
        teams.forEach((t) => map.set(t.id, []));

        // Sort picks by round/pick number to process them in order
        const sortedPicks = [...completedPicks].sort((a, b) => a.overallPickNumber - b.overallPickNumber);

        sortedPicks.forEach((pick) => {
            const teamId = pick.currentOwnerId;
            const teamList = map.get(teamId) || [];
            teamList.push(pick);
            map.set(teamId, teamList);
        });
        return map;
    }, [teams, completedPicks]);

    // If no settings provided, default to standard
    const settings = rosterSettings || {
        qbCount: 1,
        rbCount: 2,
        wrCount: 3,
        teCount: 1,
        flexCount: 2,
        superflexCount: 0,
        kCount: 1,
        defCount: 1,
        benchCount: 9,
    };

    // Helper to organizing a team's roster into slots
    const getOrganizedRoster = (picks: DraftPickSummary[]) => {
        const slots: { position: string; player?: DraftPickSummary['selectedPlayer']; pick?: DraftPickSummary }[] = [];

        // Create empty slots structure
        const addSlots = (count: number, pos: string) => {
            for (let i = 0; i < count; i++) slots.push({ position: pos });
        };

        addSlots(settings.qbCount, 'QB');
        addSlots(settings.rbCount, 'RB');
        addSlots(settings.wrCount, 'WR');
        addSlots(settings.teCount, 'TE');
        addSlots(settings.flexCount, 'FLEX');
        addSlots(settings.superflexCount, 'SUPERFLEX');
        addSlots(settings.kCount, 'K');
        addSlots(settings.defCount, 'DEF');
        addSlots(settings.benchCount, 'BENCH'); // Or typically bench is unlimited/remainder, but here we have a count

        // Process picks and fill slots
        const filledSlots = [...slots];
        const remainingPicks = [...picks];

        // 1. Fill Primary Positions
        for (let i = 0; i < filledSlots.length; i++) {
            const slot = filledSlots[i];
            if (!slot || ['FLEX', 'SUPERFLEX', 'BENCH'].includes(slot.position)) continue;

            const candidateIndex = remainingPicks.findIndex(p => p.selectedPlayer?.position === slot.position);
            if (candidateIndex !== -1) {
                const pick = remainingPicks[candidateIndex];
                if (pick && pick.selectedPlayer) {
                    filledSlots[i] = { position: slot.position, player: pick.selectedPlayer, pick };
                    remainingPicks.splice(candidateIndex, 1);
                }
            }
        }

        // 2. Fill FLEX (RB, WR, TE)
        for (let i = 0; i < filledSlots.length; i++) {
            const slot = filledSlots[i];
            if (!slot || slot.position !== 'FLEX' || slot.player) continue;

            const candidateIndex = remainingPicks.findIndex(p =>
                ['RB', 'WR', 'TE'].includes(p.selectedPlayer?.position || '')
            );
            if (candidateIndex !== -1) {
                const pick = remainingPicks[candidateIndex];
                if (pick && pick.selectedPlayer) {
                    filledSlots[i] = { position: slot.position, player: pick.selectedPlayer, pick };
                    remainingPicks.splice(candidateIndex, 1);
                }
            }
        }

        // 3. Fill SUPERFLEX (QB, RB, WR, TE)
        for (let i = 0; i < filledSlots.length; i++) {
            const slot = filledSlots[i];
            if (!slot || slot.position !== 'SUPERFLEX' || slot.player) continue;

            const candidateIndex = remainingPicks.findIndex(p =>
                ['QB', 'RB', 'WR', 'TE'].includes(p.selectedPlayer?.position || '')
            );
            if (candidateIndex !== -1) {
                const pick = remainingPicks[candidateIndex];
                if (pick && pick.selectedPlayer) {
                    filledSlots[i] = { position: slot.position, player: pick.selectedPlayer, pick };
                    remainingPicks.splice(candidateIndex, 1);
                }
            }
        }

        // 4. Fill BENCH (Any)
        for (let i = 0; i < filledSlots.length; i++) {
            const slot = filledSlots[i];
            if (!slot || slot.position !== 'BENCH' || slot.player) continue;

            if (remainingPicks.length > 0) {
                const pick = remainingPicks[0];
                if (pick && pick.selectedPlayer) {
                    filledSlots[i] = { position: slot.position, player: pick.selectedPlayer, pick };
                    remainingPicks.shift();
                }
            }
        }

        // If there are still remaining picks (e.g., overflow), add them as extra bench
        remainingPicks.forEach(pick => {
            if (pick && pick.selectedPlayer) {
                filledSlots.push({ position: 'BENCH', player: pick.selectedPlayer, pick });
            }
        });

        return filledSlots;
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-8">
            {teams.map((team) => {
                const roster = getOrganizedRoster(teamPicks.get(team.id) || []);

                return (
                    <Card key={team.id} className={cn(
                        "h-full overflow-hidden flex flex-col",
                        team.id === myTeamId && "border-primary ring-1 ring-primary"
                    )}>
                        <CardHeader className="py-3 px-4 bg-muted/50">
                            <div className="flex justify-between items-center">
                                <div className="min-w-0">
                                    <CardTitle className="text-sm font-bold truncate" title={team.name}>{team.name}</CardTitle>
                                    <p className="text-xs text-muted-foreground truncate">{team.ownerName}</p>
                                </div>
                                <div className="text-xs font-mono bg-background px-2 py-0.5 rounded border">
                                    {teamPicks.get(team.id)?.length || 0} Players
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0 flex-1">
                            <ScrollArea className="h-[400px]">
                                <div className="divide-y">
                                    {roster.map((slot, idx) => {
                                        const isEmpty = !slot.player;
                                        const style = positionColors[slot.position] || positionColors.BENCH;

                                        return (
                                            <div key={idx} className="flex items-center p-2 gap-2 text-sm hover:bg-muted/30 transition-colors">
                                                <div className={cn("w-10 text-[10px] font-bold text-center px-1 py-0.5 rounded border", style)}>
                                                    {slot.position}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    {isEmpty ? (
                                                        <p className="text-muted-foreground/40 italic text-xs">Empty</p>
                                                    ) : (
                                                        <div className="flex flex-col">
                                                            <span className="font-medium truncate">{slot.player?.fullName}</span>
                                                            <div className="flex gap-2 text-[10px] text-muted-foreground">
                                                                <span>{slot.player?.position}</span>
                                                                <span>•</span>
                                                                <span>{slot.player?.nflTeam || 'FA'}</span>
                                                                {slot.pick && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span>R{slot.pick.round}</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
