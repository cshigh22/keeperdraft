// Player Pool Sidebar Component
// Redesigned to match the reference image aesthetics

'use client';

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Star, Info } from 'lucide-react';
import type { PlayerSummary } from '@/types/socket';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

// ============================================================================
// TYPES
// ============================================================================

interface PlayerPoolProps {
    players: PlayerSummary[];
    isMyTurn: boolean;
    onDraftPlayer: (playerId: string) => void;
    isLoading?: boolean;
}

type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

// ============================================================================
// POSITION STYLE HELPERS
// ============================================================================

const positionBadgeColors: Record<string, string> = {
    QB: 'bg-pink-500/20 text-pink-500 border-pink-500/50',
    RB: 'bg-blue-500/20 text-blue-500 border-blue-500/50',
    WR: 'bg-green-500/20 text-green-500 border-green-500/50',
    TE: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50',
    K: 'bg-gray-500/20 text-gray-500 border-gray-500/50',
    DEF: 'bg-purple-500/20 text-purple-500 border-purple-500/50',
    DST: 'bg-purple-500/20 text-purple-500 border-purple-500/50',
};

// ============================================================================
// PLAYER POOL COMPONENT
// ============================================================================

export function PlayerPool({
    players,
    isMyTurn,
    onDraftPlayer,
    isLoading = false,
}: PlayerPoolProps) {
    const [search, setSearch] = useState('');
    const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);

    // Toggle favorite
    const toggleFavorite = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setFavorites(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Filtered players
    const filteredPlayers = useMemo(() => {
        let result = [...players];

        // Exclude players who are already kept (should be handled by server, but extra safety)
        result = result.filter(p => !p.keptByTeam);

        if (search.trim()) {
            const s = search.toLowerCase();
            result = result.filter(p => p.fullName.toLowerCase().includes(s));
        }

        if (positionFilter !== 'ALL') {
            const filter = positionFilter === 'DST' ? 'DEF' : positionFilter;
            result = result.filter(p => p.position === filter);
        }

        if (showOnlyFavorites) {
            result = result.filter(p => favorites.has(p.id));
        }

        return result;
    }, [players, search, positionFilter, showOnlyFavorites, favorites]);

    return (
        <div className="flex flex-col h-full bg-white text-slate-900 border-l border-slate-200 shadow-xl overflow-hidden">
            {/* Header */}
            <div className="p-4 space-y-4 bg-slate-50/50">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold tracking-wider text-slate-500 uppercase">Player Pool</h2>
                    <span className="text-[10px] font-bold text-slate-600 bg-slate-200 px-2 py-0.5 rounded-full">{filteredPlayers.length} available</span>
                </div>

                {/* Search Bar */}
                <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                    <Input
                        placeholder="Search players..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 bg-white border-slate-200 focus-visible:ring-blue-500/50 text-sm h-10 transition-all placeholder:text-slate-400"
                    />
                </div>

                {/* Position Filters */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                    {(['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'] as PositionFilter[]).map((pos) => (
                        <button
                            key={pos}
                            onClick={() => {
                                setPositionFilter(pos);
                                setShowOnlyFavorites(false);
                            }}
                            className={cn(
                                "px-3 py-1.5 rounded-md text-[11px] font-bold transition-all border shrink-0",
                                positionFilter === pos && !showOnlyFavorites
                                    ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20"
                                    : "bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                            )}
                        >
                            {pos}
                        </button>
                    ))}
                    <button
                        onClick={() => setShowOnlyFavorites(!showOnlyFavorites)}
                        className={cn(
                            "p-2 rounded-md transition-all border shrink-0",
                            showOnlyFavorites
                                ? "bg-yellow-500 border-yellow-400 text-white shadow-lg shadow-yellow-500/20"
                                : "bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                        )}
                    >
                        <Star className={cn("w-3.5 h-3.5", showOnlyFavorites && "fill-current")} />
                    </button>
                </div>
            </div>

            {/* Table Headers */}
            <div className="grid grid-cols-[36px,44px,1fr,44px,44px] gap-2 px-4 py-2 bg-slate-50 border-y border-slate-200 text-[10px] font-bold text-slate-500 tracking-widest uppercase">
                <div className="text-center font-mono ml-4">#</div>
                <div className="text-center">POS</div>
                <div className="pl-2">PLAYER</div>
                <div className="text-center">ADP</div>
                <div className="text-center">BYE</div>
            </div>

            {/* Player List */}
            <ScrollArea className="flex-1">
                <div className="divide-y divide-white/5">
                    {filteredPlayers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-2">
                            <Search className="w-12 h-12 opacity-10" />
                            <p className="text-sm font-medium">No players found</p>
                        </div>
                    ) : (
                        filteredPlayers.map((player) => {
                            return (
                                <div
                                    key={player.id}
                                    className={cn(
                                        "grid grid-cols-[36px,44px,1fr,44px,44px] gap-2 px-4 py-2.5 items-center transition-all group",
                                        "relative border-b border-slate-100",
                                        "hover:bg-slate-50"
                                    )}
                                >
                                    {/* Star Overlay on hover */}
                                    <button
                                        onClick={(e) => toggleFavorite(player.id, e)}
                                        className={cn(
                                            "absolute left-1 top-1/2 -translate-y-1/2 p-1 transition-opacity",
                                            favorites.has(player.id) ? "opacity-100 text-yellow-500" : "opacity-0 group-hover:opacity-100 text-slate-300"
                                        )}
                                    >
                                        <Star className={cn("w-3 h-3", favorites.has(player.id) && "fill-current")} />
                                    </button>

                                    {/* Rank */}
                                    <div className="text-center text-xs font-mono text-slate-500 ml-4">
                                        {player.rank || '-'}
                                    </div>

                                    {/* Position */}
                                    <div className="flex justify-center">
                                        <span className={cn(
                                            "w-9 py-0.5 rounded-sm text-[9px] font-black border text-center",
                                            positionBadgeColors[player.position] || "bg-slate-700/50 text-slate-400 border-slate-600"
                                        )}>
                                            {player.position}
                                        </span>
                                    </div>

                                    {/* Player Name & Team */}
                                    <div className="pl-2 min-w-0 flex items-center justify-between">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className={cn(
                                                    "text-xs font-bold truncate transition-colors",
                                                    "text-slate-900 group-hover:text-blue-600"
                                                )}>
                                                    {player.fullName.split(' ')[0]?.[0]}. {player.fullName.split(' ').slice(1).join(' ')}
                                                </span>
                                                {player.injuryStatus && (
                                                    <span className="text-[9px] font-bold text-red-500 uppercase shrink-0 bg-red-500/10 px-1 rounded-sm">
                                                        {player.injuryStatus}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-medium uppercase">{player.nflTeam || 'FA'}</div>
                                        </div>

                                        {isMyTurn && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDraftPlayer(player.id);
                                                }}
                                                className={cn(
                                                    "opacity-0 group-hover:opacity-100 transition-all duration-200",
                                                    "bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white",
                                                    "text-[9px] font-black px-2.5 py-1 rounded-sm shadow-lg shadow-blue-500/30",
                                                    "hover:scale-110 active:scale-95 shrink-0 ml-3"
                                                )}
                                            >
                                                DRAFT
                                            </button>
                                        )}
                                    </div>

                                    {/* ADP */}
                                    <div className="text-center text-[11px] font-medium text-slate-400">
                                        {player.adp ? Math.round(player.adp) : '-'}
                                    </div>

                                    {/* BYE */}
                                    <div className="text-center text-[11px] font-medium text-slate-400">
                                        {player.bye || '-'}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </ScrollArea>

            {/* Bottom Tooltip Bar */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center gap-2">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Info className="w-4 h-4 text-slate-600 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="max-w-[200px] text-xs">
                                Hover over a player and click "DRAFT" to pick them.
                            </p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Controls</span>
            </div>
        </div>
    );
}

export default PlayerPool;
