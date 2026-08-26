// Commissioner-only dialog for putting any player on a pick after the draft
// has ended. Candidates are the free-agent pool plus every rostered player
// (tagged with their team); picking a rostered player moves them onto this
// pick, and the server vacates any other board slot that showed them.

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
import type { DraftPickSummary, PlayerSummary, RosterPlayer, TeamSummary } from '@/types/socket';

const MAX_RESULTS = 50;

// A candidate row: pool players as-is, rostered players tagged with the team
// currently holding them.
type CandidatePlayer = PlayerSummary & { rosteredBy?: string };

interface EditPickDialogProps {
  // The pick being edited (filled or empty); null keeps the dialog closed
  pick: DraftPickSummary | null;
  players: PlayerSummary[];
  teams: TeamSummary[];
  teamRosters: Record<string, RosterPlayer[]>;
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

export function EditPickDialog({
  pick,
  players,
  teams,
  teamRosters,
  onConfirm,
  onClose,
}: EditPickDialogProps) {
  const [search, setSearch] = useState('');
  // The full player object, not an id: the selection must survive the search
  // being edited (a selected player can drop out of the filtered results).
  const [selected, setSelected] = useState<CandidatePlayer | null>(null);

  // Fresh search state for each pick being edited
  useEffect(() => {
    setSearch('');
    setSelected(null);
  }, [pick?.id]);

  const candidates = useMemo<CandidatePlayer[]>(() => {
    const teamNameById = new Map(teams.map((t) => [t.id, t.name]));
    const rostered: CandidatePlayer[] = [];
    for (const [teamId, roster] of Object.entries(teamRosters)) {
      for (const p of roster) {
        // The player already on this pick isn't a swap target
        if (p.id === pick?.selectedPlayer?.id) continue;
        rostered.push({ ...p, rosteredBy: teamNameById.get(teamId) || 'another team' });
      }
    }
    return [...players.filter((p) => !p.keptByTeam), ...rostered].sort(
      (a, b) => (a.rank || 9999) - (b.rank || 9999)
    );
  }, [players, teamRosters, teams, pick?.selectedPlayer?.id]);

  const results = useMemo(() => {
    let pool = candidates;
    if (search.trim()) {
      const s = normalizeForSearch(search);
      pool = pool.filter((p) => normalizeForSearch(p.fullName).includes(s));
    }
    return pool.slice(0, MAX_RESULTS);
  }, [candidates, search]);

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
            {current
              ? `Put any player on this pick. ${current.fullName} comes off it, and the board is updated for everyone.`
              : 'This slot is empty — select any player to fill it. The board is updated for everyone.'}
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
                {player.rosteredBy && (
                  <span className="text-[10px] text-amber-600 truncate flex-shrink-0">
                    on {player.rosteredBy}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground uppercase flex-shrink-0">
                  {player.nflTeam || 'FA'}
                </span>
              </button>
            ))
          )}
        </div>

        {selected?.rosteredBy && (
          <p className="text-xs text-amber-600">
            {selected.fullName} is currently on {selected.rosteredBy} — confirming moves them onto
            this pick, and any other board slot showing them is emptied.
          </p>
        )}

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
