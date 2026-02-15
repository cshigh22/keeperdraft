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
    teamQueue: PlayerSummary[];
    onUpdateQueue: (playerIds: string[]) => void;
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
    teamQueue,
    onUpdateQueue,
    isLoading = false,
}: PlayerPoolProps) {
    const [search, setSearch] = useState('');
    const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
    const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
    const [activeTab, setActiveTab] = useState<'POOL' | 'QUEUE'>('POOL');

    // Sync favorites with teamQueue from props
    // We'll use the teamQueue as the source of truth for "stars"
    const favorites = useMemo(() => new Set(teamQueue.map(p => p.id)), [teamQueue]);

    // Toggle favorite (Add/Remove from Queue)
    const toggleFavorite = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (favorites.has(id)) {
            onUpdateQueue(teamQueue.filter(p => p.id !== id).map(p => p.id));
        } else {
            onUpdateQueue([...teamQueue.map(p => p.id), id]);
        }
    };

    const moveQueuedPlayer = (id: string, direction: 'UP' | 'DOWN') => {
        const index = teamQueue.findIndex(p => p.id === id);
        if (index === -1) return;

        const newQueue = [...teamQueue];
        if (direction === 'UP' && index > 0) {
            const temp = newQueue[index] as PlayerSummary;
            newQueue[index] = newQueue[index - 1] as PlayerSummary;
            newQueue[index - 1] = temp;
        } else if (direction === 'DOWN' && index < newQueue.length - 1) {
            const temp = newQueue[index] as PlayerSummary;
            newQueue[index] = newQueue[index + 1] as PlayerSummary;
            newQueue[index + 1] = temp;
        } else {
            return;
        }
        onUpdateQueue(newQueue.map(p => p.id));
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

            </div>

            {/* Tab Switcher */}
            <div className="flex border-b border-slate-200">
                <button
                    onClick={() => setActiveTab('POOL')}
                    className={cn(
                        "flex-1 py-2 text-xs font-bold transition-all border-b-2",
                        activeTab === 'POOL' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"
                    )}
                >
                    PLAYERS
                </button>
                <button
                    onClick={() => setActiveTab('QUEUE')}
                    className={cn(
                        "flex-1 py-2 text-xs font-bold transition-all border-b-2 relative",
                        activeTab === 'QUEUE' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"
                    )}
                >
                    QUEUE
                    {teamQueue.length > 0 && (
                        <span className="absolute top-1 right-4 w-4 h-4 bg-blue-600 text-white text-[9px] rounded-full flex items-center justify-center">
                            {teamQueue.length}
                        </span>
                    )}
                </button>
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
                    {activeTab === 'POOL' ? (
                        <>
                            {/* Position Filters inside POOL tab */}
                            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar p-3 bg-slate-50/50">
                                {(['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'] as PositionFilter[]).map((pos) => (
                                    <button
                                        key={pos}
                                        onClick={() => setPositionFilter(pos)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-md text-[10px] font-bold transition-all border shrink-0",
                                            positionFilter === pos
                                                ? "bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/10"
                                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                        )}
                                    >
                                        {pos}
                                    </button>
                                ))}
                            </div>

                            {filteredPlayers.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-2">
                                    <Search className="w-12 h-12 opacity-10" />
                                    <p className="text-sm font-medium">No players found</p>
                                </div>
                            ) : (
                                filteredPlayers.map((player) => (
                                    <PlayerRow
                                        key={player.id}
                                        player={player}
                                        isMyTurn={isMyTurn}
                                        onDraftPlayer={onDraftPlayer}
                                        isFavorited={favorites.has(player.id)}
                                        onToggleFavorite={toggleFavorite}
                                    />
                                ))
                            )}
                        </>
                    ) : (
                        <div className="flex flex-col h-full">
                            {teamQueue.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-2">
                                    <Star className="w-12 h-12 opacity-10" />
                                    <p className="text-sm font-medium text-center px-6">Your queue is empty. Star players from the pool to add them here.</p>
                                </div>
                            ) : (
                                teamQueue.map((player, index) => (
                                    <div key={player.id} className="relative group">
                                        <PlayerRow
                                            player={player}
                                            isMyTurn={isMyTurn}
                                            onDraftPlayer={onDraftPlayer}
                                            isFavorited={true}
                                            onToggleFavorite={toggleFavorite}
                                            showOrderControls
                                            isFirst={index === 0}
                                            isLast={index === teamQueue.length - 1}
                                            onMove={moveQueuedPlayer}
                                        />
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface PlayerRowProps {
    player: PlayerSummary;
    isMyTurn: boolean;
    onDraftPlayer: (playerId: string) => void;
    isFavorited: boolean;
    onToggleFavorite: (id: string, e: React.MouseEvent) => void;
    showOrderControls?: boolean;
    isFirst?: boolean;
    isLast?: boolean;
    onMove?: (id: string, direction: 'UP' | 'DOWN') => void;
}

function PlayerRow({
    player,
    isMyTurn,
    onDraftPlayer,
    isFavorited,
    onToggleFavorite,
    showOrderControls,
    isFirst,
    isLast,
    onMove,
}: PlayerRowProps) {
    return (
        <div
            className={cn(
                "grid grid-cols-[36px,44px,1fr,44px,44px] gap-2 px-4 py-2.5 items-center transition-all group",
                "relative border-b border-slate-100",
                "hover:bg-slate-50"
            )}
        >
            {/* Star Overlay on hover */}
            <button
                onClick={(e) => onToggleFavorite(player.id, e)}
                className={cn(
                    "absolute left-1 top-1/2 -translate-y-1/2 p-1 transition-opacity",
                    isFavorited ? "opacity-100 text-yellow-500" : "opacity-0 group-hover:opacity-100 text-slate-300"
                )}
            >
                <Star className={cn("w-3 h-3", isFavorited && "fill-current")} />
            </button>

            {/* Rank or Order Controls */}
            <div className="flex flex-col items-center justify-center ml-4">
                {showOrderControls ? (
                    <div className="flex flex-col -space-y-1">
                        <button
                            disabled={isFirst}
                            onClick={() => onMove?.(player.id, 'UP')}
                            className={cn("p-0.5 hover:text-blue-600 disabled:opacity-0")}
                        >
                            <Info className="w-3 h-3 rotate-180" /> {/* Placeholder for up arrow */}
                        </button>
                        <button
                            disabled={isLast}
                            onClick={() => onMove?.(player.id, 'DOWN')}
                            className={cn("p-0.5 hover:text-blue-600 disabled:opacity-0")}
                        >
                            <Info className="w-3 h-3" /> {/* Placeholder for down arrow */}
                        </button>
                    </div>
                ) : (
                    <div className="text-center text-xs font-mono text-slate-500">
                        {player.rank || '-'}
                    </div>
                )}
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
}

export default PlayerPool;
