'use client';

import React, { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trophy, Plus, Trash2, Sparkles } from 'lucide-react';
import { ChampionCard } from './ChampionCard';
import { addPastWinner, removePastWinner } from '@/app/actions/champions';
import type { PastWinnerData } from '@/types/champions';

// ============================================================================
// LEGACY VAULT (Hall of Champions)
// ============================================================================

interface LegacyVaultProps {
  leagueId: string;
  pastWinners: PastWinnerData[];
  isCommissioner: boolean;
}

export function LegacyVault({ leagueId, pastWinners, isCommissioner }: LegacyVaultProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Form state
  const [season, setSeason] = useState(new Date().getFullYear() - 1);
  const [managerName, setManagerName] = useState('');

  const sorted = [...pastWinners].sort((a, b) => b.season - a.season);

  const handleSubmit = () => {
    const formData = new FormData();
    formData.set('leagueId', leagueId);
    formData.set('season', season.toString());
    formData.set('managerName', managerName);
    formData.set('teamName', managerName);

    startTransition(async () => {
      try {
        await addPastWinner(formData);
        setDialogOpen(false);
        resetForm();
      } catch (err) {
        console.error('Failed to add past winner:', err);
      }
    });
  };

  const handleRemove = (id: string) => {
    const formData = new FormData();
    formData.set('id', id);
    startTransition(async () => {
      try {
        await removePastWinner(formData);
      } catch (err) {
        console.error('Failed to remove past winner:', err);
      }
    });
  };

  const resetForm = () => {
    setSeason(new Date().getFullYear() - 1);
    setManagerName('');
  };

  if (sorted.length === 0 && !isCommissioner) {
    return null;
  }

  return (
    <div className="relative mt-8 mb-6">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-yellow-500/10 border border-amber-500/20">
            <Trophy className="w-5 h-5 text-amber-500" />
          </div>
          <h2 className="text-lg font-bold tracking-tight bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-600 bg-clip-text text-transparent">
            Hall of Champions
          </h2>
        </div>

        {isCommissioner && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs border-amber-500/20 text-amber-600 hover:bg-amber-500/10 hover:text-amber-500">
                <Plus className="w-3.5 h-3.5" />
                Add Champion
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-500" />
                  Add Past Champion
                </DialogTitle>
                <DialogDescription>
                  Record a past season&apos;s winner.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div>
                  <Label htmlFor="champion-season" className="text-xs">Season Year</Label>
                  <Input
                    id="champion-season"
                    type="number"
                    value={season}
                    onChange={(e) => setSeason(parseInt(e.target.value) || 0)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="champion-manager" className="text-xs">Winner Name</Label>
                  <Input
                    id="champion-manager"
                    value={managerName}
                    onChange={(e) => setManagerName(e.target.value)}
                    placeholder="John Doe"
                    className="mt-1"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={isPending || !managerName}
                  className="bg-gradient-to-r from-amber-500 to-yellow-500 text-black hover:from-amber-600 hover:to-yellow-600"
                >
                  {isPending ? 'Adding...' : 'Add Champion'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Champions Scroll */}
      {sorted.length === 0 ? (
        <div className="text-center py-10 rounded-xl border border-dashed border-amber-500/20 bg-muted/10">
          <Trophy className="w-10 h-10 text-amber-500/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No champions recorded yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Add your league&apos;s past winners to build the legacy
          </p>
        </div>
      ) : (
        <ScrollArea className="w-full">
          <div className="flex gap-4 pb-4 stagger-children">
            {sorted.map((winner, index) => (
              <div key={winner.id} className="relative group/card">
                <ChampionCard
                  season={winner.season}
                  managerName={winner.managerName}
                  index={index}
                />
                {isCommissioner && (
                  <button
                    onClick={() => handleRemove(winner.id)}
                    className={cn(
                      'absolute -top-2 -right-2 z-30 w-6 h-6 rounded-full',
                      'bg-destructive text-destructive-foreground',
                      'flex items-center justify-center',
                      'opacity-0 group-hover/card:opacity-100 transition-opacity duration-200',
                      'hover:scale-110 active:scale-95'
                    )}
                    disabled={isPending}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
