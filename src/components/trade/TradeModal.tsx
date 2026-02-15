// Trade Modal Component
// Complex two-column interface for proposing trades

'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ArrowLeftRight, Package, User, AlertCircle, X } from 'lucide-react';
import type { TeamSummary, DraftPickSummary, PlayerSummary } from '@/types/socket';

// ============================================================================
// TYPES
// ============================================================================

interface TradeModalProps {
  myTeam: TeamSummary;
  allTeams: TeamSummary[];
  myPlayers: PlayerSummary[];
  allPicks: DraftPickSummary[];
  teamRosters: Record<string, PlayerSummary[]>;
  totalRounds: number;
  onProposeTrade: (
    receiverTeamId: string,
    myAssets: { assetType: string; id: string; season?: number; round?: number }[],
    theirAssets: { assetType: string; id: string; season?: number; round?: number }[]
  ) => void;
  disabled?: boolean;
}

interface TradeAsset {
  type: 'pick' | 'player';
  id: string;
  display: string;
  subtext?: string;
}

// ============================================================================
// ASSET ITEM
// ============================================================================

interface AssetItemProps {
  asset: TradeAsset;
  isSelected: boolean;
  onToggle: () => void;
}

function AssetItem({ asset, isSelected, onToggle }: AssetItemProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
        'hover:bg-accent/50',
        isSelected && 'bg-primary/10 border-primary'
      )}
      onClick={onToggle}
    >
      <Checkbox checked={isSelected} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {asset.type === 'pick' ? (
            <Package className="w-4 h-4 text-muted-foreground" />
          ) : (
            <User className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="font-medium truncate">{asset.display}</span>
        </div>
        {asset.subtext && (
          <p className="text-xs text-muted-foreground mt-0.5">{asset.subtext}</p>
        )}
      </div>
      <Badge variant={asset.type === 'pick' ? 'secondary' : 'outline'}>
        {asset.type === 'pick' ? 'Pick' : 'Player'}
      </Badge>
    </div>
  );
}

// ============================================================================
// TRADE SUMMARY
// ============================================================================

interface TradeSummaryProps {
  myTeamName: string;
  theirTeamName: string;
  myAssets: TradeAsset[];
  theirAssets: TradeAsset[];
}

function TradeSummary({ myTeamName, theirTeamName, myAssets, theirAssets }: TradeSummaryProps) {
  if (myAssets.length === 0 && theirAssets.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>Select assets to trade</p>
      </div>
    );
  }

  return (
    <div className="bg-muted/50 rounded-lg p-4">
      <h4 className="font-semibold text-sm mb-3">Trade Summary</h4>
      <div className="grid grid-cols-[1fr,auto,1fr] gap-3 items-start">
        {/* My team gives */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">{myTeamName} gives:</p>
          {myAssets.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nothing selected</p>
          ) : (
            <ul className="space-y-1">
              {myAssets.map((asset) => (
                <li key={asset.id} className="text-sm">
                  • {asset.display}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Arrow */}
        <div className="flex items-center justify-center pt-4">
          <ArrowLeftRight className="w-5 h-5 text-muted-foreground" />
        </div>

        {/* Their team gives */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">{theirTeamName} gives:</p>
          {theirAssets.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nothing selected</p>
          ) : (
            <ul className="space-y-1">
              {theirAssets.map((asset) => (
                <li key={asset.id} className="text-sm">
                  • {asset.display}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TRADE MODAL COMPONENT
// ============================================================================

export function TradeModal({
  myTeam,
  allTeams,
  myPlayers,
  allPicks,
  teamRosters,
  totalRounds,
  onProposeTrade,
  disabled = false,
}: TradeModalProps) {
  const [open, setOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [selectedMyAssets, setSelectedMyAssets] = useState<Set<string>>(new Set());
  const [selectedTheirAssets, setSelectedTheirAssets] = useState<Set<string>>(new Set());

  // Other teams (exclude my team)
  const otherTeams = useMemo(
    () => allTeams.filter((t) => t.id !== myTeam.id),
    [allTeams, myTeam.id]
  );

  const selectedTeam = otherTeams.find((t) => t.id === selectedTeamId);

  // Helper to generate future picks (next 5 years)
  // Helper to generate assets for a team
  // Helper to generate assets for a team
  const getTeamAssets = useCallback((teamId: string, players: PlayerSummary[]) => {
    const assets: TradeAsset[] = [];
    const currentYear = new Date().getFullYear();

    // 1. Add picks from allPicks owned by this team
    allPicks
      .filter((p) => p.currentOwnerId === teamId && !p.isComplete)
      .forEach((pick) => {
        const isFuture = pick.season > currentYear;
        const originalOwner = allTeams.find((t) => t.id === pick.originalOwnerId);
        assets.push({
          type: 'pick',
          id: isFuture ? `FUTURE_PICK:${pick.originalOwnerId}:${pick.season}:${pick.round}` : pick.id,
          display: isFuture
            ? `${pick.season} Round ${pick.round} Pick`
            : `${pick.season} Round ${pick.round}, Pick ${pick.pickInRound}`,
          subtext: pick.originalOwnerId !== pick.currentOwnerId
            ? `Acquired via ${originalOwner?.ownerName || 'Trade'}`
            : isFuture ? 'Future Draft Pick' : `Pick ${pick.overallPickNumber}`,
        });
      });

    // 2. Add virtual future picks (only if not already traded/represented in allPicks)
    const rounds = totalRounds || 15;
    for (let year = currentYear + 1; year <= currentYear + 3; year++) {
      for (let round = 1; round <= rounds; round++) {
        const isRepresented = allPicks.some(
          p => p.season === year && p.round === round && p.originalOwnerId === teamId
        );

        if (!isRepresented) {
          assets.push({
            type: 'pick',
            id: `FUTURE_PICK:${teamId}:${year}:${round}`,
            display: `${year} Round ${round} Pick`,
            subtext: `Future Draft Pick`,
          });
        }
      }
    }

    // 3. Add players
    players.forEach((player) => {
      assets.push({
        type: 'player',
        id: player.id,
        display: player.fullName,
        subtext: `${player.position} - ${player.nflTeam || 'FA'}`,
      });
    });

    return assets;
  }, [allPicks, totalRounds, allTeams]);

  // Convert my picks and players to TradeAssets
  const myTradeAssets: TradeAsset[] = useMemo(() => {
    return getTeamAssets(myTeam.id, myPlayers);
  }, [getTeamAssets, myPlayers, myTeam.id]);

  // Their assets based on selected team
  const theirTradeAssets: TradeAsset[] = useMemo(() => {
    if (!selectedTeamId) return [];
    const theirPlayers = teamRosters[selectedTeamId] || [];
    return getTeamAssets(selectedTeamId, theirPlayers);
  }, [selectedTeamId, getTeamAssets, teamRosters]);

  // Build selected assets for summary
  const mySelectedAssets = myTradeAssets.filter((a) => selectedMyAssets.has(a.id));
  const theirSelectedAssets = theirTradeAssets.filter((a) => selectedTheirAssets.has(a.id));

  // Auto-clear selections that are no longer available
  useEffect(() => {
    setSelectedMyAssets((prev) => {
      const next = new Set(prev);
      let changed = false;
      prev.forEach((id) => {
        if (!myTradeAssets.some((a) => a.id === id)) {
          next.delete(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [myTradeAssets]);

  useEffect(() => {
    setSelectedTheirAssets((prev) => {
      const next = new Set(prev);
      let changed = false;
      prev.forEach((id) => {
        if (!theirTradeAssets.some((a) => a.id === id)) {
          next.delete(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [theirTradeAssets]);

  const canPropose =
    selectedTeamId &&
    (selectedMyAssets.size > 0 || selectedTheirAssets.size > 0);

  const handleToggleMyAsset = (id: string) => {
    setSelectedMyAssets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleTheirAsset = (id: string) => {
    setSelectedTheirAssets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handlePropose = () => {
    if (!canPropose) return;

    const myAssets = mySelectedAssets.map((a) => {
      if (a.id.startsWith('FUTURE_PICK:')) {
        const [, , year, round] = a.id.split(':');
        return {
          assetType: 'FUTURE_PICK',
          id: a.id,
          season: parseInt(year!),
          round: parseInt(round!),
        };
      }
      return {
        assetType: a.type === 'pick' ? 'DRAFT_PICK' : 'PLAYER',
        id: a.id,
      };
    });

    const theirAssets = theirSelectedAssets.map((a) => {
      if (a.id.startsWith('FUTURE_PICK:')) {
        const [, , year, round] = a.id.split(':');
        return {
          assetType: 'FUTURE_PICK',
          id: a.id,
          season: parseInt(year!),
          round: parseInt(round!),
        };
      }
      return {
        assetType: a.type === 'pick' ? 'DRAFT_PICK' : 'PLAYER',
        id: a.id,
      };
    });

    onProposeTrade(selectedTeamId, myAssets, theirAssets);

    // Reset and close
    setSelectedMyAssets(new Set());
    setSelectedTheirAssets(new Set());
    setSelectedTeamId('');
    setOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Reset on close
      setSelectedMyAssets(new Set());
      setSelectedTheirAssets(new Set());
      setSelectedTeamId('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <ArrowLeftRight className="w-4 h-4 mr-2" />
          Propose Trade
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Propose Trade</DialogTitle>
          <DialogDescription>
            Select assets from both teams to include in the trade offer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {/* Team Selection */}
          <div className="mb-4">
            <label className="text-sm font-medium mb-2 block">Trade Partner</label>
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a team to trade with" />
              </SelectTrigger>
              <SelectContent>
                {otherTeams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name} ({team.ownerName})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTeamId && (
            <>
              {/* Two Column Layout */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                {/* My Team */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-primary/10 px-4 py-2 border-b">
                    <h3 className="font-semibold">{myTeam.name}</h3>
                    <p className="text-xs text-muted-foreground">Your assets</p>
                  </div>
                  <ScrollArea className="h-64">
                    <div className="p-3 space-y-2">
                      {myTradeAssets.length === 0 ? (
                        <p className="text-center text-muted-foreground py-4">
                          No tradeable assets
                        </p>
                      ) : (
                        myTradeAssets.map((asset) => (
                          <AssetItem
                            key={asset.id}
                            asset={asset}
                            isSelected={selectedMyAssets.has(asset.id)}
                            onToggle={() => handleToggleMyAsset(asset.id)}
                          />
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* Their Team */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-secondary/50 px-4 py-2 border-b">
                    <h3 className="font-semibold">{selectedTeam?.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {selectedTeam?.ownerName}&apos;s assets
                    </p>
                  </div>
                  <ScrollArea className="h-64">
                    <div className="p-3 space-y-2">
                      {theirTradeAssets.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">
                            Select assets from your team to offer.
                          </p>
                          <p className="text-xs mt-1">
                            The other team&apos;s picks will be shown after selecting.
                          </p>
                        </div>
                      ) : (
                        theirTradeAssets.map((asset) => (
                          <AssetItem
                            key={asset.id}
                            asset={asset}
                            isSelected={selectedTheirAssets.has(asset.id)}
                            onToggle={() => handleToggleTheirAsset(asset.id)}
                          />
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>

              <Separator className="my-4" />

              {/* Trade Summary */}
              <TradeSummary
                myTeamName={myTeam.name}
                theirTeamName={selectedTeam?.name || ''}
                myAssets={mySelectedAssets}
                theirAssets={theirSelectedAssets}
              />
            </>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handlePropose} disabled={!canPropose}>
            Send Trade Offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// INCOMING TRADE POPUP
// ============================================================================

interface IncomingTradePopupProps {
  trade: {
    tradeId: string;
    initiatorTeam: TeamSummary;
    initiatorAssets: any[];
    receiverAssets: any[];
  };
  onAccept: (tradeId: string) => void;
  onReject: (tradeId: string) => void;
}

export function IncomingTradePopup({ trade, onAccept, onReject }: IncomingTradePopupProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 w-[400px] animate-in slide-in-from-right-full fade-in duration-500 ease-out">
      <Card className="border-2 border-blue-500 shadow-2xl bg-white/95 backdrop-blur-sm overflow-hidden">
        <CardHeader className="pb-3 bg-slate-50 border-b border-slate-100">
          <CardTitle className="flex items-center justify-between text-base">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-500 rounded-md">
                <ArrowLeftRight className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-slate-900 text-sm">New Trade Offer</span>
            </div>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider bg-blue-50 text-blue-600 border-blue-200">
              Action Required
            </Badge>
          </CardTitle>
          <CardDescription className="text-[11px] font-medium text-slate-500">
            {trade.initiatorTeam.name} has sent you a proposal
          </CardDescription>
        </CardHeader>

        <CardContent className="p-4">
          <div className="grid grid-cols-[1fr,auto,1fr] gap-4 items-center">
            {/* They offer */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">You Get</p>
              <ul className="space-y-1">
                {trade.initiatorAssets.map((asset) => (
                  <li key={asset.id} className="text-[11px] font-bold p-1.5 bg-green-50/50 text-green-700 rounded border border-green-100 truncate">
                    {asset.assetType === 'DRAFT_PICK' && asset.draftPick
                      ? `R${asset.draftPick.round} Pick`
                      : asset.assetType === 'FUTURE_PICK'
                        ? `${asset.futurePickSeason} R${asset.futurePickRound}`
                        : asset.player?.fullName || 'Player'}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                <ArrowLeftRight className="w-4 h-4 text-slate-400" />
              </div>
            </div>

            {/* You give */}
            <div className="space-y-1.5 text-right">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">You Give</p>
              <ul className="space-y-1">
                {trade.receiverAssets.map((asset) => (
                  <li key={asset.id} className="text-[11px] font-bold p-1.5 bg-red-50/50 text-red-700 rounded border border-red-100 truncate">
                    {asset.assetType === 'DRAFT_PICK' && asset.draftPick
                      ? `R${asset.draftPick.round} Pick`
                      : asset.assetType === 'FUTURE_PICK'
                        ? `${asset.futurePickSeason} R${asset.futurePickRound}`
                        : asset.player?.fullName || 'Player'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>

        <CardFooter className="p-3 bg-slate-50/80 border-t border-slate-100 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs h-9 font-bold bg-white hover:bg-red-50 hover:text-red-600 hover:border-red-200"
            onClick={() => onReject(trade.tradeId)}
          >
            Decline
          </Button>
          <Button
            size="sm"
            className="flex-1 text-xs h-9 font-bold shadow-lg shadow-blue-500/20 bg-blue-600 hover:bg-blue-700"
            onClick={() => onAccept(trade.tradeId)}
          >
            Accept Trade
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default TradeModal;
