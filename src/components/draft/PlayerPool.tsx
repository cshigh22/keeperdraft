// Player Pool Sidebar Component
// Redesigned to match the reference image aesthetics

'use client';

import React, { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Star, GripVertical } from 'lucide-react';
import {
    DragDropContext,
    Droppable,
    Draggable,
    type DropResult,
    type DraggableProvidedDragHandleProps,
} from '@hello-pangea/dnd';
import type {
    DraftPickSummary,
    PlayerSummary,
    RosterPlayer,
    RosterSettings,
} from '@/types/socket';
import { getRestrictedPositions, normalizePosition } from '@/lib/roster-restrictions';
import { positionBadgeColors } from './position-styles';
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
    onToggleQueue: (playerId: string) => void;
    rosterSettings?: RosterSettings;
    teamRosters?: Record<string, RosterPlayer[]>;
    currentTeamId?: string | null;
    myTeamId?: string | null;
    allPicks?: DraftPickSummary[];
}

type PositionFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

const POSITION_FILTERS: readonly PositionFilter[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];

// "Patrick Mahomes" -> "P. Mahomes"
function abbreviateName(fullName: string): string {
    const [first, ...rest] = fullName.split(' ');
    return `${first?.[0]}. ${rest.join(' ')}`;
}

// ============================================================================
// PLAYER POOL COMPONENT
// ============================================================================

export function PlayerPool({
    players,
    isMyTurn,
    onDraftPlayer,
    teamQueue,
    onUpdateQueue,
    onToggleQueue,
    rosterSettings,
    teamRosters,
    myTeamId,
    allPicks,
}: PlayerPoolProps) {
    const [search, setSearch] = useState('');
    const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL');
    const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
    const [activeTab, setActiveTab] = useState<'POOL' | 'QUEUE'>('POOL');

    // Calculate restricted positions for the current user's team
    const restrictedPositions = useMemo(() => {
        if (!myTeamId || !rosterSettings || !teamRosters) return [];
        const roster = teamRosters[myTeamId] || [];
        const myRemainingPicks = allPicks
            ? allPicks.filter(p => p.currentOwnerId === myTeamId && !p.isComplete).length
            : 999;
        return getRestrictedPositions(
            roster.map(p => p.position),
            rosterSettings,
            myRemainingPicks
        );
    }, [myTeamId, rosterSettings, teamRosters, allPicks]);

    const isPositionRestricted = (pos: string) =>
        restrictedPositions.includes(normalizePosition(pos));

    // The teamQueue is the source of truth for "starred" players
    const favorites = useMemo(() => new Set(teamQueue.map(p => p.id)), [teamQueue]);

    // Toggle favorite (Add/Remove from Queue)
    const toggleFavorite = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        onToggleQueue(id);
    };

    const onDragEnd = (result: DropResult) => {
        if (!result.destination) return;

        const items = [...teamQueue];
        const [reorderedItem] = items.splice(result.source.index, 1);
        if (!reorderedItem) return;
        items.splice(result.destination.index, 0, reorderedItem);

        onUpdateQueue(items.map(p => p.id));
    };

    const filteredPlayers = useMemo(() => {
        // Exclude players who are already kept (should be handled by server, but extra safety)
        let result = players.filter(p => !p.keptByTeam);

        if (search.trim()) {
            const s = search.toLowerCase();
            result = result.filter(p => p.fullName.toLowerCase().includes(s));
        }

        if (positionFilter !== 'ALL') {
            const filter = normalizePosition(positionFilter);
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
                                {POSITION_FILTERS.map((pos) => (
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
                                <VirtualizedPlayerList
                                    players={filteredPlayers}
                                    isMyTurn={isMyTurn}
                                    onDraftPlayer={onDraftPlayer}
                                    favorites={favorites}
                                    onToggleFavorite={toggleFavorite}
                                    isPositionRestricted={isPositionRestricted}
                                />
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
// VIRTUALIZED PLAYER LIST
// ============================================================================

const ROW_HEIGHT = 52; // px per player row

interface VirtualizedPlayerListProps {
    players: PlayerSummary[];
    isMyTurn: boolean;
    onDraftPlayer: (playerId: string) => void;
    favorites: Set<string>;
    onToggleFavorite: (id: string, e: React.MouseEvent) => void;
    isPositionRestricted: (pos: string) => boolean;
}

function VirtualizedPlayerList({
    players,
    isMyTurn,
    onDraftPlayer,
    favorites,
    onToggleFavorite,
    isPositionRestricted,
}: VirtualizedPlayerListProps) {
    const parentRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: players.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => ROW_HEIGHT,
        overscan: 10, // Render 10 extra rows above/below viewport for smooth scrolling
    });

    return (
        <div
            ref={parentRef}
            style={{ height: '100%', overflow: 'auto' }}
        >
            <div
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
            >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                    const player = players[virtualRow.index]!;
                    return (
                        <div
                            key={player.id}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                        >
                            <PlayerRow
                                player={player}
                                isMyTurn={isMyTurn}
                                onDraftPlayer={onDraftPlayer}
                                isFavorited={favorites.has(player.id)}
                                onToggleFavorite={onToggleFavorite}
                                isRestricted={isPositionRestricted(player.position)}
                            />
                        </div>
                    );
                })}
            </div>
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
    dragHandleProps?: DraggableProvidedDragHandleProps | null;
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
                            {abbreviateName(player.fullName)}
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
    // Custom comparator: re-render only when props that affect output change.
    // Callback identity changes are deliberately ignored.
    return (
        prevProps.player.id === nextProps.player.id &&
        prevProps.isMyTurn === nextProps.isMyTurn &&
        prevProps.isFavorited === nextProps.isFavorited &&
        prevProps.isRestricted === nextProps.isRestricted &&
        prevProps.showOrderControls === nextProps.showOrderControls
    );
});

export default PlayerPool;
