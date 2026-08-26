// Commissioner-only dialog for swapping the player on a completed pick after
// the draft has ended. The candidate pool is the client's availablePlayers
// from state sync, which already excludes drafted and rostered players.

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn, normalizeForSearch } from '@/lib/utils';
import { formatRank } from '@/lib/rank';
import { Search } from 'lucide-react';
import { positionBadgeColors } from './position-styles';
import type { DraftPickSummary, PlayerSummary } from '@/types/socket';

const MAX_RESULTS = 50;

interface EditPickDialogProps {
  // The completed pick being edited; null keeps the dialog closed
  pick: DraftPickSummary | null;
  players: PlayerSummary[];
  onConfirm: (playerId: string) => void;
  onClose: () => void;
}

function PositionBadge({ position }: { position?: string }) {
  return (
    <span
      className={cn(
        'w-8 py-0.5 rounded-sm text-[9px] font-black border text-center uppercase inline-block flex-shrink-0',
        positionBadgeColors[position || ''] || positionBadgeColors.DEF
      )}
    >
      {position}
    </span>
  );
}

export function EditPickDialog({ pick, players, onConfirm, onClose }: EditPickDialogProps) {
  const [search, setSearch] = useState('');
  // The full player object, not an id: the selection must survive the search
  // being edited (a selected player can drop out of the filtered results).
  const [selected, setSelected] = useState<PlayerSummary | null>(null);

  // Fresh search state for each pick being edited
  useEffect(() => {
    setSearch('');
    setSelected(null);
  }, [pick?.id]);

  const results = useMemo(() => {
    // Kept players are rostered elsewhere and never valid swap targets
    let pool = players.filter((p) => !p.keptByTeam);
    if (search.trim()) {
      const s = normalizeForSearch(search);
      pool = pool.filter((p) => normalizeForSearch(p.fullName).includes(s));
    }
    return pool.slice(0, MAX_RESULTS);
  }, [players, search]);

  if (!pick) return null;

  const current = pick.selectedPlayer;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Edit Pick {pick.round}.{pick.pickInRound || pick.overallPickNumber} — {pick.currentOwnerName}
          </DialogTitle>
          <DialogDescription>
            Swap in an available player. {current?.fullName || 'The current player'} returns to
            the player pool and the draft board is updated for everyone.
          </DialogDescription>
        </DialogHeader>

        {/* Current selection */}
        {current && (
          <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2">
            <PositionBadge position={current.position} />
            <span className="text-sm font-semibold">{current.fullName}</span>
            <span className="text-xs text-muted-foreground uppercase">
              {current.nflTeam || 'FA'}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">Current</span>
          </div>
        )}

        {/* Replacement search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search available players..."
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
          {results.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">
              No available players match.
            </p>
          ) : (
            results.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => setSelected(player)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 transition-colors',
                  selected?.id === player.id && 'bg-blue-50 ring-1 ring-inset ring-blue-400'
                )}
              >
                <span className="w-8 text-xs font-mono text-muted-foreground text-right flex-shrink-0">
                  {formatRank(player.rank)}
                </span>
                <PositionBadge position={player.position} />
                <span className="text-sm font-medium truncate">{player.fullName}</span>
                <span className="ml-auto text-xs text-muted-foreground uppercase flex-shrink-0">
                  {player.nflTeam || 'FA'}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!selected} onClick={() => selected && onConfirm(selected.id)}>
            {selected ? `Swap in ${selected.fullName}` : 'Select a player'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default EditPickDialog;
