// Draft Board Component
// Visual grid showing all rounds and picks with real-time updates

'use client';

import React, { useMemo, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
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
  // The draft's season; 0 until the first state sync. allPicks also carries
  // trade-materialized future-season rows, which must not shadow board cells.
  season: number;
  totalRounds: number;
  currentPick: number;
  currentTeamId: string | null;
  isPaused: boolean;
  draftType: 'SNAKE' | 'LINEAR';
  myTeamId?: string;
  // NOTE: accepted for API compatibility but currently unused — every round is
  // rendered so draft history stays visible
  hideKeeperRounds?: boolean;
  onTeamClick?: (teamId: string) => void;
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
// POSITION STYLING & PICK MATH
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

// Overall pick number for a board slot, honoring snake-round reversal
function overallPickForSlot(
  round: number,
  position: number,
  teamCount: number,
  draftType: 'SNAKE' | 'LINEAR'
): number {
  const isReversedRound = draftType === 'SNAKE' && round % 2 === 0;
  const slot = isReversedRound ? teamCount - position + 1 : position;
  return (round - 1) * teamCount + slot;
}

// ============================================================================
// PICK CELL COMPONENT
// ============================================================================

const PickCell = React.memo(function PickCell({
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
  const cellRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to current pick
  useEffect(() => {
    if (isCurrentPick && cellRef.current) {
      cellRef.current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }, [isCurrentPick]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          ref={cellRef}
          className={cn(
            'relative h-[68px] min-w-[130px] rounded-md border transition-all duration-200',
            'flex flex-col justify-between p-1.5',
            // Empty pick
            !isFilled && 'bg-slate-50 border-slate-200',
            // Filled pick with position color
            isFilled && positionStyle?.bg,
            isFilled && positionStyle?.border,
            // Current pick - strong glow effect
            isCurrentPick && !isPaused && 'ring-2 ring-blue-500 ring-offset-1 ring-offset-white shadow-[0_0_15px_rgba(59,130,246,0.5)] border-blue-400 z-10',
            isCurrentPick && isPaused && 'ring-2 ring-yellow-500 ring-offset-1 ring-offset-white shadow-[0_0_12px_rgba(234,179,8,0.4)]',
            // My team highlight
            isMyTeam && !isFilled && 'border-blue-500/30 bg-blue-500/5',
            // Traded pick indicator
            isTraded && 'border-dashed'
          )}
        >
          {/* Pick number badge */}
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-slate-400 font-bold">
              {pickNumber}
            </span>
            {isTraded && (
              <Badge variant="secondary" className="text-[8px] py-0 px-1 h-3.5">
                Traded
              </Badge>
            )}
          </div>

          {/* Content */}
          {isFilled ? (
            // Filled pick - show player
            <div className="flex-1 flex flex-col justify-center">
              <div className="flex items-center gap-1 mb-0.5">
                <span className={cn(
                  "w-7 py-0.5 rounded-sm text-[7px] font-black border text-center uppercase",
                  positionStyle?.bg,
                  positionStyle?.text,
                  positionStyle?.border
                )}>
                  {pick.selectedPlayer?.position}
                </span>
                <span className="text-[9px] text-slate-500 font-bold uppercase">
                  {pick.selectedPlayer?.nflTeam || 'FA'}
                </span>
              </div>
              <p className="font-bold text-[10px] truncate text-slate-900 leading-tight">
                {pick.selectedPlayer?.fullName}
              </p>
            </div>
          ) : (
            // Empty pick - show team
            <div className="flex-1 flex flex-col justify-center">
              <p className="text-[9px] text-slate-400 font-bold uppercase truncate">
                {team.ownerName}
              </p>
            </div>
          )}

          {/* Current pick pulsing dot */}
          {isCurrentPick && (
            <div className="absolute -top-1.5 -right-1.5 flex items-center justify-center">
              <div className={cn(
                'w-3 h-3 rounded-full',
                isPaused ? 'bg-yellow-500' : 'bg-blue-500'
              )} />
              {!isPaused && (
                <div className="absolute w-3 h-3 rounded-full bg-blue-500 animate-ping" />
              )}
            </div>
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
          {isTraded && (
            <p className="text-xs text-yellow-600 mt-1">
              Originally: Traded
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}, (prevProps, nextProps) => {
  // Custom comparator: only re-render when meaningful props change
  return (
    prevProps.pick?.isComplete === nextProps.pick?.isComplete &&
    prevProps.pick?.selectedPlayer?.id === nextProps.pick?.selectedPlayer?.id &&
    prevProps.isCurrentPick === nextProps.isCurrentPick &&
    prevProps.isPaused === nextProps.isPaused &&
    prevProps.isMyTeam === nextProps.isMyTeam &&
    prevProps.isTraded === nextProps.isTraded &&
    prevProps.pickNumber === nextProps.pickNumber &&
    prevProps.team.id === nextProps.team.id
  );
});

export function DraftBoard({
  teams,
  allPicks,
  season,
  totalRounds,
  currentPick,
  currentTeamId,
  isPaused,
  draftType,
  myTeamId,
  onTeamClick,
}: DraftBoardProps) {
  const fullPickMap = useMemo(() => {
    const map = new Map<number, DraftPickSummary>();
    for (const pick of allPicks) {
      if (season && pick.season !== season) continue;
      if (pick.overallPickNumber <= 0) continue;
      // Never let an unfilled duplicate of the same slot shadow a filled cell
      const rival = map.get(pick.overallPickNumber);
      if (rival?.isComplete && rival.selectedPlayer && !(pick.isComplete && pick.selectedPlayer)) {
        continue;
      }
      map.set(pick.overallPickNumber, pick);
    }
    return map;
  }, [allPicks, season]);

  const teamMap = useMemo(() => {
    return new Map(teams.map((t) => [t.id, t]));
  }, [teams]);

  // Every round is rendered so draft history is always visible
  const pickGrid = useMemo(() => {
    const grid: { round: number; picks: (DraftPickSummary | null)[] }[] = [];

    for (let round = 1; round <= totalRounds; round++) {
      const roundPicks: (DraftPickSummary | null)[] = [];

      for (let position = 1; position <= teams.length; position++) {
        const overallPick = overallPickForSlot(round, position, teams.length, draftType);
        roundPicks.push(fullPickMap.get(overallPick) || null);
      }

      grid.push({ round, picks: roundPicks });
    }

    return grid;
  }, [fullPickMap, teams.length, totalRounds, draftType]);

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

  if (teams.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground p-8">
        No teams in the draft yet.
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white overflow-hidden flex flex-col h-full">
      {/* Compact Info Bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-slate-100 bg-slate-50/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-slate-800 tracking-wide">Draft Board</h2>
          <div className="flex items-center gap-1.5">
            {Object.entries(positionColors).map(([pos, style]) => (
              <div key={pos} className="flex items-center gap-0.5">
                <div className={cn('w-2 h-2 rounded-sm', style.bg, style.border, 'border')} />
                <span className="text-[9px] text-slate-400 font-medium">{pos}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={draftType === 'SNAKE' ? 'default' : 'secondary'} className="text-[10px] py-0 h-5">
            {draftType}
          </Badge>
          <Badge variant="outline" className="text-[10px] py-0 h-5">
            {totalRounds}R
          </Badge>
        </div>
      </div>

      {/* Scrollable Board */}
      <div className="flex-1 min-h-0 overflow-auto">
        <TooltipProvider>
          <div className="inline-block min-w-full p-3">
            {/* Header row - Team names */}
            <div className="flex gap-1.5 mb-2 sticky top-0 bg-white z-20 pb-2 border-b border-slate-100">
              <div className="w-10 flex-shrink-0" /> {/* Round label spacer */}
              {teams.map((team) => (
                <div
                  key={team.id}
                  onClick={() => onTeamClick?.(team.id)}
                  className={cn(
                    'min-w-[130px] flex-1 text-center py-1.5 px-1 rounded-md cursor-pointer',
                    'hover:bg-blue-50 transition-colors',
                    team.id === myTeamId && 'bg-blue-50 border border-blue-200',
                    team.id === currentTeamId && 'ring-1 ring-blue-400'
                  )}
                >
                  <p className="font-bold text-[10px] truncate text-slate-800 uppercase">{team.name}</p>
                  <p className="text-[9px] text-slate-400 font-medium truncate uppercase">
                    {team.ownerName}
                  </p>
                </div>
              ))}
            </div>

            {/* Rounds */}
            {pickGrid.map(({ round, picks }) => {
              const isSnake = draftType === 'SNAKE';
              const isReversed = isSnake && round % 2 === 0;

              return (
                <div key={round} className="flex gap-1.5 mb-1.5 items-center">
                  {/* Round label - sticky left */}
                  <div className="w-10 flex-shrink-0 flex items-center justify-center sticky left-0 bg-white z-10">
                    <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">
                      R{round}
                    </span>
                  </div>

                  {/* Picks in round */}
                  {picks.map((pick, teamIndex) => {
                    const pickNumber =
                      pick?.overallPickNumber || (round - 1) * teams.length + teamIndex + 1;
                    const team = getTeamForPick(pickNumber);
                    const isTraded = pick
                      ? pick.originalOwnerId !== pick.currentOwnerId
                      : false;

                    return (
                      <div key={`${round}-${teamIndex}`} className="min-w-[130px] flex-1">
                        <PickCell
                          pick={pick}
                          team={team}
                          round={round}
                          pickNumber={pickNumber}
                          isCurrentPick={pickNumber === currentPick}
                          isPaused={isPaused}
                          isMyTeam={team.id === myTeamId}
                          isTraded={isTraded}
                        />
                      </div>
                    );
                  })}

                  {/* Direction Indicator for Snake */}
                  {isSnake && (
                    <div className="w-5 flex items-center justify-center text-slate-300 flex-shrink-0">
                      {isReversed ? <ArrowLeft className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}

export default DraftBoard;
