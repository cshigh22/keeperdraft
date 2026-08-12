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
import { ArrowLeftRight, Package, User, AlertCircle } from 'lucide-react';
import type {
  TeamSummary,
  DraftPickSummary,
  PlayerSummary,
  TradeAssetPayload,
} from '@/types/socket';

// ============================================================================
// TYPES & HELPERS
// ============================================================================

interface ProposalAsset {
  assetType: string;
  id: string;
  season?: number;
  round?: number;
}

interface TradeModalProps {
  // Required in normal mode; a commissioner composing on behalf of two other
  // teams may have no team of their own.
  myTeam?: TeamSummary;
  allTeams: TeamSummary[];
  myPlayers?: PlayerSummary[];
  allPicks: DraftPickSummary[];
  teamRosters: Record<string, PlayerSummary[]>;
  totalRounds: number;
  // The league's draft season; picks from later seasons are future assets
  leagueSeason: number;
  onProposeTrade?: (
    receiverTeamId: string,
    myAssets: ProposalAsset[],
    theirAssets: ProposalAsset[]
  ) => void;
  // Commissioner mode: both sides are freely chosen and the trade executes
  // immediately on submit (no acceptance step).
  commissionerMode?: boolean;
  onCommissionerTrade?: (
    teamAId: string,
    teamBId: string,
    teamAAssets: ProposalAsset[],
    teamBAssets: ProposalAsset[],
    notes?: string
  ) => void;
  disabled?: boolean;
  // Controlled mode (e.g. counter-offers): the parent owns open state and no
  // trigger button is rendered. Initial selections are applied on open.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialTargetTeamId?: string;
  initialMyAssetIds?: string[];
  initialTheirAssetIds?: string[];
}

// A selectable asset in the trade UI (not the persisted TradeAsset row)
interface TradeAsset {
  type: 'pick' | 'player';
  id: string;
  display: string;
  subtext?: string;
}

// Future picks have no DraftPick row yet; they're referenced by composite ID
const FUTURE_PICK_PREFIX = 'FUTURE_PICK:';
const FUTURE_YEARS_OFFERED = 3;

function toProposalAsset(asset: TradeAsset): ProposalAsset {
  if (asset.id.startsWith(FUTURE_PICK_PREFIX)) {
    const [, , year, round] = asset.id.split(':');
    return {
      assetType: 'FUTURE_PICK',
      id: asset.id,
      season: parseInt(year!),
      round: parseInt(round!),
    };
  }
  return {
    assetType: asset.type === 'pick' ? 'DRAFT_PICK' : 'PLAYER',
    id: asset.id,
  };
}

function toggleSetMember(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

// setState updater that drops selections no longer in the available asset list
function pruneStaleSelections(available: TradeAsset[]) {
  return (prev: Set<string>): Set<string> => {
    const availableIds = new Set(available.map((a) => a.id));
    const next = new Set([...prev].filter((id) => availableIds.has(id)));
    return next.size === prev.size ? prev : next;
  };
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

function GivesList({ teamName, assets }: { teamName: string; assets: TradeAsset[] }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">{teamName} gives:</p>
      {assets.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Nothing selected</p>
      ) : (
        <ul className="space-y-1">
          {assets.map((asset) => (
            <li key={asset.id} className="text-sm">
              • {asset.display}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
        <GivesList teamName={myTeamName} assets={myAssets} />

        <div className="flex items-center justify-center pt-4">
          <ArrowLeftRight className="w-5 h-5 text-muted-foreground" />
        </div>

        <GivesList teamName={theirTeamName} assets={theirAssets} />
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
  leagueSeason,
  onProposeTrade,
  commissionerMode = false,
  onCommissionerTrade,
  disabled = false,
  open: controlledOpen,
  onOpenChange,
  initialTargetTeamId,
  initialMyAssetIds,
  initialTheirAssetIds,
}: TradeModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const [selectedTeamAId, setSelectedTeamAId] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [selectedMyAssets, setSelectedMyAssets] = useState<Set<string>>(new Set());
  const [selectedTheirAssets, setSelectedTheirAssets] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');

  // Side A: my team normally; freely chosen in commissioner mode
  const sideATeam = commissionerMode
    ? allTeams.find((t) => t.id === selectedTeamAId)
    : myTeam;

  // Side B options exclude side A
  const otherTeams = useMemo(
    () => allTeams.filter((t) => t.id !== sideATeam?.id),
    [allTeams, sideATeam?.id]
  );

  const selectedTeam = otherTeams.find((t) => t.id === selectedTeamId);

  // All tradeable assets for a team: owned picks, virtual future picks, and players
  const getTeamAssets = useCallback((teamId: string, players: PlayerSummary[]) => {
    const assets: TradeAsset[] = [];

    // 1. Picks from allPicks owned by this team. "Future" is measured against
    // the league's season, not the calendar year — a December draft for next
    // season must still treat its own board picks as current.
    allPicks
      .filter((p) => p.currentOwnerId === teamId && !p.isComplete)
      .forEach((pick) => {
        const isFuture = pick.season > leagueSeason;
        const originalOwner = allTeams.find((t) => t.id === pick.originalOwnerId);
        assets.push({
          type: 'pick',
          id: isFuture
            ? `${FUTURE_PICK_PREFIX}${pick.originalOwnerId}:${pick.season}:${pick.round}`
            : pick.id,
          display: isFuture
            ? `${pick.season} Round ${pick.round} Pick`
            : `${pick.season} Round ${pick.round}, Pick ${pick.pickInRound}`,
          subtext: pick.originalOwnerId !== pick.currentOwnerId
            ? `Acquired via ${originalOwner?.ownerName || 'Trade'}`
            : isFuture ? 'Future Draft Pick' : `Pick ${pick.overallPickNumber}`,
        });
      });

    // 2. Virtual future picks (only if not already traded/represented in allPicks)
    const rounds = totalRounds || 15;
    for (let year = leagueSeason + 1; year <= leagueSeason + FUTURE_YEARS_OFFERED; year++) {
      for (let round = 1; round <= rounds; round++) {
        const isRepresented = allPicks.some(
          (p) => p.season === year && p.round === round && p.originalOwnerId === teamId
        );

        if (!isRepresented) {
          assets.push({
            type: 'pick',
            id: `${FUTURE_PICK_PREFIX}${teamId}:${year}:${round}`,
            display: `${year} Round ${round} Pick`,
            subtext: `Future Draft Pick`,
          });
        }
      }
    }

    // 3. Players
    players.forEach((player) => {
      assets.push({
        type: 'player',
        id: player.id,
        display: player.fullName,
        subtext: `${player.position} - ${player.nflTeam || 'FA'}`,
      });
    });

    return assets;
  }, [allPicks, totalRounds, allTeams, leagueSeason]);

  const myTradeAssets: TradeAsset[] = useMemo(() => {
    if (!sideATeam) return [];
    // Commissioner mode reads side A uniformly from teamRosters; normal mode
    // keeps the caller-supplied myPlayers slice.
    const players = commissionerMode
      ? teamRosters[sideATeam.id] || []
      : myPlayers || [];
    return getTeamAssets(sideATeam.id, players);
  }, [getTeamAssets, myPlayers, sideATeam, commissionerMode, teamRosters]);

  const theirTradeAssets: TradeAsset[] = useMemo(() => {
    if (!selectedTeamId) return [];
    return getTeamAssets(selectedTeamId, teamRosters[selectedTeamId] || []);
  }, [selectedTeamId, getTeamAssets, teamRosters]);

  // Build selected assets for summary
  const mySelectedAssets = myTradeAssets.filter((a) => selectedMyAssets.has(a.id));
  const theirSelectedAssets = theirTradeAssets.filter((a) => selectedTheirAssets.has(a.id));

  // Auto-clear selections that are no longer available
  useEffect(() => {
    setSelectedMyAssets(pruneStaleSelections(myTradeAssets));
  }, [myTradeAssets]);

  useEffect(() => {
    setSelectedTheirAssets(pruneStaleSelections(theirTradeAssets));
  }, [theirTradeAssets]);

  const canPropose =
    !!sideATeam &&
    !!selectedTeamId &&
    sideATeam.id !== selectedTeamId &&
    (selectedMyAssets.size > 0 || selectedTheirAssets.size > 0);

  const resetSelections = () => {
    setSelectedMyAssets(new Set());
    setSelectedTheirAssets(new Set());
    setSelectedTeamId('');
    setSelectedTeamAId('');
    setNotes('');
  };

  const handlePropose = () => {
    if (!canPropose || !sideATeam) return;

    if (commissionerMode) {
      onCommissionerTrade?.(
        sideATeam.id,
        selectedTeamId,
        mySelectedAssets.map(toProposalAsset),
        theirSelectedAssets.map(toProposalAsset),
        notes.trim() || undefined
      );
    } else {
      onProposeTrade?.(
        selectedTeamId,
        mySelectedAssets.map(toProposalAsset),
        theirSelectedAssets.map(toProposalAsset)
      );
    }

    resetSelections();
    handleOpenChange(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (isControlled) {
      onOpenChange?.(newOpen);
    } else {
      setInternalOpen(newOpen);
    }
    if (!newOpen) {
      resetSelections();
    }
  };

  // Seed selections when opened with initial values (counter-offer flow).
  // Runs only on the closed→open transition, so in-dialog edits are untouched.
  useEffect(() => {
    if (!open) return;
    if (initialTargetTeamId) setSelectedTeamId(initialTargetTeamId);
    if (initialMyAssetIds) setSelectedMyAssets(new Set(initialMyAssetIds));
    if (initialTheirAssetIds) setSelectedTheirAssets(new Set(initialTheirAssetIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" disabled={disabled}>
            <ArrowLeftRight className="w-4 h-4 mr-2" />
            {commissionerMode ? 'Commissioner Trade' : 'Propose Trade'}
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{commissionerMode ? 'Commissioner Trade' : 'Propose Trade'}</DialogTitle>
          <DialogDescription>
            {commissionerMode
              ? 'Compose a trade between any two teams. It executes immediately — no acceptance step, and roster-limit checks are bypassed.'
              : 'Select assets from both teams to include in the trade offer.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {/* Team Selection */}
          {commissionerMode && (
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Team A</label>
              <Select
                value={selectedTeamAId}
                onValueChange={(teamId) => {
                  setSelectedTeamAId(teamId);
                  if (teamId === selectedTeamId) setSelectedTeamId('');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select the first team" />
                </SelectTrigger>
                <SelectContent>
                  {allTeams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name} ({team.ownerName})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="mb-4">
            <label className="text-sm font-medium mb-2 block">
              {commissionerMode ? 'Team B' : 'Trade Partner'}
            </label>
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    commissionerMode ? 'Select the second team' : 'Select a team to trade with'
                  }
                />
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

          {selectedTeamId && sideATeam && (
            <>
              {/* Two Column Layout */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                {/* Side A */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-primary/10 px-4 py-2 border-b">
                    <h3 className="font-semibold">{sideATeam.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {commissionerMode ? `${sideATeam.ownerName}'s assets` : 'Your assets'}
                    </p>
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
                            onToggle={() =>
                              setSelectedMyAssets((prev) => toggleSetMember(prev, asset.id))
                            }
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
                            onToggle={() =>
                              setSelectedTheirAssets((prev) => toggleSetMember(prev, asset.id))
                            }
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
                myTeamName={sideATeam.name}
                theirTeamName={selectedTeam?.name || ''}
                myAssets={mySelectedAssets}
                theirAssets={theirSelectedAssets}
              />

              {commissionerMode && (
                <div className="mt-4">
                  <label className="text-sm font-medium mb-2 block" htmlFor="commissioner-notes">
                    Notes <span className="text-muted-foreground">(optional, saved on the trade record)</span>
                  </label>
                  <input
                    id="commissioner-notes"
                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Executed per league group-chat agreement"
                    maxLength={300}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handlePropose} disabled={!canPropose}>
            {commissionerMode ? 'Execute Trade' : 'Send Trade Offer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// INCOMING TRADE POPUP
// ============================================================================

// Only the fields the popup actually renders — callers may pass a mapped
// subset of TradeAssetPayload
type IncomingTradeAsset = Pick<
  TradeAssetPayload,
  'id' | 'assetType' | 'draftPick' | 'player' | 'futurePickSeason' | 'futurePickRound'
>;

function incomingAssetLabel(asset: IncomingTradeAsset): string {
  if (asset.assetType === 'DRAFT_PICK' && asset.draftPick) {
    // Current-season picks have a known slot — show it exactly (e.g. "Pick 1.4")
    return asset.draftPick.pickInRound != null
      ? `Pick ${asset.draftPick.round}.${asset.draftPick.pickInRound}`
      : `R${asset.draftPick.round} Pick`;
  }
  if (asset.assetType === 'FUTURE_PICK') {
    return `${asset.futurePickSeason} R${asset.futurePickRound}`;
  }
  return asset.player?.fullName || 'Player';
}

export function IncomingAssetList({
  label,
  assets,
  tone,
  alignRight,
}: {
  label: string;
  assets: IncomingTradeAsset[];
  tone: 'gain' | 'loss';
  alignRight?: boolean;
}) {
  return (
    <div className={cn('space-y-1.5', alignRight && 'text-right')}>
      <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{label}</p>
      <ul className="space-y-1">
        {assets.map((asset) => (
          <li
            key={asset.id}
            className={cn(
              'text-[11px] font-bold p-1.5 rounded border truncate',
              tone === 'gain'
                ? 'bg-green-50/50 text-green-700 border-green-100'
                : 'bg-red-50/50 text-red-700 border-red-100'
            )}
          >
            {incomingAssetLabel(asset)}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface IncomingTradePopupProps {
  trade: {
    tradeId: string;
    initiatorTeam: TeamSummary;
    initiatorAssets: IncomingTradeAsset[];
    receiverAssets: IncomingTradeAsset[];
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
            <IncomingAssetList label="You Get" assets={trade.initiatorAssets} tone="gain" />

            <div className="flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                <ArrowLeftRight className="w-4 h-4 text-slate-400" />
              </div>
            </div>

            <IncomingAssetList label="You Give" assets={trade.receiverAssets} tone="loss" alignRight />
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
