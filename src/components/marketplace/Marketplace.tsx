'use client';

import React, { useState, useTransition, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
  Plus,
  Minus,
  Filter,
  Search,
  ChevronDown,
  ChevronRight,
  Users,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import { TradeBlockCard } from './TradeBlockCard';
import { addToTradeBlock, removeFromTradeBlock } from '@/app/actions/marketplace';
import { searchGlobalPlayers, addPlayerToTeamRoster, removePlayerFromRoster } from '@/app/actions/roster';
import type { TradeBlockPlayerData } from '@/types/marketplace';

// ============================================================================
// MARKETPLACE COMPONENT
// ============================================================================

interface MyPlayer {
  id: string;
  entryId: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  rank: number | null;
  isKeeper: boolean;
  isOnBlock: boolean;
  draftCost: number | null;
}

interface MarketplaceProps {
  leagueId: string;
  myTeamId: string | null;
  tradeBlockEntries: TradeBlockPlayerData[];
  myPlayers: MyPlayer[];
  leagueRosters: import("@/types/marketplace").GeneralRosterPlayer[];
  isCommissioner: boolean;
  totalRounds?: number;
  totalPlayers?: number;
}

export function Marketplace({
  leagueId,
  myTeamId,
  tradeBlockEntries,
  myPlayers,
  leagueRosters,
  isCommissioner,
  totalRounds = 14,
  totalPlayers = 168,
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
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Remove player confirmation
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [pendingRemoveEntryId, setPendingRemoveEntryId] = useState<string | null>(null);

  // Error state
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchGlobalPlayers(query);
      setSearchResults(results);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddPlayer = (playerId: string) => {
    if (!searchTeamId) return;
    const formData = new FormData();
    formData.set('leagueId', leagueId);
    formData.set('teamId', searchTeamId);
    formData.set('playerId', playerId);

    startTransition(async () => {
      try {
        await addPlayerToTeamRoster(formData);
        setSearchDialogOpen(false);
        setSearchQuery('');
        setSearchResults([]);
      } catch (err) {
        setError('Failed to add player to roster. Please try again.');
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

    const formData = new FormData();
    formData.set('leagueId', leagueId);
    formData.set('entryId', entryId);

    startTransition(async () => {
      try {
        await removePlayerFromRoster(formData);
      } catch (err) {
        setError('Failed to remove player from roster. Please try again.');
      }
    });
  };

  const toggleTeam = (teamId: string) => {
    setExpandedTeams(prev => ({ ...prev, [teamId]: !prev[teamId] }));
  };

  // Filter trade block entries
  const filteredEntries = useMemo(() => {
    if (positionFilter === 'ALL') return tradeBlockEntries;
    return tradeBlockEntries.filter(
      (e) => e.player?.position === positionFilter
    );
  }, [tradeBlockEntries, positionFilter]);

  const tradeBlockCount = tradeBlockEntries.length;

  const handleAddToBlock = (playerId: string, draftCost: number | null) => {
    if (!myTeamId || isPending) return;

    const formData = new FormData();
    formData.set('teamId', myTeamId);
    formData.set('playerId', playerId);
    if (draftCost !== null) formData.set('draftCost', draftCost.toString());
    const asking = askingPrices[playerId];
    if (asking) formData.set('askingPrice', asking);
    formData.set('phase', 'PRE_DRAFT');

    startTransition(async () => {
      try {
        await addToTradeBlock(formData);
      } catch (err) {
        setError('Failed to add player to trade block. Please try again.');
      }
    });
  };

  const handleRemoveFromBlock = (playerId: string) => {
    if (!myTeamId || isPending) return;

    const formData = new FormData();
    formData.set('teamId', myTeamId);
    formData.set('playerId', playerId);

    startTransition(async () => {
      try {
        await removeFromTradeBlock(formData);
      } catch (err) {
        setError('Failed to remove player from trade block. Please try again.');
      }
    });
  };

  const positions = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

  // Group league rosters by team
  const rostersByTeam = useMemo(() => {
    const grouped: Record<string, { name: string; players: typeof leagueRosters }> = {};
    
    leagueRosters.forEach(p => {
      // Apply filters
      const matchesSearch = p.fullName.toLowerCase().includes(rosterSearch.toLowerCase());
      const matchesPos = positionFilter === 'ALL' || p.position === positionFilter;
      
      if (matchesSearch && matchesPos) {
        if (!grouped[p.teamId]) {
          grouped[p.teamId] = { name: p.teamName, players: [] };
        }
        const teamGroup = grouped[p.teamId];
        if (teamGroup) {
          teamGroup.players.push(p);
        }
      }
    });
    
    return grouped;
  }, [leagueRosters, rosterSearch, positionFilter]);

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
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="block" className="w-full">
        <TabsList className="w-full grid grid-cols-3 h-10">
          <TabsTrigger value="block" className="text-xs gap-1.5">
            <Store className="w-3.5 h-3.5" />
            Trade Block
            {tradeBlockCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[9px] ml-1">
                {tradeBlockCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="rosters" className="text-xs gap-1.5">
            <Users className="w-3.5 h-3.5" />
            League Rosters
          </TabsTrigger>
          <TabsTrigger value="status" className="text-xs gap-1.5">
            <User className="w-3.5 h-3.5" />
            My Status
          </TabsTrigger>
        </TabsList>

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
                  totalRounds={totalRounds}
                  totalPlayers={totalPlayers}
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
                {positions.map((pos) => (
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
                    <button
                      onClick={() => toggleTeam(teamId)}
                      className="w-full flex items-center justify-between p-3 bg-muted/20 hover:bg-muted/30 transition-colors group/teamheader"
                    >
                      <div className="flex items-center gap-2">
                        {expandedTeams[teamId] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <span className="text-xs font-bold">{data.name}</span>
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                          {data.players.length} players
                        </Badge>
                      </div>
                      {isCommissioner && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 px-2 text-[10px] gap-1 opacity-0 group-hover/teamheader:opacity-100 transition-opacity bg-background/50 hover:bg-background"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSearchTeamId(teamId);
                            setSearchDialogOpen(true);
                          }}
                        >
                          <Plus className="w-3 h-3" /> Add Player
                        </Button>
                      )}
                    </button>
                    
                    {expandedTeams[teamId] && (
                      <div className="p-2 space-y-1">
                        {data?.players?.sort((a, b) => (a.rank || 999) - (b.rank || 999)).map(p => (
                          <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40 transition-colors border border-transparent hover:border-border/30">
                            <Badge className={cn(
                              'text-[9px] px-1.5 py-0 font-mono h-5 shrink-0 border',
                              p.position === 'QB' && 'bg-red-500/15 text-red-500 border-red-500/20',
                              p.position === 'RB' && 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
                              p.position === 'WR' && 'bg-blue-500/15 text-blue-500 border-blue-500/20',
                              p.position === 'TE' && 'bg-orange-500/15 text-orange-500 border-orange-500/20',
                              p.position === 'K' && 'bg-purple-500/15 text-purple-400 border-purple-500/20',
                              p.position === 'DEF' && 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
                            )}>
                              {p.position}
                            </Badge>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium truncate">{p.fullName}</span>
                                {p.isKeeper && (
                                  <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/20 text-[8px] h-3.5 px-1 font-bold uppercase tracking-tighter">
                                    Keeper {p.draftCost ? `(Rd ${p.draftCost})` : ''}
                                  </Badge>
                                )}
                                {p.isOnBlock && (
                                  <Badge className="bg-indigo-500/15 text-indigo-500 border-indigo-500/20 text-[8px] h-3.5 px-1 font-bold uppercase tracking-tighter">
                                    On Block
                                  </Badge>
                                )}
                              </div>
                              <span className="text-[10px] text-muted-foreground">{p.nflTeam || 'FA'} · Rank #{p.rank ?? '—'}</span>
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
                          <Badge className={cn(
                            'text-[9px] px-1.5 py-0 font-mono h-5',
                            p.position === 'QB' && 'bg-red-500/15 text-red-500 border-red-500/20',
                            p.position === 'RB' && 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
                            p.position === 'WR' && 'bg-blue-500/15 text-blue-500 border-blue-500/20',
                            p.position === 'TE' && 'bg-orange-500/15 text-orange-500 border-orange-500/20',
                            p.position === 'K' && 'bg-purple-500/15 text-purple-400 border-purple-500/20',
                            p.position === 'DEF' && 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
                          )}>
                            {p.position}
                          </Badge>
                          <div>
                            <div className="text-xs font-semibold">{p.fullName}</div>
                            <div className="text-[10px] text-muted-foreground">{p.nflTeam || 'FA'} · Rank #{p.rank ?? '—'}</div>
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
            <>
              {/* My Players */}
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
                          {/* Position */}
                          <Badge
                            className={cn(
                              'text-[10px] px-1.5 py-0 font-mono h-5 shrink-0 border',
                              player.position === 'QB' && 'bg-red-500/15 text-red-500 border-red-500/20',
                              player.position === 'RB' && 'bg-emerald-500/15 text-emerald-500 border-emerald-500/20',
                              player.position === 'WR' && 'bg-blue-500/15 text-blue-500 border-blue-500/20',
                              player.position === 'TE' && 'bg-orange-500/15 text-orange-500 border-orange-500/20',
                              player.position === 'K' && 'bg-purple-500/15 text-purple-500 border-purple-500/20',
                              player.position === 'DEF' && 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
                            )}
                          >
                            {player.position}
                          </Badge>

                          {/* Name */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium truncate">
                                {player.fullName}
                              </span>
                              {player.isKeeper && (
                                <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/20 text-[8px] h-3.5 px-1 font-bold uppercase tracking-tighter">
                                  Keeper {player.draftCost ? `(Rd ${player.draftCost})` : ''}
                                </Badge>
                              )}
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
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </>
          )}
        </TabsContent>

      </Tabs>
    </div>
  );
}
