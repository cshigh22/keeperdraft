// Trade Modal Component
// Complex two-column interface for proposing trades

'use client';

import React, { useState, useMemo } from 'react';
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
import { ArrowLeftRight, Package, User, AlertCircle } from 'lucide-react';
import type { TeamSummary, DraftPickSummary, PlayerSummary } from '@/types/socket';

// ============================================================================
// TYPES
// ============================================================================

interface TradeModalProps {
  myTeam: TeamSummary;
  allTeams: TeamSummary[];
  myPicks: DraftPickSummary[];
  myPlayers: PlayerSummary[];
  onProposeTrade: (
    receiverTeamId: string,
    myAssets: { assetType: string; id: string }[],
    theirAssets: { assetType: string; id: string }[]
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
  myPicks,
  myPlayers,
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

  // Convert my picks and players to TradeAssets
  const myTradeAssets: TradeAsset[] = useMemo(() => {
    const assets: TradeAsset[] = [];

    // Add picks (only incomplete ones I own)
    myPicks
      .filter((p) => !p.isComplete && p.currentOwnerId === myTeam.id)
      .forEach((pick) => {
        assets.push({
          type: 'pick',
          id: pick.id,
          display: `Round ${pick.round}, Pick ${pick.pickInRound}`,
          subtext: pick.originalOwnerId !== pick.currentOwnerId ? 'Acquired via trade' : undefined,
        });
      });

    // Add players
    myPlayers.forEach((player) => {
      assets.push({
        type: 'player',
        id: player.id,
        display: player.fullName,
        subtext: `${player.position} - ${player.nflTeam || 'FA'}`,
      });
    });

    return assets;
  }, [myPicks, myPlayers, myTeam.id]);

  // Mock their assets (in real app, fetch from server)
  // For now, just show their picks from the completed picks list
  const theirTradeAssets: TradeAsset[] = useMemo(() => {
    if (!selectedTeamId) return [];

    const assets: TradeAsset[] = [];

    // This would normally come from the server
    // For demo, we'll show a placeholder
    // In production, you'd fetch the other team's tradeable assets

    return assets;
  }, [selectedTeamId]);

  // Build selected assets for summary
  const mySelectedAssets = myTradeAssets.filter((a) => selectedMyAssets.has(a.id));
  const theirSelectedAssets = theirTradeAssets.filter((a) => selectedTheirAssets.has(a.id));

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

    const myAssets = mySelectedAssets.map((a) => ({
      assetType: a.type === 'pick' ? 'DRAFT_PICK' : 'PLAYER',
      id: a.id,
    }));

    const theirAssets = theirSelectedAssets.map((a) => ({
      assetType: a.type === 'pick' ? 'DRAFT_PICK' : 'PLAYER',
      id: a.id,
    }));

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
                      {selectedTeam?.ownerName}'s assets
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
                            The other team's picks will be shown after selecting.
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
    initiatorAssets: { id: string; assetType: string; draftPick?: { round: number }; player?: { fullName: string } }[];
    receiverAssets: { id: string; assetType: string; draftPick?: { round: number }; player?: { fullName: string } }[];
  };
  onAccept: (tradeId: string) => void;
  onReject: (tradeId: string) => void;
}

export function IncomingTradePopup({ trade, onAccept, onReject }: IncomingTradePopupProps) {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5" />
            Trade Offer from {trade.initiatorTeam.name}
          </DialogTitle>
          <DialogDescription>
            {trade.initiatorTeam.ownerName} has sent you a trade proposal.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[1fr,auto,1fr] gap-4 py-4">
          {/* They offer */}
          <div>
            <p className="text-sm font-medium mb-2">They offer:</p>
            <ul className="space-y-1">
              {trade.initiatorAssets.map((asset) => (
                <li key={asset.id} className="text-sm p-2 bg-green-50 dark:bg-green-950 rounded">
                  {asset.assetType === 'DRAFT_PICK'
                    ? `Round ${asset.draftPick?.round} Pick`
                    : asset.player?.fullName}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center">
            <ArrowLeftRight className="w-5 h-5 text-muted-foreground" />
          </div>

          {/* You give */}
          <div>
            <p className="text-sm font-medium mb-2">You give:</p>
            <ul className="space-y-1">
              {trade.receiverAssets.map((asset) => (
                <li key={asset.id} className="text-sm p-2 bg-red-50 dark:bg-red-950 rounded">
                  {asset.assetType === 'DRAFT_PICK'
                    ? `Round ${asset.draftPick?.round} Pick`
                    : asset.player?.fullName}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onReject(trade.tradeId)}>
            Decline
          </Button>
          <Button onClick={() => onAccept(trade.tradeId)}>
            Accept Trade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TradeModal;
