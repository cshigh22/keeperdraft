// Player Queue / Selection Sidebar
// Searchable list of available players with drafting capability

'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Star, ChevronUp, ChevronDown, Check } from 'lucide-react';
import type { PlayerSummary } from '@/types/socket';

// ============================================================================
// TYPES
// ============================================================================

interface PlayerQueueProps {
  players: PlayerSummary[];
  isMyTurn: boolean;
  currentTeamName: string | null;
  timerSeconds: number | null;
  isPaused: boolean;
  isLoading?: boolean;
  onDraftPlayer: (playerId: string) => void;
}

type Position = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';
type SortField = 'rank' | 'name' | 'position';
type SortDirection = 'asc' | 'desc';

// ============================================================================
// POSITION STYLING
// ============================================================================

const positionColors: Record<string, string> = {
  QB: 'bg-red-500',
  RB: 'bg-green-500',
  WR: 'bg-blue-500',
  TE: 'bg-orange-500',
  K: 'bg-purple-500',
  DEF: 'bg-gray-500',
};

// ============================================================================
// TIMER DISPLAY
// ============================================================================

function TimerDisplay({ seconds, isPaused }: { seconds: number | null; isPaused: boolean }) {
  if (seconds === null) return null;

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const isLow = seconds <= 30;
  const isCritical = seconds <= 10;

  return (
    <div
      className={cn(
        'text-4xl font-mono font-bold text-center py-2 rounded-lg transition-colors',
        isPaused && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
        !isPaused && !isLow && 'bg-primary/10 text-primary',
        !isPaused && isLow && !isCritical && 'bg-orange-100 text-orange-700 dark:bg-orange-900',
        !isPaused && isCritical && 'bg-red-100 text-red-700 dark:bg-red-900 animate-pulse'
      )}
    >
      {isPaused ? (
        <span className="text-2xl">PAUSED</span>
      ) : (
        `${mins}:${secs.toString().padStart(2, '0')}`
      )}
    </div>
  );
}

// ============================================================================
// PLAYER ROW
// ============================================================================

interface PlayerRowProps {
  player: PlayerSummary;
  isSelected: boolean;
  onSelect: () => void;
  onDraft: () => void;
  canDraft: boolean;
}

function PlayerRow({ player, isSelected, onSelect, onDraft, canDraft }: PlayerRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
        'hover:bg-accent/50',
        isSelected && 'bg-primary/10 border-primary'
      )}
      onClick={onSelect}
    >
      {/* Rank */}
      <div className="w-10 text-center">
        <span className="text-sm font-mono text-muted-foreground">
          {player.rank || '-'}
        </span>
      </div>

      {/* Position Badge */}
      <Badge
        className={cn(
          'w-10 justify-center text-white font-bold',
          positionColors[player.position] || 'bg-gray-500'
        )}
      >
        {player.position}
      </Badge>

      {/* Player Info */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate">{player.fullName}</p>
        <p className="text-xs text-muted-foreground">
          {player.nflTeam || 'Free Agent'}
        </p>
      </div>

      {/* Draft Button */}
      {canDraft && (
        <Button
          size="sm"
          variant={isSelected ? 'default' : 'outline'}
          onClick={(e) => {
            e.stopPropagation();
            onDraft();
          }}
          className="shrink-0"
        >
          {isSelected ? <Check className="w-4 h-4 mr-1" /> : null}
          Draft
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// PLAYER QUEUE COMPONENT
// ============================================================================

export function PlayerQueue({
  players,
  isMyTurn,
  currentTeamName,
  timerSeconds,
  isPaused,
  isLoading = false,
  onDraftPlayer,
}: PlayerQueueProps) {
  // State
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState<Position>('ALL');
  const [sortField, setSortField] = useState<SortField>('rank');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSummary | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  // Filtered and sorted players
  const filteredPlayers = useMemo(() => {
    let result = [...players];

    // Search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.fullName.toLowerCase().includes(searchLower) ||
          p.nflTeam?.toLowerCase().includes(searchLower)
      );
    }

    // Position filter
    if (positionFilter !== 'ALL') {
      result = result.filter((p) => p.position === positionFilter);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'rank':
          comparison = (a.rank || 9999) - (b.rank || 9999);
          break;
        case 'name':
          comparison = a.fullName.localeCompare(b.fullName);
          break;
        case 'position':
          comparison = a.position.localeCompare(b.position);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [players, search, positionFilter, sortField, sortDirection]);

  // Handlers
  const handleDraftClick = useCallback((player: PlayerSummary) => {
    setSelectedPlayer(player);
    setConfirmDialogOpen(true);
  }, []);

  const handleConfirmDraft = useCallback(() => {
    if (selectedPlayer) {
      onDraftPlayer(selectedPlayer.id);
      setConfirmDialogOpen(false);
      setSelectedPlayer(null);
    }
  }, [selectedPlayer, onDraftPlayer]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Position counts
  const positionCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: players.length };
    players.forEach((p) => {
      counts[p.position] = (counts[p.position] || 0) + 1;
    });
    return counts;
  }, [players]);

  return (
    <>
      <Card className="w-full lg:w-96 flex flex-col h-full">
        <CardHeader className="pb-3 space-y-3">
          <CardTitle className="text-lg">Player Selection</CardTitle>

          {/* Timer */}
          <TimerDisplay seconds={timerSeconds} isPaused={isPaused} />

          {/* Current team on the clock */}
          <div
            className={cn(
              'text-center py-2 rounded-lg',
              isMyTurn
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 font-bold'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {isMyTurn ? (
              <span className="flex items-center justify-center gap-2">
                <Star className="w-4 h-4 fill-current" />
                You are on the clock!
              </span>
            ) : currentTeamName ? (
              <span>On the clock: {currentTeamName}</span>
            ) : (
              <span>Waiting for draft to start...</span>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search players..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
          {/* Position Filter Tabs */}
          <Tabs
            value={positionFilter}
            onValueChange={(v) => setPositionFilter(v as Position)}
            className="px-4"
          >
            <TabsList className="w-full grid grid-cols-7 h-auto">
              {(['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as Position[]).map((pos) => (
                <TabsTrigger
                  key={pos}
                  value={pos}
                  className="text-xs py-1.5 px-1"
                >
                  <span className="hidden sm:inline">{pos}</span>
                  <span className="sm:hidden">{pos === 'ALL' ? 'All' : pos}</span>
                  <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1">
                    {positionCounts[pos] || 0}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Sort Controls */}
          <div className="flex items-center gap-2 px-4 py-2 border-b">
            <span className="text-xs text-muted-foreground">Sort by:</span>
            <Select
              value={sortField}
              onValueChange={(v) => setSortField(v as SortField)}
            >
              <SelectTrigger className="w-24 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rank">Rank</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="position">Position</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => toggleSort(sortField)}
            >
              {sortDirection === 'asc' ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              {filteredPlayers.length} players
            </span>
          </div>

          {/* Player List */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {isLoading ? (
                // Loading skeletons
                Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3">
                    <Skeleton className="w-10 h-6" />
                    <Skeleton className="w-10 h-6" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                  </div>
                ))
              ) : filteredPlayers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No players found</p>
                  <p className="text-sm mt-1">Try adjusting your filters</p>
                </div>
              ) : (
                filteredPlayers.map((player) => (
                  <PlayerRow
                    key={player.id}
                    player={player}
                    isSelected={selectedPlayer?.id === player.id}
                    onSelect={() => setSelectedPlayer(player)}
                    onDraft={() => handleDraftClick(player)}
                    canDraft={isMyTurn && !isPaused}
                  />
                ))
              )}
            </div>
          </ScrollArea>

          {/* Quick Draft Footer (when player selected) */}
          {selectedPlayer && isMyTurn && !isPaused && (
            <div className="p-4 border-t bg-muted/50">
              <Button
                className="w-full"
                size="lg"
                onClick={() => handleDraftClick(selectedPlayer)}
              >
                Draft {selectedPlayer.fullName}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Pick</DialogTitle>
            <DialogDescription>
              Are you sure you want to draft this player?
            </DialogDescription>
          </DialogHeader>

          {selectedPlayer && (
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
              <Badge
                className={cn(
                  'w-12 h-12 text-lg justify-center text-white font-bold',
                  positionColors[selectedPlayer.position] || 'bg-gray-500'
                )}
              >
                {selectedPlayer.position}
              </Badge>
              <div>
                <p className="font-bold text-lg">{selectedPlayer.fullName}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedPlayer.nflTeam || 'Free Agent'}
                  {selectedPlayer.rank && ` • Rank #${selectedPlayer.rank}`}
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmDraft}>
              Confirm Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default PlayerQueue;
