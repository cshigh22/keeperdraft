// Draft Room Page
// Main draft interface combining board and player selection

'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DraftBoard } from '@/components/draft/DraftBoard';
import { PlayerPool } from '@/components/draft/PlayerPool';
import { SidebarRoster } from '@/components/draft/SidebarRoster';
import { DraftTimer } from '@/components/draft/DraftTimer';
import { TradeModal, IncomingTradePopup } from '@/components/trade/TradeModal';
import { useDraftSocket } from '@/hooks/useDraftSocket';
import { TeamRosters } from '@/components/draft/TeamRosters';
import { useSession, signOut } from 'next-auth/react';
import { getMyTeam } from '@/lib/actions';
import { InviteLinkButton } from '@/components/league/InviteLinkButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Wifi,
  WifiOff,
  Settings,
  LogOut,
  Bell,
  ArrowLeftRight,
  RefreshCw,
  AlertTriangle,
  Shield,
  Loader2,
  Trophy,
  Users,
} from 'lucide-react';
import type { TradeOfferedPayload } from '@/types/socket';

// ============================================================================
// MOCK SESSION (Replace with real auth in production)
// ============================================================================

// DELETED useMockSession

// ============================================================================
// DRAFT ROOM PAGE
// ============================================================================

export default function DraftRoom() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const leagueId = searchParams.get('leagueId') || '';
  const [userTeam, setUserTeam] = useState<any | null>(null);
  const [incomingTrade, setIncomingTrade] = useState<TradeOfferedPayload | null>(null);
  const [notificationCount, setNotificationCount] = useState(0);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Fetch user team info for this league
  useEffect(() => {
    async function fetchTeam() {
      if (session?.user?.id) {
        const team = await getMyTeam(leagueId);
        setUserTeam(team);
      }
      setIsInitializing(false);
    }
    if (status !== 'loading') {
      fetchTeam();
    }
  }, [session, status, leagueId]);

  // Socket connection
  const {
    state,
    isMyTurn,
    myTeam,
    actions,
  } = useDraftSocket({
    leagueId,
    userId: session?.user?.id || '',
    teamId: userTeam?.id,
    onTradeOffered: (trade) => {
      // Show popup if trade is for my team
      if (trade.receiverTeam.id === userTeam?.id) {
        setIncomingTrade(trade);
      }
      setNotificationCount((n) => n + 1);
    },
    onPickMade: () => {
      // Clear notification count when viewing
    },
  });

  // Loading state
  if (status === 'loading' || isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground font-medium">Loading draft room...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if no session - middleware handles this usually, but good to have
  if (!session) {
    window.location.href = '/login';
    return null;
  }

  if (!userTeam) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md p-6">
          <Trophy className="w-12 h-12 text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">No Team Found</h1>
          <p className="text-muted-foreground mb-6">
            You don&apos;t seem to have a team in this league. Please contact the commissioner for an invite.
          </p>
          <Button onClick={() => (window.location.href = '/login')}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const handleDraftPlayer = (playerId: string) => {
    actions.makePick(playerId);
  };

  const handleLogout = () => {
    signOut({ callbackUrl: '/login' });
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Left - Logo and status */}
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold">KeeperDraft</h1>
              <Badge
                variant={state.isConnected ? 'default' : 'destructive'}
                className="gap-1"
              >
                {state.isConnected ? (
                  <Wifi className="w-3 h-3" />
                ) : (
                  <WifiOff className="w-3 h-3" />
                )}
                {state.isConnected ? 'Live' : 'Offline'}
              </Badge>
              <Badge variant="outline">
                {state.status.replace('_', ' ')}
              </Badge>
            </div>

            {/* Center - Current pick info */}
            <div className="hidden md:flex items-center gap-4">
              {state.status === 'IN_PROGRESS' && (
                <>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Round</p>
                    <p className="font-bold">{state.currentRound}</p>
                  </div>
                  <Separator orientation="vertical" className="h-8" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Pick</p>
                    <p className="font-bold">{state.currentPick}</p>
                  </div>
                  <Separator orientation="vertical" className="h-8" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">On Clock</p>
                    <p className="font-bold truncate max-w-[120px]">
                      {state.currentTeam?.name || '-'}
                    </p>
                  </div>
                  <Separator orientation="vertical" className="h-8" />
                  <DraftTimer
                    secondsRemaining={state.timerSecondsRemaining}
                    isPaused={state.isPaused}
                  />
                </>
              )}
            </div>

            {/* Right - User info and actions */}
            <div className="flex items-center gap-3">
              {/* Notifications */}
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="w-5 h-5" />
                {notificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center">
                    {notificationCount}
                  </span>
                )}
              </Button>

              {/* Trade button */}
              {myTeam && (
                <TradeModal
                  myTeam={myTeam}
                  allTeams={state.draftOrder}
                  myPlayers={state.teamRosters[myTeam.id] || []}
                  allPicks={state.allPicks}
                  teamRosters={state.teamRosters}
                  totalRounds={state.totalRounds}
                  onProposeTrade={actions.proposeTrade}
                />
              )}

              {/* Commissioner Actions */}
              {userTeam.isCommissioner && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setShowResetConfirm(true)}
                    title="Restart Draft"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => (window.location.href = `/admin?leagueId=${leagueId}`)}
                    title="Commissioner Settings"
                  >
                    <Settings className="w-5 h-5" />
                  </Button>

                  <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
                    <DialogContent>
                      <DialogHeader>
                        <div className="flex items-center gap-2 text-destructive mb-2">
                          <AlertTriangle className="w-6 h-6" />
                          <DialogTitle>Restart Draft?</DialogTitle>
                        </div>
                        <DialogDescription>
                          This will completely wipe all draft picks, return all traded picks to their original owners, and clear all team rosters. This action <span className="font-bold text-destructive">cannot be undone</span>.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="flex justify-end gap-3 mt-4">
                        <Button variant="outline" onClick={() => setShowResetConfirm(false)}>
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => {
                            actions.resetDraft();
                            setShowResetConfirm(false);
                          }}
                        >
                          Reset Everything
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Invite Members"
                      >
                        <Users className="w-5 h-5" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <InviteLinkButton leagueId={leagueId} />
                    </DialogContent>
                  </Dialog>
                </>
              )}

              {/* User/Team info */}
              <div className="hidden sm:block text-right">
                <p className="text-sm font-medium">{userTeam.name}</p>
                <p className="text-xs text-muted-foreground">
                  {userTeam.isCommissioner ? 'Commissioner' : 'Team Owner'}
                </p>
              </div>

              {/* Keepers Link */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => window.location.href = `/leagues/${leagueId}/keepers?teamId=${userTeam.id}`}
                title="Select Keepers"
              >
                <Shield className="w-5 h-5" />
              </Button>
              {/* Logout */}

              {/* Logout */}
              <Button variant="ghost" size="icon" onClick={handleLogout}>
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        {/* My turn banner */}
        {isMyTurn && (
          <div className="bg-green-500 text-white py-2 px-4 text-center font-semibold animate-pulse">
            You&apos;re on the clock! Make your pick!
          </div>
        )}

        {/* Paused banner */}
        {state.isPaused && (
          <div className="bg-yellow-500 text-yellow-950 py-2 px-4 text-center font-semibold">
            Draft Paused: {state.pauseReason || 'No reason provided'}
          </div>
        )}
      </header>

      {/* Pre-Draft Keepers Banner */}
      {state.status === 'NOT_STARTED' && (
        <div className="bg-primary/10 border-b border-primary/20 py-4 px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-primary" />
            <div>
              <h3 className="font-semibold text-primary">Draft has not started</h3>
              <p className="text-sm text-muted-foreground">Please review and declare your keepers before the draft begins.</p>
            </div>
          </div>
          <Button
            onClick={() => window.location.href = `/leagues/${leagueId}/keepers?teamId=${userTeam.id}`}
          >
            Declare Keepers
          </Button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-4 min-h-0 flex flex-col">
        <div className="flex flex-col lg:flex-row gap-4 h-full min-h-0">
          {/* Main Area (Draft Board) */}
          <div className="flex-1 min-w-0 flex flex-col h-full bg-white">
            <div className="flex-1 min-h-0">
              <DraftBoard
                teams={state.draftOrder}
                completedPicks={state.completedPicks}
                allPicks={state.allPicks}
                totalRounds={state.totalRounds}
                currentPick={state.currentPick}
                currentTeamId={state.currentTeamId}
                isPaused={state.isPaused}
                draftType={state.draftType}
                myTeamId={userTeam.id}
                hideKeeperRounds={true}
              />
            </div>

            {/* Recent Picks Footer (Optional as per image but sticking to sidebar request first) */}
          </div>

          {/* Unified Sidebar (Player Pool & Team Roster) */}
          <div className="w-full lg:w-[720px] lg:flex-shrink-0 h-full flex flex-row border-l border-slate-200 overflow-hidden">
            {/* Left Column: Player Pool */}
            <div className="flex-1 h-full border-r border-slate-200">
              <PlayerPool
                players={state.availablePlayers}
                isMyTurn={isMyTurn}
                onDraftPlayer={handleDraftPlayer}
                isLoading={!state.isConnected}
                teamQueue={state.teamQueues[userTeam.id] || []}
                onUpdateQueue={(playerIds) => actions.updateQueue(userTeam.id, playerIds)}
              />
            </div>

            {/* Right Column: Team Roster */}
            <div className="flex-1 h-full">
              <SidebarRoster
                teams={state.draftOrder}
                teamRosters={state.teamRosters}
                rosterSettings={state.rosterSettings}
                myTeamId={userTeam.id}
              />
            </div>
          </div>
        </div>
      </main>

      {/* Incoming Trade Popup */}
      {incomingTrade && (
        <IncomingTradePopup
          trade={{
            tradeId: incomingTrade.tradeId,
            initiatorTeam: incomingTrade.initiatorTeam,
            initiatorAssets: incomingTrade.initiatorAssets.map((a) => ({
              id: a.id,
              assetType: a.assetType,
              draftPick: a.draftPick,
              player: a.player,
              futurePickSeason: a.futurePickSeason,
              futurePickRound: a.futurePickRound,
            })),
            receiverAssets: incomingTrade.receiverAssets.map((a) => ({
              id: a.id,
              assetType: a.assetType,
              draftPick: a.draftPick,
              player: a.player,
              futurePickSeason: a.futurePickSeason,
              futurePickRound: a.futurePickRound,
            })),
          }}
          onAccept={(tradeId) => {
            actions.acceptTrade(tradeId);
            setIncomingTrade(null);
          }}
          onReject={(tradeId) => {
            actions.rejectTrade(tradeId);
            setIncomingTrade(null);
          }}
        />
      )}

      {/* Error Display */}
      {state.error && (
        <Dialog open={!!state.error} onOpenChange={() => { }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-destructive">Error</DialogTitle>
              <DialogDescription>{state.error.message}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Button onClick={() => window.location.reload()}>
                Try Reloading
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  signOut({ callbackUrl: '/login' });
                }}
              >
                Sign Out
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
