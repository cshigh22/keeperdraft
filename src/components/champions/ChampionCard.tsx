'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Trophy } from 'lucide-react';

// ============================================================================
// CHAMPION CARD
// ============================================================================

interface ChampionCardProps {
  season: number;
  managerName: string;
  index: number;
}

export function ChampionCard({ season, managerName, index }: ChampionCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={cn(
        'relative group flex-shrink-0 w-[180px] h-[110px] rounded-xl overflow-hidden cursor-default',
        'transition-all duration-500 ease-out',
        'hover:scale-[1.04] hover:-translate-y-1',
        'border border-amber-500/20',
      )}
      style={{ animationDelay: `${index * 100}ms` }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Shimmer overlay on hover */}
      <div
        className={cn(
          'absolute inset-0 champion-shimmer transition-opacity duration-500 z-10 pointer-events-none',
          isHovered ? 'opacity-100' : 'opacity-0'
        )}
      />

      {/* Glass background */}
      <div className="absolute inset-0 glass-card" />

      {/* Gold gradient top accent */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-600" />

      {/* Content */}
      <div className="relative z-20 p-4 flex flex-col items-center justify-center text-center h-full">
        {/* Trophy */}
        <Trophy className={cn(
          'w-5 h-5 mb-2 transition-all duration-500',
          isHovered ? 'text-amber-400 scale-110' : 'text-amber-600/40'
        )} />

        {/* Year badge */}
        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 font-mono text-[10px] px-2 py-0 mb-2">
          {season}
        </Badge>

        {/* Manager Name */}
        <span className="text-sm font-semibold text-foreground truncate w-full px-2">
          {managerName}
        </span>
      </div>
    </div>
  );
}
