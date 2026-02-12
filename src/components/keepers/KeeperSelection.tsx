
'use client';

import React, { useState, useEffect } from 'react';
import type { Player } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface KeeperSelectionProps {
    players: Player[];
    existingKeepers: Record<string, number | null>; // playerId => keeperRound (null = no cost)
    keptByOtherTeams?: Record<string, string>; // playerId => team name
    maxKeepers: number;
    totalRounds: number;
    deadline?: Date | null;
    onSave: (selections: KeeperSelection[]) => Promise<void>;
    isLoading?: boolean;
}

export type KeeperSelection = {
    playerId: string;
    keeperRound: number | null;
};

type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

// ============================================================================
// Position Badge Colors
// ============================================================================

const positionBadgeColors: Record<string, string> = {
    QB: 'bg-pink-500/20 text-pink-600 border-pink-500/30',
    RB: 'bg-blue-500/20 text-blue-600 border-blue-500/30',
    WR: 'bg-green-500/20 text-green-600 border-green-500/30',
    TE: 'bg-yellow-500/20 text-yellow-600 border-yellow-500/30',
    K: 'bg-gray-500/20 text-gray-600 border-gray-500/30',
    DEF: 'bg-purple-500/20 text-purple-600 border-purple-500/30',
};

// ============================================================================
// Component
// ============================================================================

export function KeeperSelectionUI({
    players,
    existingKeepers,
    keptByOtherTeams = {},
    maxKeepers,
    totalRounds,
    deadline,
    onSave,
    isLoading = false,
}: KeeperSelectionProps) {
    // Store selections as a Map of playerId => round (null means no cost)
    const [selections, setSelections] = useState<Map<string, number | null>>(new Map());
    const [search, setSearch] = useState('');
    const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);

    // Initialize selections from existing keepers
    useEffect(() => {
        const initial = new Map<string, number | null>();
        for (const [playerId, round] of Object.entries(existingKeepers)) {
            initial.set(playerId, round);
        }
        setSelections(initial);
    }, [existingKeepers]);

    // Filter logic
    const filteredPlayers = React.useMemo(() => {
        let result = [...players];
        if (search.trim()) {
            const s = search.toLowerCase();
            result = result.filter(p => p.fullName.toLowerCase().includes(s));
        }
        if (positionFilter !== 'ALL') {
            const filter = positionFilter === 'DST' ? 'DEF' : positionFilter;
            result = result.filter(p => p.position === filter);
        }
        // Sort: selected keepers first, then by rank
        result.sort((a, b) => {
            const aSelected = selections.has(a.id) ? 0 : 1;
            const bSelected = selections.has(b.id) ? 0 : 1;
            if (aSelected !== bSelected) return aSelected - bSelected;
            return (a.rank ?? 9999) - (b.rank ?? 9999);
        });
        return result;
    }, [players, search, positionFilter, selections]);

    const toggleSelection = (playerId: string) => {
        const newSelections = new Map(selections);
        if (newSelections.has(playerId)) {
            newSelections.delete(playerId);
        } else {
            if (newSelections.size >= maxKeepers) return;
            newSelections.set(playerId, null); // Default to No Cost
        }
        setSelections(newSelections);
        setSaveMessage(null);
    };

    const updateRound = (playerId: string, round: number | null) => {
        const newSelections = new Map(selections);
        if (newSelections.has(playerId)) {
            newSelections.set(playerId, round);
            setSelections(newSelections);
        }
    };

    const currentCount = selections.size;
    const isDeadlinePassed = deadline ? new Date() > deadline : false;

    const handleSave = async () => {
        setSaving(true);
        setSaveMessage(null);
        try {
            const payload: KeeperSelection[] = Array.from(selections.entries()).map(([playerId, round]) => ({
                playerId,
                keeperRound: round,
            }));
            await onSave(payload);
            setSaveMessage('Keepers saved successfully!');
        } catch (e: any) {
            setSaveMessage(`Error: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="w-full max-w-5xl mx-auto space-y-6">
            {/* Header Card */}
            <Card>
                <CardHeader className="pb-4">
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-2xl">Select Keepers</CardTitle>
                        <div className="flex items-center gap-4">
                            <Badge variant={currentCount > maxKeepers ? "destructive" : "default"} className="text-sm px-3 py-1">
                                {currentCount} / {maxKeepers} Selected
                            </Badge>
                        </div>
                    </div>
                    {deadline && (
                        <p className="text-sm text-muted-foreground">
                            Deadline: {deadline.toLocaleDateString()} {deadline.toLocaleTimeString()}
                        </p>
                    )}
                </CardHeader>
            </Card>

            {isDeadlinePassed && (
                <div className="bg-yellow-100 text-yellow-800 p-4 rounded-lg border border-yellow-300">
                    The deadline has passed. Verify with your Commissioner if changes are allowed.
                </div>
            )}

            {/* Player Pool Card */}
            <Card className="overflow-hidden">
                {/* Search and Filters */}
                <div className="p-4 space-y-3 bg-slate-50 border-b">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Search players..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 bg-white"
                        />
                    </div>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                        {(['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'] as PositionFilter[]).map((pos) => (
                            <button
                                key={pos}
                                onClick={() => setPositionFilter(pos)}
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-[11px] font-bold transition-all border shrink-0",
                                    positionFilter === pos
                                        ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20"
                                        : "bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                                )}
                            >
                                {pos}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Table Header */}
                <div className="grid grid-cols-[40px,50px,1fr,50px,50px,140px] gap-2 px-4 py-2 bg-slate-100 border-b text-[10px] font-bold text-slate-500 tracking-widest uppercase">
                    <div className="text-center"></div>
                    <div className="text-center">POS</div>
                    <div className="pl-2">PLAYER</div>
                    <div className="text-center">RNK</div>
                    <div className="text-center">ADP</div>
                    <div className="text-center">KEEPER COST</div>
                </div>

                {/* Player List */}
                <ScrollArea className="h-[600px]">
                    <div className="divide-y divide-slate-100">
                        {filteredPlayers.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-2">
                                <Search className="w-12 h-12 opacity-10" />
                                <p className="text-sm font-medium">No players found</p>
                            </div>
                        ) : (
                            filteredPlayers.map((player) => {
                                const isSelected = selections.has(player.id);
                                const selectedRound = selections.get(player.id);
                                const keptByTeam = keptByOtherTeams[player.id];
                                const isKeptByOther = !!keptByTeam;

                                return (
                                    <div
                                        key={player.id}
                                        className={cn(
                                            "grid grid-cols-[40px,50px,1fr,50px,50px,140px] gap-2 px-4 py-2.5 items-center transition-all",
                                            isKeptByOther
                                                ? "opacity-50 bg-slate-50 border-l-4 border-l-transparent"
                                                : isSelected
                                                    ? "bg-primary/5 border-l-4 border-l-primary"
                                                    : "hover:bg-slate-50 border-l-4 border-l-transparent"
                                        )}
                                    >
                                        {/* Checkbox */}
                                        <div className="flex justify-center">
                                            <Checkbox
                                                checked={isSelected}
                                                onCheckedChange={() => toggleSelection(player.id)}
                                                disabled={isKeptByOther || isDeadlinePassed || (!isSelected && currentCount >= maxKeepers)}
                                            />
                                        </div>

                                        {/* Position Badge */}
                                        <div className="flex justify-center">
                                            <span className={cn(
                                                "w-10 py-0.5 rounded-sm text-[9px] font-black border text-center",
                                                positionBadgeColors[player.position] || "bg-slate-100 text-slate-500 border-slate-200"
                                            )}>
                                                {player.position}
                                            </span>
                                        </div>

                                        {/* Player Name & Team */}
                                        <div className="pl-2 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className={cn(
                                                    "text-sm font-semibold truncate",
                                                    isKeptByOther && "text-slate-400 line-through"
                                                )}>
                                                    {player.fullName}
                                                </span>
                                                {isKeptByOther && (
                                                    <span className="text-[9px] font-bold text-orange-600 uppercase shrink-0 bg-orange-500/10 px-1.5 py-0.5 rounded-sm border border-orange-500/20">
                                                        KEPT · {keptByTeam}
                                                    </span>
                                                )}
                                                {player.injuryStatus && !isKeptByOther && (
                                                    <span className="text-[9px] font-bold text-red-500 uppercase shrink-0 bg-red-500/10 px-1 rounded-sm">
                                                        {player.injuryStatus}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-muted-foreground font-medium uppercase">
                                                {player.nflTeam || 'FA'}
                                            </div>
                                        </div>

                                        {/* Rank */}
                                        <div className="text-center text-xs font-mono text-slate-500">
                                            {player.rank || '-'}
                                        </div>

                                        {/* ADP */}
                                        <div className="text-center text-xs text-slate-400">
                                            {player.adp ? Math.round(player.adp) : '-'}
                                        </div>

                                        {/* Keeper Cost Dropdown (only if selected) */}
                                        <div className="flex justify-center">
                                            {isKeptByOther ? (
                                                <span className="text-xs text-slate-300">—</span>
                                            ) : isSelected ? (
                                                <Select
                                                    value={selectedRound === null || selectedRound === undefined ? 'no_cost' : selectedRound.toString()}
                                                    onValueChange={(val) => updateRound(player.id, val === 'no_cost' ? null : parseInt(val))}
                                                    disabled={isDeadlinePassed}
                                                >
                                                    <SelectTrigger className="w-[120px] h-8 text-xs">
                                                        <SelectValue placeholder="Select Cost" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="no_cost" className="font-semibold text-primary">
                                                            No Cost
                                                        </SelectItem>
                                                        {Array.from({ length: totalRounds }, (_, i) => i + 1).map((r) => (
                                                            <SelectItem key={r} value={r.toString()}>
                                                                Round {r}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <span className="text-xs text-slate-300">—</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </ScrollArea>
            </Card>

            {/* Save Bar */}
            <div className="flex items-center justify-between">
                <div>
                    {saveMessage && (
                        <p className={cn(
                            "text-sm font-medium",
                            saveMessage.startsWith('Error') ? 'text-red-500' : 'text-green-600'
                        )}>
                            {saveMessage}
                        </p>
                    )}
                </div>
                <Button
                    onClick={handleSave}
                    disabled={isDeadlinePassed || saving}
                    size="lg"
                >
                    {saving ? 'Saving...' : `Save Keepers (${currentCount})`}
                </Button>
            </div>
        </div>
    );
}
