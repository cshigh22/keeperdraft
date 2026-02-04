// Draft Board Component
// Visual grid showing all rounds and picks with real-time updates

'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TeamSummary, DraftPickSummary } from '@/types/socket';

// ============================================================================
// TYPES
// ============================================================================

interface DraftBoardProps {
  teams: TeamSummary[];
  completedPicks: DraftPickSummary[];
  totalRounds: number;
  currentPick: number;
  currentTeamId: string | null;
  isPaused: boolean;
  draftType: 'SNAKE' | 'LINEAR';
  myTeamId?: string;
}

interface PickCellProps {
  pick: DraftPickSummary | null;
  team: TeamSummary;
  round: number;
  pickNumber: number;
  isCurrentPick: boolean;
  isPaused: boolean;
  isMyTeam: boolean;
  isTraded: boolean;
}

// ============================================================================
// POSITION STYLING
// ============================================================================

const positionColors: Record<string, { bg: string; text: string; border: string }> = {
  QB: { bg: 'bg-red-100 dark:bg-red-950', text: 'text-red-700 dark:text-red-300', border: 'border-red-300' },
  RB: { bg: 'bg-green-100 dark:bg-green-950', text: 'text-green-700 dark:text-green-300', border: 'border-green-300' },
  WR: { bg: 'bg-blue-100 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-300' },
  TE: { bg: 'bg-orange-100 dark:bg-orange-950', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-300' },
  K: { bg: 'bg-purple-100 dark:bg-purple-950', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-300' },
  DEF: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300', border: 'border-gray-300' },
};

function getPositionStyle(position?: string) {
  return positionColors[position || ''] || positionColors.DEF;
}

// ============================================================================
// PICK CELL COMPONENT
// ============================================================================

function PickCell({
  pick,
  team,
  round,
  pickNumber,
  isCurrentPick,
  isPaused,
  isMyTeam,
  isTraded,
}: PickCellProps) {
  const isFilled = pick?.isComplete && pick.selectedPlayer;
  const positionStyle = isFilled ? getPositionStyle(pick.selectedPlayer?.position) : null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'relative h-20 min-w-[140px] rounded-lg border-2 p-2 transition-all duration-200',
              // Base styles
              'flex flex-col justify-between',
              // Empty pick
              !isFilled && 'bg-muted/50 border-muted-foreground/20',
              // Filled pick with position color
              isFilled && positionStyle?.bg,
              isFilled && positionStyle?.border,
              // Current pick highlight
              isCurrentPick && !isPaused && 'ring-2 ring-primary ring-offset-2 animate-pulse',
              isCurrentPick && isPaused && 'ring-2 ring-yellow-500 ring-offset-2',
              // My team highlight
              isMyTeam && !isFilled && 'border-primary/50 bg-primary/5',
              // Traded pick indicator
              isTraded && 'border-dashed'
            )}
          >
            {/* Pick number badge */}
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs font-mono">
                {pickNumber}
              </Badge>
              {isTraded && (
                <Badge variant="secondary" className="text-[10px]">
                  Traded
                </Badge>
              )}
            </div>

            {/* Content */}
            {isFilled ? (
              // Filled pick - show player
              <div className="flex-1 flex flex-col justify-center">
                <div className="flex items-center gap-1">
                  <Badge 
                    className={cn(
                      'text-[10px] font-bold px-1',
                      positionStyle?.bg,
                      positionStyle?.text
                    )}
                  >
                    {pick.selectedPlayer?.position}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {pick.selectedPlayer?.nflTeam || 'FA'}
                  </span>
                </div>
                <p className="font-semibold text-sm truncate mt-0.5">
                  {pick.selectedPlayer?.fullName}
                </p>
              </div>
            ) : (
              // Empty pick - show team
              <div className="flex-1 flex flex-col justify-center">
                <p className="text-xs text-muted-foreground">
                  {team.ownerName}
                </p>
                <p className="font-medium text-sm truncate">
                  {team.name}
                </p>
              </div>
            )}

            {/* Current pick indicator */}
            {isCurrentPick && (
              <div
                className={cn(
                  'absolute -top-1 -right-1 w-3 h-3 rounded-full',
                  isPaused ? 'bg-yellow-500' : 'bg-primary animate-ping'
                )}
              />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-semibold">Round {round}, Pick {pickNumber}</p>
            <p className="text-muted-foreground">{team.name}</p>
            {isFilled && (
              <>
                <p className="mt-1 font-medium">{pick.selectedPlayer?.fullName}</p>
                <p className="text-xs text-muted-foreground">
                  {pick.selectedPlayer?.position} - {pick.selectedPlayer?.nflTeam || 'FA'}
                </p>
              </>
            )}
            {isTraded && pick && (
              <p className="text-xs text-yellow-600 mt-1">
                Originally: {pick.originalOwnerId !== pick.currentOwnerId ? 'Traded' : ''}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================================================
// DRAFT BOARD COMPONENT
// ============================================================================

export function DraftBoard({
  teams,
  completedPicks,
  totalRounds,
  currentPick,
  currentTeamId,
  isPaused,
  draftType,
  myTeamId,
}: DraftBoardProps) {
  // Build pick grid - maps each cell to a pick
  const pickGrid = useMemo(() => {
    const grid: (DraftPickSummary | null)[][] = [];
    const pickMap = new Map(completedPicks.map((p) => [p.overallPickNumber, p]));
    const teamCount = teams.length;

    for (let round = 1; round <= totalRounds; round++) {
      const roundPicks: (DraftPickSummary | null)[] = [];
      
      for (let position = 1; position <= teamCount; position++) {
        // Calculate overall pick number based on draft type
        let overallPick: number;
        
        if (draftType === 'SNAKE') {
          // Snake: odd rounds go 1-N, even rounds go N-1
          if (round % 2 === 1) {
            overallPick = (round - 1) * teamCount + position;
          } else {
            overallPick = (round - 1) * teamCount + (teamCount - position + 1);
          }
        } else {
          // Linear: always 1-N
          overallPick = (round - 1) * teamCount + position;
        }

        roundPicks.push(pickMap.get(overallPick) || null);
      }

      grid.push(roundPicks);
    }

    return grid;
  }, [completedPicks, teams.length, totalRounds, draftType]);

  // Calculate which team has each pick
  const getTeamForPick = (round: number, position: number): TeamSummary => {
    if (draftType === 'SNAKE' && round % 2 === 0) {
      // Reverse order for even rounds in snake
      const team = teams[teams.length - position];
      return team ?? teams[0]!;
    }
    const team = teams[position - 1];
    return team ?? teams[0]!;
  };

  // Calculate overall pick number
  const getOverallPick = (round: number, position: number): number => {
    const teamCount = teams.length;
    if (draftType === 'SNAKE') {
      if (round % 2 === 1) {
        return (round - 1) * teamCount + position;
      } else {
        return (round - 1) * teamCount + (teamCount - position + 1);
      }
    }
    return (round - 1) * teamCount + position;
  };

  if (teams.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          No teams in the draft yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex-1">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Draft Board</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={draftType === 'SNAKE' ? 'default' : 'secondary'}>
              {draftType} Draft
            </Badge>
            <Badge variant="outline">
              {totalRounds} Rounds
            </Badge>
          </div>
        </div>
        
        {/* Position Legend */}
        <div className="flex flex-wrap gap-2 mt-2">
          {Object.entries(positionColors).map(([pos, style]) => (
            <div key={pos} className="flex items-center gap-1">
              <div className={cn('w-3 h-3 rounded', style.bg, style.border, 'border')} />
              <span className="text-xs text-muted-foreground">{pos}</span>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <ScrollArea className="w-full">
          <div className="p-4">
            {/* Header row - Team names */}
            <div className="flex gap-2 mb-2 sticky top-0 bg-background z-10 pb-2 border-b">
              <div className="w-16 flex-shrink-0" /> {/* Round label spacer */}
              {teams.map((team) => (
                <div
                  key={team.id}
                  className={cn(
                    'min-w-[140px] text-center p-2 rounded-lg',
                    team.id === myTeamId && 'bg-primary/10 border border-primary/30'
                  )}
                >
                  <p className="font-semibold text-sm truncate">{team.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {team.ownerName}
                  </p>
                </div>
              ))}
            </div>

            {/* Rounds */}
            {pickGrid.map((roundPicks, roundIndex) => {
              const round = roundIndex + 1;
              const isReversed = draftType === 'SNAKE' && round % 2 === 0;

              return (
                <div key={round} className="flex gap-2 mb-2">
                  {/* Round label */}
                  <div className="w-16 flex-shrink-0 flex items-center justify-center">
                    <Badge variant="outline" className="font-mono">
                      R{round}
                    </Badge>
                  </div>

                  {/* Picks in round */}
                  {teams.map((_, teamIndex) => {
                    const position = teamIndex + 1;
                    const displayPosition = isReversed 
                      ? teams.length - teamIndex 
                      : position;
                    const team = getTeamForPick(round, displayPosition);
                    const overallPick = getOverallPick(round, displayPosition);
                    const pick = roundPicks[teamIndex] ?? null;
                    const isTraded = pick 
                      ? pick.originalOwnerId !== pick.currentOwnerId
                      : false;

                    return (
                      <PickCell
                        key={`${round}-${teamIndex}`}
                        pick={pick}
                        team={team}
                        round={round}
                        pickNumber={overallPick}
                        isCurrentPick={overallPick === currentPick}
                        isPaused={isPaused}
                        isMyTeam={team.id === myTeamId}
                        isTraded={isTraded}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default DraftBoard;
