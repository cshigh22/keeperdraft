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
import { ArrowRight, ArrowLeft } from 'lucide-react';
import type { TeamSummary, DraftPickSummary } from '@/types/socket';

// ============================================================================
// TYPES
// ============================================================================

interface DraftBoardProps {
  teams: TeamSummary[];
  completedPicks: DraftPickSummary[];
  allPicks: DraftPickSummary[];
  totalRounds: number;
  currentPick: number;
  currentTeamId: string | null;
  isPaused: boolean;
  draftType: 'SNAKE' | 'LINEAR';
  myTeamId?: string;
  hideCompleted?: boolean;
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
  QB: { bg: 'bg-pink-500/20', text: 'text-pink-500', border: 'border-pink-500/30' },
  RB: { bg: 'bg-blue-500/20', text: 'text-blue-500', border: 'border-blue-500/30' },
  WR: { bg: 'bg-green-500/20', text: 'text-green-500', border: 'border-green-500/30' },
  TE: { bg: 'bg-yellow-500/20', text: 'text-yellow-500', border: 'border-yellow-500/30' },
  K: { bg: 'bg-gray-500/20', text: 'text-gray-500', border: 'border-gray-500/30' },
  DEF: { bg: 'bg-purple-500/20', text: 'text-purple-500', border: 'border-purple-500/30' },
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
              'relative h-20 min-w-[140px] rounded border transition-all duration-200',
              'flex flex-col justify-between p-2',
              // Empty pick
              !isFilled && 'bg-slate-50 border-slate-200',
              // Filled pick with position color
              isFilled && positionStyle?.bg,
              isFilled && positionStyle?.border,
              // Current pick highlight
              isCurrentPick && !isPaused && 'ring-1 ring-blue-500 ring-offset-2 ring-offset-white animate-pulse',
              isCurrentPick && isPaused && 'ring-1 ring-yellow-500 ring-offset-2 ring-offset-white',
              // My team highlight
              isMyTeam && !isFilled && 'border-blue-500/30 bg-blue-500/5',
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
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn(
                    "w-8 py-0.5 rounded-sm text-[8px] font-black border text-center uppercase",
                    positionStyle?.bg,
                    positionStyle?.text,
                    positionStyle?.border
                  )}>
                    {pick.selectedPlayer?.position}
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold uppercase">
                    {pick.selectedPlayer?.nflTeam || 'FA'}
                  </span>
                </div>
                <p className="font-bold text-[11px] truncate text-slate-900 leading-tight">
                  {pick.selectedPlayer?.fullName}
                </p>
              </div>
            ) : (
              // Empty pick - show team
              <div className="flex-1 flex flex-col justify-center">
                <p className="text-[10px] text-slate-500 font-bold uppercase mb-0.5">
                  {team.ownerName}
                </p>
                <p className="font-medium text-xs truncate text-slate-400">
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

export function DraftBoard({
  teams,
  allPicks,
  totalRounds,
  currentPick,
  currentTeamId,
  isPaused,
  draftType,
  myTeamId,
  hideCompleted = true,
}: DraftBoardProps) {
  // Build pick grid - maps each cell to a pick
  const fullPickMap = useMemo(() => {
    return new Map(allPicks.map((p) => [p.overallPickNumber, p]));
  }, [allPicks]);

  const teamMap = useMemo(() => {
    return new Map(teams.map((t) => [t.id, t]));
  }, [teams]);

  const pickGrid = useMemo(() => {
    const grid: (DraftPickSummary | null)[][] = [];

    for (let round = 1; round <= totalRounds; round++) {
      const roundPicks: (DraftPickSummary | null)[] = [];

      for (let position = 1; position <= teams.length; position++) {
        // Calculate overall pick number based on draft type
        let overallPick: number;

        if (draftType === 'SNAKE') {
          if (round % 2 === 1) {
            overallPick = (round - 1) * teams.length + position;
          } else {
            overallPick = (round - 1) * teams.length + (teams.length - position + 1);
          }
        } else {
          overallPick = (round - 1) * teams.length + position;
        }

        const pick = fullPickMap.get(overallPick) || null;
        roundPicks.push(pick);
      }

      // Filter out completed picks (keepers) if requested
      if (hideCompleted && roundPicks.every(p => p?.isComplete)) {
        continue;
      }

      grid.push(roundPicks);
    }

    return grid;
  }, [fullPickMap, teams.length, totalRounds, draftType, hideCompleted]);

  // Calculate which team has each pick
  const getTeamForPick = (overallPickNumber: number): TeamSummary => {
    const pick = fullPickMap.get(overallPickNumber);
    if (pick) {
      const owner = teamMap.get(pick.currentOwnerId);
      if (owner) return owner;
    }

    // Fallback to original calculation if pick not found (shouldn't happen)
    const teamCount = teams.length;
    const round = Math.ceil(overallPickNumber / teamCount);
    const position = overallPickNumber % teamCount || teamCount;

    if (draftType === 'SNAKE' && round % 2 === 0) {
      return teams[teamCount - position] || teams[0]!;
    }
    return teams[position - 1] || teams[0]!;
  };

  // Calculate overall pick number helper
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
    <div className="flex-1 bg-white border-none shadow-none overflow-hidden flex flex-col h-full">
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
            <div className="flex gap-2 mb-4 sticky top-0 bg-white z-20 pb-2 border-b border-slate-200">
              <div className="w-16 flex-shrink-0" /> {/* Round label spacer */}
              {teams.map((team) => (
                <div
                  key={team.id}
                  className={cn(
                    'min-w-[140px] text-center p-2 rounded',
                    team.id === myTeamId && 'bg-blue-50 border border-blue-200 shadow-sm'
                  )}
                >
                  <p className="font-bold text-xs truncate text-slate-900">{team.name.toUpperCase()}</p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase mt-0.5">
                    {team.ownerName}
                  </p>
                </div>
              ))}
            </div>

            {/* Rounds */}
            {pickGrid.map((roundPicks, roundIndex) => {
              const round = roundIndex + 1;
              const isSnake = draftType === 'SNAKE';
              const isReversed = isSnake && round % 2 === 0;

              return (
                <div key={round} className="flex gap-2 mb-2 items-center">
                  {/* Round label */}
                  <div className="w-16 flex-shrink-0 flex items-center justify-center relative group">
                    <Badge variant="outline" className="font-mono bg-white z-10">
                      R{round}
                    </Badge>
                    {isSnake && (
                      <div className={cn(
                        "absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity",
                        isReversed ? "translate-x-full" : "-translate-x-full"
                      )}>
                        {isReversed ? <ArrowLeft className="w-4 h-4 text-slate-300" /> : <ArrowRight className="w-4 h-4 text-slate-300" />}
                      </div>
                    )}
                  </div>

                  {/* Picks in round */}
                  {roundPicks.map((pick, teamIndex) => {
                    const team = getTeamForPick(pick?.overallPickNumber || ((round - 1) * teams.length + teamIndex + 1));
                    const isTraded = pick
                      ? pick.originalOwnerId !== pick.currentOwnerId
                      : false;

                    const pickNum = pick?.overallPickNumber || ((round - 1) * teams.length + teamIndex + 1);

                    return (
                      <PickCell
                        key={`${round}-${teamIndex}`}
                        pick={pick}
                        team={team}
                        round={round}
                        pickNumber={pickNum}
                        isCurrentPick={pickNum === currentPick}
                        isPaused={isPaused}
                        isMyTeam={team.id === myTeamId}
                        isTraded={isTraded}
                      />
                    );
                  })}

                  {/* Direction Indicator for Snake */}
                  {isSnake && (
                    <div className="w-8 flex flex-col items-center justify-center text-slate-300">
                      {!isReversed ? <ArrowRight className="w-5 h-5 animate-pulse" /> : <ArrowLeft className="w-5 h-5 opacity-20" />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </CardContent>
    </div>
  );
}

export default DraftBoard;
