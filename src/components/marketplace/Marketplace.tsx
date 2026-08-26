'use client';

import React, { useState, useTransition, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatRank, UNRANKED_RANK } from '@/lib/rank';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Store,
  User,
  UserPlus,
  Plus,
  Minus,
  Search,
  ChevronDown,
  ChevronRight,
  Users,
  Trash2,
  AlertCircle,
  Inbox,
} from 'lucide-react';
import { TradeBlockCard } from './TradeBlockCard';
import { addToTradeBlock, removeFromTradeBlock } from '@/app/actions/marketplace';
import { searchGlobalPlayers, addPlayerToTeamRoster, removePlayerFromRoster } from '@/app/actions/roster';
import { listAvailableFreeAgents, pickupFreeAgent, dropPlayer } from '@/app/actions/free-agency';
import type { FreeAgentPlayer } from '@/app/actions/free-agency';
import type { TradeBlockPlayerData, GeneralRosterPlayer } from '@/types/marketplace';

// ============================================================================
// TYPES & HELPERS
// ============================================================================

type MyPlayer = Omit<GeneralRosterPlayer, 'teamId' | 'teamName'>;

type PlayerSearchResult = Awaited<ReturnType<typeof searchGlobalPlayers>>[number];

interface MarketplaceProps {
  leagueId: string;
  myTeamId: string | null;
  tradeBlockEntries: TradeBlockPlayerData[];
  myPlayers: MyPlayer[];
  leagueRosters: GeneralRosterPlayer[];
  // All league teams, not just those with rostered players — empty teams
  // still need a card so the commissioner can add their first player
  teams: { id: string; name: string }[];
  isCommissioner: boolean;
  // Free agency opens once the draft completes; the cap inputs drive the
  // "roster full, drop someone" flow (null when the league has no settings)
  draftStatus: string;
  maxRosterSize: number | null;
  myRosteredCount: number;
  // Rendered at the right end of the section header (e.g. Propose Trade)
  headerAction?: React.ReactNode;
  // Content of the Pending Trades tab (built by the league page, which owns
  // the trade data) plus the incoming-offer count for the tab badge
  pendingTradesTab?: React.ReactNode;
  pendingIncomingCount?: number;
}

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

const POSITION_BADGE_CLASSES: Record<string, string> = {
  QB: 'bg-red-500/15 text-red-500 border-red-500/20',
  RB: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
  WR: 'bg-blue-500/15 text-blue-500 border-blue-500/20',
  TE: 'bg-orange-500/15 text-orange-500 border-orange-500/20',
  K: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  DEF: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
};

function PositionBadge({ position, className }: { position: string; className?: string }) {
  return (
    <Badge
      className={cn(
        'text-[9px] px-1.5 py-0 font-mono h-5 shrink-0 border',
        POSITION_BADGE_CLASSES[position],
        className
      )}
    >
      {position}
    </Badge>
  );
}

function KeeperBadge({ draftCost }: { draftCost: number | null }) {
  return (
    <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/20 text-[8px] h-3.5 px-1 font-bold uppercase tracking-tighter">
      Keeper {draftCost ? `(Rd ${draftCost})` : ''}
    </Badge>
  );
}

function toFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

// ============================================================================
// MARKETPLACE COMPONENT
// ============================================================================

export function Marketplace({
  leagueId,
  myTeamId,
  tradeBlockEntries,
  myPlayers,
  leagueRosters,
  teams,
  isCommissioner,
  draftStatus,
  maxRosterSize,
  myRosteredCount,
  headerAction,
  pendingTradesTab,
  pendingIncomingCount = 0,
}: MarketplaceProps) {
  const [positionFilter, setPositionFilter] = useState<string>('ALL');
  const [rosterSearch, setRosterSearch] = useState('');
  const [isPending, startTransition] = useTransition();
  const [askingPrices, setAskingPrices] = useState<Record<string, string>>({});
  const [expandedTeams, setExpandedTeams] = useState<Record<string, boolean>>({});

  // Commissioner player search state
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [searchTeamId, setSearchTeamId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlayerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Remove player confirmation
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [pendingRemoveEntryId, setPendingRemoveEntryId] = useState<string | null>(null);

  // Free agent tab (loaded lazily on first tab activation)
  const [faQuery, setFaQuery] = useState('');
  const [faPosition, setFaPosition] = useState<string>('ALL');
  const [faResults, setFaResults] = useState<FreeAgentPlayer[]>([]);
  const [faLoading, setFaLoading] = useState(false);
  const [faLoaded, setFaLoaded] = useState(false);

  // Roster-full pickup flow: pick a player to drop before the add goes through
  const [dropForPickupOpen, setDropForPickupOpen] = useState(false);
  const [pendingPickup, setPendingPickup] = useState<FreeAgentPlayer | null>(null);

  // My Status drop confirmation (separate from the commissioner remove flow)
  const [dropConfirmOpen, setDropConfirmOpen] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<MyPlayer | null>(null);

  const freeAgencyOpen = draftStatus === 'COMPLETED';
  const rosterFull = maxRosterSize !== null && myRosteredCount >= maxRosterSize;

  // Error state (auto-dismisses after 5s)
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      setSearchResults(await searchGlobalPlayers(query));
    } catch {
      setSearchResults([]);
      setError('Player search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddPlayer = (playerId: string) => {
    if (!searchTeamId) return;
    const formData = toFormData({ leagueId, teamId: searchTeamId, playerId });

    startTransition(async () => {
      try {
        await addPlayerToTeamRoster(formData);
        setSearchDialogOpen(false);
        setSearchQuery('');
        setSearchResults([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add player to roster.');
      }
    });
  };

  const handleRemovePlayer = (entryId: string) => {
    setPendingRemoveEntryId(entryId);
    setRemoveConfirmOpen(true);
  };

  const handleConfirmRemove = () => {
    if (!pendingRemoveEntryId) return;
    const entryId = pendingRemoveEntryId;
    setRemoveConfirmOpen(false);
    setPendingRemoveEntryId(null);

    const formData = toFormData({ leagueId, entryId });

    startTransition(async () => {
      try {
        await removePlayerFromRoster(formData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove player from roster.');
      }
    });
  };

  const loadFreeAgents = async (query: string, position: string) => {
    setFaLoading(true);
    try {
      const result = await listAvailableFreeAgents(leagueId, { query, position });
      if (result.success) {
        setFaResults(result.data);
      } else {
        setFaResults([]);
        setError(result.error);
      }
    } catch {
      setFaResults([]);
      setError('Failed to load free agents. Please try again.');
    } finally {
      setFaLoading(false);
    }
  };

  const handleTabChange = (value: string) => {
    if (value === 'freeagents' && !faLoaded) {
      setFaLoaded(true);
      void loadFreeAgents(faQuery, faPosition);
    }
  };

  const handleFaSearch = (query: string) => {
    setFaQuery(query);
    void loadFreeAgents(query, faPosition);
  };

  const handleFaPositionChange = (position: string) => {
    setFaPosition(position);
    void loadFreeAgents(faQuery, position);
  };

  const executePickup = (playerId: string, dropRosterEntryId?: string) => {
    if (!myTeamId || isPending) return;
    const teamId = myTeamId;

    startTransition(async () => {
      try {
        const result = await pickupFreeAgent({ leagueId, teamId, playerId, dropRosterEntryId });
        if (!result.success) {
          setError(result.error ?? 'Failed to pick up player.');
        }
        setDropForPickupOpen(false);
        setPendingPickup(null);
        // Either way the pool may have shifted (success, or someone beat us to it)
        await loadFreeAgents(faQuery, faPosition);
      } catch {
        setError('Failed to pick up player. Please try again.');
      }
    });
  };

  const handlePickup = (player: FreeAgentPlayer) => {
    if (rosterFull) {
      setPendingPickup(player);
      setDropForPickupOpen(true);
      return;
    }
    executePickup(player.id);
  };

  const handleDropPlayer = (player: MyPlayer) => {
    setPendingDrop(player);
    setDropConfirmOpen(true);
  };

  const handleConfirmDrop = () => {
    if (!pendingDrop || !myTeamId) return;
    const teamId = myTeamId;
    const rosterEntryId = pendingDrop.entryId;
    setDropConfirmOpen(false);
    setPendingDrop(null);

    startTransition(async () => {
      try {
        const result = await dropPlayer({ leagueId, teamId, rosterEntryId });
        if (!result.success) {
          setError(result.error ?? 'Failed to drop player.');
        } else if (faLoaded) {
          // The dropped player is a free agent now — refresh the pool
          await loadFreeAgents(faQuery, faPosition);
        }
      } catch {
        setError('Failed to drop player. Please try again.');
      }
    });
  };

  const toggleTeam = (teamId: string) => {
    setExpandedTeams(prev => ({ ...prev, [teamId]: !prev[teamId] }));
  };

  const tradeBlockCount = tradeBlockEntries.length;

  const handleAddToBlock = (playerId: string, draftCost: number | null) => {
    if (!myTeamId || isPending) return;

    const formData = toFormData({ teamId: myTeamId, playerId, phase: 'PRE_DRAFT' });
    if (draftCost !== null) formData.set('draftCost', draftCost.toString());
    const asking = askingPrices[playerId];
    if (asking) formData.set('askingPrice', asking);

    startTransition(async () => {
      try {
        await addToTradeBlock(formData);
      } catch {
        setError('Failed to add player to trade block. Please try again.');
      }
    });
  };

  const handleRemoveFromBlock = (playerId: string) => {
    if (!myTeamId || isPending) return;

    const formData = toFormData({ teamId: myTeamId, playerId });

    startTransition(async () => {
      try {
        await removeFromTradeBlock(formData);
      } catch {
        setError('Failed to remove player from trade block. Please try again.');
      }
    });
  };

  // Group league rosters by team (filtered, sorted by rank)
  const rostersByTeam = useMemo(() => {
    const grouped: Record<string, { name: string; players: GeneralRosterPlayer[] }> = {};
    const search = rosterSearch.toLowerCase();
    const hasActiveFilter = search !== '' || positionFilter !== 'ALL';

    // With no filter active, seed every team so empty rosters still get a
    // card — the commissioner's Add Player button lives on the team header
    if (!hasActiveFilter) {
      for (const team of teams) {
        grouped[team.id] = { name: team.name, players: [] };
      }
    }

    for (const player of leagueRosters) {
      const matchesSearch = player.fullName.toLowerCase().includes(search);
      const matchesPos = positionFilter === 'ALL' || player.position === positionFilter;
      if (!matchesSearch || !matchesPos) continue;

      (grouped[player.teamId] ??= { name: player.teamName, players: [] }).players.push(player);
    }

    for (const group of Object.values(grouped)) {
      group.players.sort((a, b) => (a.rank || UNRANKED_RANK) - (b.rank || UNRANKED_RANK));
    }

    return grouped;
  }, [teams, leagueRosters, rosterSearch, positionFilter]);

  return (
    <div className="mt-8">
      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-destructive/60 hover:text-destructive">✕</button>
        </div>
      )}

      {/* Section Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/10 border border-indigo-500/20">
          <Store className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            Trade Block 2.0
          </h2>
          <p className="text-xs text-muted-foreground">
            Marketplace and manager intents
          </p>
        </div>
        {headerAction && <div className="ml-auto">{headerAction}</div>}
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="block" className="w-full" onValueChange={handleTabChange}>
        <TabsList
          className={cn(
            'w-full grid h-10',
            { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }[
              3 + (pendingTradesTab ? 1 : 0) + (freeAgencyOpen ? 1 : 0)
            ]
          )}
        >
          <TabsTrigger value="block" className="text-xs gap-1.5">
            <Store className="w-3.5 h-3.5" />
            Trade Block
            {tradeBlockCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[9px] ml-1">
                {tradeBlockCount}
              </Badge>
            )}
          </TabsTrigger>
          {pendingTradesTab && (
            <TabsTrigger value="pending" className="text-xs gap-1.5">
              <Inbox className="w-3.5 h-3.5" />
              Pending Trades
              {pendingIncomingCount > 0 && (
                <Badge className="h-4 px-1 text-[9px] ml-1 bg-blue-600 text-white hover:bg-blue-600">
                  {pendingIncomingCount}
                </Badge>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="rosters" className="text-xs gap-1.5">
            <Users className="w-3.5 h-3.5" />
            League Rosters
          </TabsTrigger>
          {freeAgencyOpen && (
            <TabsTrigger value="freeagents" className="text-xs gap-1.5">
              <UserPlus className="w-3.5 h-3.5" />
              Free Agents
            </TabsTrigger>
          )}
          <TabsTrigger value="status" className="text-xs gap-1.5">
            <User className="w-3.5 h-3.5" />
            My Status
          </TabsTrigger>
        </TabsList>

        {pendingTradesTab && (
          // forceMount keeps the inbox's socket listeners alive on other tabs,
          // so offers arriving while the user looks elsewhere still refresh the
          // page (and the tab badge) live
          <TabsContent value="pending" forceMount className="mt-4 data-[state=inactive]:hidden">
            {pendingTradesTab}
          </TabsContent>
        )}

        {/* ================================================================
            TAB 1: TRADE BLOCK
            ================================================================ */}
        <TabsContent value="block" className="mt-4">
          {tradeBlockEntries.length === 0 ? (
            <div className="text-center py-20 rounded-2xl border border-dashed border-border/40 bg-muted/5">
              <Store className="w-12 h-12 mx-auto mb-4 opacity-10" />
              <h3 className="text-sm font-semibold text-muted-foreground">The Trade Block is Empty</h3>
              <p className="text-xs text-muted-foreground/60 mt-1 max-w-[200px] mx-auto">
                No players have been listed for trade yet. Check back soon for league activity.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4 pb-12">
              {tradeBlockEntries.map((entry) => (
                <TradeBlockCard
                  key={entry.teamId + '-' + entry.playerId}
                  entry={entry}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ================================================================
            TAB 2: LEAGUE ROSTERS
            ================================================================ */}
        <TabsContent value="rosters" className="mt-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search league players..."
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  className="pl-9 h-9 text-xs"
                />
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setPositionFilter(pos)}
                    className={cn(
                      'text-[9px] font-bold px-2.5 py-1 rounded-full border transition-all shrink-0',
                      positionFilter === pos
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/60'
                    )}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-4">
                {Object.entries(rostersByTeam).map(([teamId, data]) => (
                  <div key={teamId} className="border rounded-xl overflow-hidden bg-card/50">
                    {/* Toggle and Add Player are sibling buttons — nesting the
                        Button inside the toggle <button> is invalid HTML and
                        breaks hydration */}
                    <div className="w-full flex items-center justify-between bg-muted/20 hover:bg-muted/30 transition-colors group/teamheader">
                      <button
                        onClick={() => toggleTeam(teamId)}
                        className="flex flex-1 items-center gap-2 p-3"
                      >
                        {expandedTeams[teamId] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <span className="text-xs font-bold">{data.name}</span>
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                          {data.players.length} players
                        </Badge>
                      </button>
                      {isCommissioner && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 mr-3 text-[10px] gap-1 opacity-0 group-hover/teamheader:opacity-100 transition-opacity bg-background/50 hover:bg-background"
                          onClick={() => {
                            setSearchTeamId(teamId);
                            setSearchDialogOpen(true);
                          }}
                        >
                          <Plus className="w-3 h-3" /> Add Player
                        </Button>
                      )}
                    </div>

                    {expandedTeams[teamId] && (
                      <div className="p-2 space-y-1">
                        {data.players.length === 0 && (
                          <p className="text-[10px] text-muted-foreground text-center py-2">
                            No players on this roster yet
                          </p>
                        )}
                        {data.players.map(p => (
                          <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40 transition-colors border border-transparent hover:border-border/30">
                            <PositionBadge position={p.position} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium truncate">{p.fullName}</span>
                                {p.isKeeper && <KeeperBadge draftCost={p.draftCost} />}
                                {p.isOnBlock && (
                                  <Badge className="bg-indigo-500/15 text-indigo-500 border-indigo-500/20 text-[8px] h-3.5 px-1 font-bold uppercase tracking-tighter">
                                    On Block
                                  </Badge>
                                )}
                              </div>
                              <span className="text-[10px] text-muted-foreground">{p.nflTeam || 'FA'} · Rank #{formatRank(p.rank)}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              {isCommissioner && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => handleRemovePlayer(p.entryId)}
                                  disabled={isPending}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-7 text-[10px] gap-1 px-2 border border-border/20">
                                Trade
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {Object.keys(rostersByTeam).length === 0 && (
                  <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No players found matching your criteria</p>
                  </div>
                )}
              </div>
            </ScrollArea>
        </TabsContent>

        {/* ================================================================
            TAB: FREE AGENTS (post-draft only)
            ================================================================ */}
        {freeAgencyOpen && (
          <TabsContent value="freeagents" className="mt-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search free agents..."
                  value={faQuery}
                  onChange={(e) => handleFaSearch(e.target.value)}
                  className="pl-9 h-9 text-xs"
                />
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos}
                    onClick={() => handleFaPositionChange(pos)}
                    className={cn(
                      'text-[9px] font-bold px-2.5 py-1 rounded-full border transition-all shrink-0',
                      faPosition === pos
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/60'
                    )}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>

            {faQuery.trim().length < 2 && (
              <p className="text-[10px] text-muted-foreground">
                Showing the top available players by rank. Search to find anyone else.
              </p>
            )}

            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-1.5">
                {faLoading ? (
                  <div className="text-center py-8 text-xs text-muted-foreground">
                    Loading free agents...
                  </div>
                ) : faResults.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl">
                    <Search className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No available players found</p>
                  </div>
                ) : (
                  faResults.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg border bg-muted/20 border-border/30 hover:bg-muted/40 transition-all"
                    >
                      <PositionBadge position={p.position} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium truncate">{p.fullName}</span>
                          {p.injuryStatus && (
                            <Badge className="bg-red-500/15 text-red-500 border-red-500/20 text-[8px] h-3.5 px-1 font-bold uppercase tracking-tighter">
                              {p.injuryStatus}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {p.nflTeam || 'FA'} · Rank #{formatRank(p.rank)}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        className="h-7 text-[10px] gap-1"
                        onClick={() => handlePickup(p)}
                        disabled={isPending || !myTeamId}
                      >
                        <Plus className="w-3 h-3" /> Add
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        )}

        {/* Roster Full — pick a player to drop before the add goes through */}
        <Dialog
          open={dropForPickupOpen}
          onOpenChange={(open) => {
            setDropForPickupOpen(open);
            if (!open) setPendingPickup(null);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-500" />
                Roster Full — Drop a Player
              </DialogTitle>
              <DialogDescription>
                Your roster is full ({myRosteredCount}/{maxRosterSize}). Choose a player to drop
                to make room for {pendingPickup?.fullName}. Dropping a keeper permanently clears
                their keeper status.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-1.5">
                {myPlayers.map((player) => (
                  <div
                    key={player.entryId}
                    className="flex items-center gap-3 p-2 rounded-lg border border-border/40 hover:bg-muted/30"
                  >
                    <PositionBadge position={player.position} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">{player.fullName}</span>
                        {player.isKeeper && <KeeperBadge draftCost={player.draftCost} />}
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {player.nflTeam || 'FA'} · Rank #{formatRank(player.rank)}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-[10px]"
                      onClick={() => pendingPickup && executePickup(pendingPickup.id, player.entryId)}
                      disabled={isPending}
                    >
                      Drop &amp; Add
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setDropForPickupOpen(false);
                  setPendingPickup(null);
                }}
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Drop Player Confirmation Dialog (manager self-drop) */}
        <Dialog
          open={dropConfirmOpen}
          onOpenChange={(open) => {
            setDropConfirmOpen(open);
            if (!open) setPendingDrop(null);
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Drop Player</DialogTitle>
              <DialogDescription>
                Drop {pendingDrop?.fullName}? They become a free agent immediately and any manager
                can pick them up.
                {pendingDrop?.isKeeper &&
                  ' This player is a keeper — dropping them permanently clears their keeper status.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setDropConfirmOpen(false);
                  setPendingDrop(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmDrop} disabled={isPending}>
                Drop
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Remove Player Confirmation Dialog */}
        <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Remove Player</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove this player from the roster? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setRemoveConfirmOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleConfirmRemove} disabled={isPending}>
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Commissioner Add Player Dialog */}
        <Dialog open={searchDialogOpen} onOpenChange={setSearchDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-500" />
                Add Player to Roster
              </DialogTitle>
              <DialogDescription>
                Search the global player database to manually add a player to this team.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search player name (e.g. Patrick Mahomes)..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <ScrollArea className="h-[250px] pr-4">
                <div className="space-y-2">
                  {isSearching ? (
                    <div className="text-center py-8 text-xs text-muted-foreground">Searching players...</div>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-2 rounded-lg border border-border/40 hover:bg-muted/30">
                        <div className="flex items-center gap-2">
                          <PositionBadge position={p.position} />
                          <div>
                            <div className="text-xs font-semibold">{p.fullName}</div>
                            <div className="text-[10px] text-muted-foreground">{p.nflTeam || 'FA'} · Rank #{formatRank(p.rank)}</div>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          className="h-7 text-[10px]"
                          onClick={() => handleAddPlayer(p.id)}
                          disabled={isPending}
                        >
                          Add
                        </Button>
                      </div>
                    ))
                  ) : searchQuery.length >= 2 ? (
                    <div className="text-center py-8 text-xs text-muted-foreground">No players found</div>
                  ) : (
                    <div className="text-center py-8 text-xs text-muted-foreground">Type at least 2 characters to search</div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSearchDialogOpen(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        {/* ================================================================
            TAB 3: MY STATUS
            ================================================================ */}
        <TabsContent value="status" className="mt-4 space-y-6">
          {!myTeamId ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>You don&apos;t own a team in this league</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Your Roster</h3>
                <Badge variant="secondary" className="text-[10px] h-4.5 px-1.5 font-mono">
                  {myPlayers.length} Players
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground mb-3">
                Toggle players onto the trade block. Add an asking price to help attract offers.
              </p>

              {myPlayers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No players on your roster
                </p>
              ) : (
                <ScrollArea className="h-[400px] pr-4">
                  <div className="space-y-1.5">
                    {myPlayers.map((player) => (
                      <div
                        key={player.id}
                        className={cn(
                          'flex items-center gap-3 p-2.5 rounded-lg border transition-all duration-200',
                          player.isOnBlock
                            ? 'bg-primary/5 border-primary/20'
                            : 'bg-muted/20 border-border/30 hover:bg-muted/40'
                        )}
                      >
                        <PositionBadge position={player.position} className="text-[10px]" />

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium truncate">
                              {player.fullName}
                            </span>
                            {player.isKeeper && <KeeperBadge draftCost={player.draftCost} />}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {player.nflTeam || 'FA'} · #{player.rank ?? '—'}
                          </span>
                        </div>

                        {/* Asking price input */}
                        {!player.isOnBlock && (
                          <Input
                            value={askingPrices[player.id] || ''}
                            onChange={(e) =>
                              setAskingPrices((prev) => ({
                                ...prev,
                                [player.id]: e.target.value,
                              }))
                            }
                            placeholder="Asking price..."
                            className="h-7 text-[10px] w-28 shrink-0"
                          />
                        )}

                        {/* Toggle button */}
                        <Button
                          variant={player.isOnBlock ? 'destructive' : 'outline'}
                          size="sm"
                          className="h-7 w-7 p-0 shrink-0"
                          onClick={() =>
                            player.isOnBlock
                              ? handleRemoveFromBlock(player.id)
                              : handleAddToBlock(player.id, player.draftCost)
                          }
                          disabled={isPending}
                        >
                          {player.isOnBlock ? (
                            <Minus className="w-3 h-3" />
                          ) : (
                            <Plus className="w-3 h-3" />
                          )}
                        </Button>

                        {/* Drop to free agency (post-draft only) */}
                        {freeAgencyOpen && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDropPlayer(player)}
                            disabled={isPending}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </TabsContent>

      </Tabs>
    </div>
  );
}
