'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { calculateROI } from '@/types/marketplace';
import type { TradeBlockPlayerData } from '@/types/marketplace';

// ============================================================================
// TRADE BLOCK CARD
// ============================================================================

interface TradeBlockCardProps {
  entry: TradeBlockPlayerData;
  totalRounds?: number;
  totalPlayers?: number;
}

const positionColors: Record<string, string> = {
  QB: 'bg-red-500/15 text-red-500 border-red-500/20',
  RB: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  WR: 'bg-blue-500/15 text-blue-500 border-blue-500/20',
  TE: 'bg-orange-500/15 text-orange-500 border-orange-500/20',
  K: 'bg-purple-500/15 text-purple-500 border-purple-500/20',
  DEF: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
};

const roiColors = {
  green: {
    bar: 'bg-gradient-to-r from-emerald-500 to-green-400',
    text: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
  yellow: {
    bar: 'bg-gradient-to-r from-amber-500 to-yellow-400',
    text: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
  red: {
    bar: 'bg-gradient-to-r from-red-500 to-rose-400',
    text: 'text-red-500',
    bg: 'bg-red-500/10',
  },
};

export function TradeBlockCard({
  entry,
  totalRounds = 14,
  totalPlayers = 168,
}: TradeBlockCardProps) {
  const { player, team } = entry;
  if (!player) return null;

  const roi = calculateROI(entry.draftCost, player.rank, totalRounds, totalPlayers);
  const roiStyle = roiColors[roi.color];

  return (
    <div
      className={cn(
        'group relative rounded-xl border border-border/40 overflow-hidden transition-all duration-300',
        'hover:scale-[1.02] hover:-translate-y-0.5',
        'bg-gradient-to-br from-card to-muted/30 hover:border-primary/20',
      )}
    >
      {/* Top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-60" />

      <div className="p-4">
        {/* Header: Player info + Position */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge
                className={cn(
                  'text-[10px] px-1.5 py-0 font-mono h-5 shrink-0 border',
                  positionColors[player.position] ?? 'bg-muted text-muted-foreground'
                )}
              >
                {player.position}
              </Badge>
              <h3 className="text-sm font-bold truncate">{player.fullName}</h3>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 pl-0.5">
              {player.nflTeam || 'Free Agent'} · Rank #{player.rank ?? '—'}
            </p>
          </div>
        </div>

        {/* ROI Meter */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Keeper Value ROI
            </span>
            <span className={cn('text-[10px] font-bold', roiStyle.text)}>
              {roi.description}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
            <div
              className={cn('h-full rounded-full roi-bar-fill', roiStyle.bar)}
              style={{ '--roi-width': `${roi.percentage}%` } as React.CSSProperties}
            />
          </div>
          <p className={cn('text-[10px] mt-1 font-medium', roiStyle.text)}>
            {roi.label}
          </p>
        </div>

        {/* Team + Asking Price */}
        <div className="flex flex-col gap-1 text-[10px] pt-2 border-t border-border/30">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Owner</span>
            <span className="font-medium">{team.name}</span>
          </div>
          
          {entry.askingPrice && (
            <div className="mt-1 p-2 rounded bg-indigo-500/5 border border-indigo-500/10">
              <span className="text-indigo-400 font-bold uppercase tracking-tighter text-[8px] block mb-0.5">Asking Price</span>
              <span className="text-muted-foreground italic text-[11px] leading-tight">
                &ldquo;{entry.askingPrice}&rdquo;
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
