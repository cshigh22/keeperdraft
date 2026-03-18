// Player Pool Sidebar Component
// Redesigned to match the reference image aesthetics

'use client';

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Star, Info, GripVertical } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
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
    rosterSettings?: any;
    teamRosters?: Record<string, any[]>;
    currentTeamId?: string | null;
    myTeamId?: string | null;
}

type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

// ============================================================================
// POSITIONAL REQUIREMENT LOGIC
// ============================================================================

function getRestrictedPositions(roster: any[] = [], settings: any = {}) {
    if (!settings) return [];

    const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
    roster.forEach(p => {
        const pos = p.position as string;
        const targetPos = pos === 'DST' ? 'DEF' : pos;
        if (counts[targetPos] !== undefined) {
            counts[targetPos] = (counts[targetPos] || 0) + 1;
        }
    });

    let remQB = settings.qbCount || 0;
    let remRB = settings.rbCount || 0;
    let remWR = settings.wrCount || 0;
    let remTE = settings.teCount || 0;
    let remK = settings.kCount || 0;
    let remDEF = settings.defCount || 0;
    let remFLEX = settings.flexCount || 0;
    let remSFLEX = settings.superflexCount || 0;

    // 1. Primary slots
    let leftQB = Math.max(0, (counts.QB || 0) - remQB);
    remQB = Math.max(0, remQB - (counts.QB || 0));

    let leftRB = Math.max(0, (counts.RB || 0) - remRB);
    remRB = Math.max(0, remRB - (counts.RB || 0));

    let leftWR = Math.max(0, (counts.WR || 0) - remWR);
    remWR = Math.max(0, remWR - (counts.WR || 0));

    let leftTE = Math.max(0, (counts.TE || 0) - remTE);
    remTE = Math.max(0, remTE - (counts.TE || 0));

    let leftK = Math.max(0, (counts.K || 0) - remK);
    remK = Math.max(0, remK - (counts.K || 0));

    let leftDEF = Math.max(0, (counts.DEF || 0) - remDEF);
    remDEF = Math.max(0, remDEF - (counts.DEF || 0));

    // 2. FLEX (RB/WR/TE)
    const fillingFLEX = Math.min(remFLEX, leftRB + leftWR + leftTE);
    let fNeed = fillingFLEX;
    let uRB = Math.min(fNeed, leftRB); leftRB -= uRB; fNeed -= uRB;
    let uWR = Math.min(fNeed, leftWR); leftWR -= uWR; fNeed -= uWR;
    let uTE = Math.min(fNeed, leftTE); leftTE -= uTE;
    remFLEX -= fillingFLEX;

    // 3. SFLEX (QB/RB/WR/TE)
    const fillingSFLEX = Math.min(remSFLEX, leftQB + leftRB + leftWR + leftTE);
    let sfNeed = fillingSFLEX;
    let sQB = Math.min(sfNeed, leftQB); leftQB -= sQB; sfNeed -= sQB;
    let sRB = Math.min(sfNeed, leftRB); leftRB -= sRB; sfNeed -= sRB;
    let sWR = Math.min(sfNeed, leftWR); leftWR -= sWR; sfNeed -= sWR;
    let sTE = Math.min(sfNeed, leftTE); leftTE -= sTE;
    remSFLEX -= fillingSFLEX;

    const totalEmptyStarters = remQB + remRB + remWR + remTE + remK + remDEF + remFLEX + remSFLEX;
    const currentBenchCount = leftQB + leftRB + leftWR + leftTE + leftK + leftDEF;
    const benchLimit = settings.benchCount || 0;

    // If no starters left, we are in "Bench mode" where positions are NOT restricted
    if (totalEmptyStarters === 0) return [];

    // Rule: If bench is under the limit, you can draft any position.
    // If bench is full, you MUST fulfill the remaining starting positions.
    if (currentBenchCount < benchLimit) return [];

    const restricted = [];
    if (remQB === 0 && remSFLEX === 0) restricted.push('QB');
    if (remRB === 0 && remFLEX === 0 && remSFLEX === 0) restricted.push('RB');
    if (remWR === 0 && remFLEX === 0 && remSFLEX === 0) restricted.push('WR');
    if (remTE === 0 && remFLEX === 0 && remSFLEX === 0) restricted.push('TE');
    if (remK === 0) restricted.push('K');
    if (remDEF === 0) restricted.push('DEF');

    return restricted;
}

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
    rosterSettings,
    teamRosters,
    currentTeamId,
    myTeamId,
}: PlayerPoolProps) {
    const [search, setSearch] = useState('');
    const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
    const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
    const [activeTab, setActiveTab] = useState<'POOL' | 'QUEUE'>('POOL');

    // Calculate restricted positions for the current user's team
    const restrictedPositions = useMemo(() => {
        if (!myTeamId || !rosterSettings || !teamRosters) return [];
        const roster = teamRosters[myTeamId] || [];
        return getRestrictedPositions(roster, rosterSettings);
    }, [myTeamId, rosterSettings, teamRosters]);

    const isPositionRestricted = (pos: string) => {
        const targetPos = pos === 'DST' ? 'DEF' : pos;
        return restrictedPositions.includes(targetPos);
    };

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

    const onDragEnd = (result: DropResult) => {
        if (!result.destination) return;

        const items = [...teamQueue];
        const [reorderedItem] = items.splice(result.source.index, 1);
        if (!reorderedItem) return;
        items.splice(result.destination.index, 0, reorderedItem);

        onUpdateQueue(items.map(p => p.id));
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
            <div className={cn(
                "grid gap-2 px-4 py-2 bg-slate-50 border-y border-slate-200 text-[10px] font-bold text-slate-500 tracking-widest uppercase",
                activeTab === 'QUEUE'
                    ? "grid-cols-[36px,44px,1fr,44px,44px,36px]"
                    : "grid-cols-[36px,44px,1fr,44px,44px]"
            )}>
                <div className="text-center font-mono ml-4">#</div>
                <div className="text-center">POS</div>
                <div className="pl-2">PLAYER</div>
                <div className="text-center">ADP</div>
                <div className="text-center">BYE</div>
                {activeTab === 'QUEUE' && <div className="text-center"></div>}
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
                                        isRestricted={isPositionRestricted(player.position)}
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
                                <DragDropContext onDragEnd={onDragEnd}>
                                    <Droppable droppableId="queue">
                                        {(provided) => (
                                            <div
                                                {...provided.droppableProps}
                                                ref={provided.innerRef}
                                                className="flex flex-col h-full"
                                            >
                                                {teamQueue.map((player, index) => (
                                                    <Draggable key={player.id} draggableId={player.id} index={index}>
                                                        {(provided, snapshot) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                style={{
                                                                    ...provided.draggableProps.style,
                                                                    opacity: snapshot.isDragging ? 0.8 : 1,
                                                                    zIndex: snapshot.isDragging ? 50 : 1
                                                                }}
                                                            >
                                                                <PlayerRow
                                                                    player={player}
                                                                    isMyTurn={isMyTurn}
                                                                    onDraftPlayer={onDraftPlayer}
                                                                    isFavorited={true}
                                                                    onToggleFavorite={toggleFavorite}
                                                                    showOrderControls
                                                                    dragHandleProps={provided.dragHandleProps}
                                                                    isRestricted={isPositionRestricted(player.position)}
                                                                />
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </DragDropContext>
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
    dragHandleProps?: any;
    isRestricted?: boolean;
}

const PlayerRow = React.memo(function PlayerRow({
    player,
    isMyTurn,
    onDraftPlayer,
    isFavorited,
    onToggleFavorite,
    showOrderControls,
    dragHandleProps,
    isRestricted = false,
}: PlayerRowProps) {
    return (
        <div
            className={cn(
                "grid gap-2 px-4 py-2.5 items-center transition-all group",
                "relative border-b border-slate-100",
                "hover:bg-slate-50",
                isRestricted && !isFavorited && "opacity-50 grayscale-[0.5]",
                showOrderControls ? "grid-cols-[36px,44px,1fr,44px,44px,36px]" : "grid-cols-[36px,44px,1fr,44px,44px]"
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

            {/* Rank */}
            <div className="flex flex-col items-center justify-center ml-4">
                <div className="text-center text-xs font-mono text-slate-500">
                    {player.rank || '-'}
                </div>
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
                            "text-slate-900 group-hover:text-blue-600",
                            isRestricted && "text-slate-400"
                        )}>
                            {player.fullName.split(' ')[0]?.[0]}. {player.fullName.split(' ').slice(1).join(' ')}
                        </span>
                        {player.injuryStatus && (
                            <span className="text-[9px] font-bold text-red-500 uppercase shrink-0 bg-red-500/10 px-1 rounded-sm">
                                {player.injuryStatus}
                            </span>
                        )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase">
                        {player.nflTeam || 'FA'}
                        {isRestricted && <span className="ml-2 text-amber-600 font-bold lowercase italic text-[9px]">(pos full)</span>}
                    </div>
                </div>

                {isMyTurn && (
                    <TooltipProvider>
                        <Tooltip delayDuration={0}>
                            <TooltipTrigger asChild>
                                <button
                                    disabled={isRestricted}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isRestricted) onDraftPlayer(player.id);
                                    }}
                                    className={cn(
                                        "transition-all duration-200",
                                        isRestricted
                                            ? "bg-slate-200 text-slate-400 cursor-not-allowed opacity-50"
                                            : "opacity-0 group-hover:opacity-100 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-500/30 hover:scale-110",
                                        "text-[9px] font-black px-2.5 py-1 rounded-sm shrink-0 ml-3 active:scale-95"
                                    )}
                                >
                                    DRAFT
                                </button>
                            </TooltipTrigger>
                            {isRestricted && (
                                <TooltipContent side="left" className="bg-slate-900 text-white border-none text-[10px]">
                                    Fill remaining required starters first
                                </TooltipContent>
                            )}
                        </Tooltip>
                    </TooltipProvider>
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

            {/* Drag Handle */}
            {showOrderControls && (
                <div
                    {...dragHandleProps}
                    className="flex justify-center p-1 text-slate-300 hover:text-slate-600 cursor-grab active:cursor-grabbing"
                >
                    <GripVertical className="w-4 h-4" />
                </div>
            )}
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparator: only re-render when props that affect output change
    return (
        prevProps.player.id === nextProps.player.id &&
        prevProps.isMyTurn === nextProps.isMyTurn &&
        prevProps.isFavorited === nextProps.isFavorited &&
        prevProps.isRestricted === nextProps.isRestricted &&
        prevProps.showOrderControls === nextProps.showOrderControls
    );
});

export default PlayerPool;
