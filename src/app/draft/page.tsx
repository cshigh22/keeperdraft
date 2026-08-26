// Draft Room Page
// Main draft interface combining board and player selection

'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { EditPickDialog } from '@/components/draft/EditPickDialog';
import { PlayerPool } from '@/components/draft/PlayerPool';
import { SidebarRoster } from '@/components/draft/SidebarRoster';
import { DraftTimer } from '@/components/draft/DraftTimer';
import { TradeModal, IncomingTradePopup } from '@/components/trade/TradeModal';
import { TradeCompletedPopup } from '@/components/trade/TradeCompletedPopup';
import { SocketErrorToast, FATAL_ERROR_CODES } from '@/components/draft/SocketErrorToast';
import { useDraftSocket } from '@/hooks/useDraftSocket';
import { useSession, signOut } from 'next-auth/react';
import { getMyTeam } from '@/lib/actions';
import { InviteLinkPanel } from '@/components/league/InviteLinkButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Wifi,
  WifiOff,
  Settings,
  LogOut,
  RefreshCw,
  AlertTriangle,
  Shield,
  Loader2,
  Trophy,
  Users,
  ArrowLeft,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DraftPickSummary, TradeAcceptedPayload, TradeOfferedPayload } from '@/types/socket';
import { revalidateLeague } from '@/app/actions/league';

// ============================================================================
// TYPES & HELPERS
// ============================================================================

type MyTeam = Awaited<ReturnType<typeof getMyTeam>>;

type SidebarTab = 'players' | 'roster';

function FullScreenSpinner({ message }: { message?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        {message && <p className="text-muted-foreground font-medium">{message}</p>}
      </div>
    </div>
  );
}

function FullScreenNotice({
  icon: Icon,
  iconClassName,
  title,
  children,
}: {
  icon: LucideIcon;
  iconClassName: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md p-6">
        <Icon className={`w-12 h-12 mx-auto mb-4 ${iconClassName}`} />
        <h1 className="text-2xl font-bold mb-2">{title}</h1>
        <p className="text-muted-foreground mb-6">{children}</p>
        <Button onClick={() => (window.location.href = '/leagues')}>
          Back to Dashboard
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// DRAFT ROOM PAGE
// ============================================================================

function DraftRoomContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const leagueId = searchParams.get('leagueId') || '';
  const [userTeam, setUserTeam] = useState<MyTeam>(null);
  const [incomingTrade, setIncomingTrade] = useState<TradeOfferedPayload | null>(null);
  const [completedTrade, setCompletedTrade] = useState<TradeAcceptedPayload | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [editingPick, setEditingPick] = useState<DraftPickSummary | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('players');
  const [selectedRosterTeamId, setSelectedRosterTeamId] = useState<string | undefined>(undefined);

  // Fetch user team info for this league
  useEffect(() => {
    async function fetchTeam() {
      if (session?.user?.id) {
        setUserTeam(await getMyTeam(leagueId));
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
    timerSeconds,
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
    },
    onTradeAccepted: (trade) => {
      // Announce the completed trade to everyone in the room
      setCompletedTrade(trade);
    },
  });

  if (status === 'loading' || isInitializing) {
    return <FullScreenSpinner message="Loading draft room..." />;
  }

  // Redirect to login if no session - middleware handles this usually, but good to have
  if (!session) {
    window.location.href = '/login';
    return null;
  }

  if (!leagueId) {
    return (
      <FullScreenNotice icon={AlertTriangle} iconClassName="text-destructive" title="Invalid League">
        No league ID was provided. Please go back to the league dashboard and try again.
      </FullScreenNotice>
    );
  }

  if (!userTeam) {
    return (
      <FullScreenNotice icon={Trophy} iconClassName="text-primary" title="No Team Found">
        You don&apos;t seem to have a team in this league ({leagueId}). Please contact your
        commissioner for an invite.
      </FullScreenNotice>
    );
  }

  const keepersUrl = `/leagues/${leagueId}/keepers?teamId=${userTeam.id}`;

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
              <Button
                variant="ghost"
                size="sm"
                className="p-0 hover:bg-transparent"
                onClick={() => window.location.href = `/leagues/${leagueId}`}
              >
                <ArrowLeft className="w-5 h-5 mr-1" />
                <h1 className="text-xl font-bold">KeeperDraft</h1>
              </Button>
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
                    secondsRemaining={timerSeconds}
                    isPaused={state.isPaused}
                  />
                </>
              )}
            </div>

            {/* Right - User info and actions */}
            <div className="flex items-center gap-3">
              {/* Trade button */}
              {myTeam && (
                <TradeModal
                  myTeam={myTeam}
                  allTeams={state.draftOrder}
                  myPlayers={state.teamRosters[myTeam.id] || []}
                  allPicks={state.allPicks}
                  teamRosters={state.teamRosters}
                  totalRounds={state.totalRounds}
                  leagueSeason={state.season}
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
                          onClick={async () => {
                            actions.resetDraft();
                            await revalidateLeague(leagueId);
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
                      <InviteLinkPanel leagueId={leagueId} />
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
                onClick={() => window.location.href = keepersUrl}
                title="Select Keepers"
              >
                <Shield className="w-5 h-5" />
              </Button>

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
          <Button onClick={() => window.location.href = keepersUrl}>
            Declare Keepers
          </Button>
        </div>
      )}

      {/* Main Content - 70/30 Wide Board Layout */}
      <main className="flex-1 min-h-0 flex overflow-hidden">
        {/* Draft Board - ~70% */}
        <div className="flex-[7] min-w-0 flex flex-col h-full bg-white overflow-hidden">
          <DraftBoard
            teams={state.draftOrder}
            completedPicks={state.completedPicks}
            allPicks={state.allPicks}
            season={state.season}
            totalRounds={state.totalRounds}
            currentPick={state.currentPick}
            currentTeamId={state.currentTeamId}
            isPaused={state.isPaused}
            draftType={state.draftType}
            myTeamId={userTeam.id}
            hideKeeperRounds={true}
            onTeamClick={(teamId) => {
              setSelectedRosterTeamId(teamId);
              setSidebarTab('roster');
            }}
            canEditPicks={userTeam.isCommissioner && state.status === 'COMPLETED'}
            onEditPick={setEditingPick}
          />
        </div>

        {/* Tabbed Sidebar - ~30% */}
        <div className="flex-[3] min-w-[320px] max-w-[420px] h-full border-l border-slate-200 flex flex-col bg-white overflow-hidden">
          <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as SidebarTab)} className="flex flex-col h-full">
            <TabsList className="w-full rounded-none border-b border-slate-200 bg-slate-50 h-9 flex-shrink-0 px-1">
              <TabsTrigger
                value="players"
                className="flex-1 text-xs font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-sm h-7"
              >
                <Search className="w-3 h-3 mr-1.5" />
                Players
              </TabsTrigger>
              <TabsTrigger
                value="roster"
                className="flex-1 text-xs font-bold uppercase tracking-wider data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-sm h-7"
              >
                <Users className="w-3 h-3 mr-1.5" />
                Rosters
              </TabsTrigger>
            </TabsList>

            <TabsContent value="players" className="flex-1 min-h-0 m-0 overflow-hidden">
              <PlayerPool
                players={state.availablePlayers}
                isMyTurn={isMyTurn}
                onDraftPlayer={actions.makePick}
                isLoading={!state.isConnected}
                teamQueue={state.teamQueues[userTeam.id] || []}
                onUpdateQueue={(playerIds) => actions.updateQueue(userTeam.id, playerIds)}
                onToggleQueue={(playerId) => actions.toggleQueue(userTeam.id, playerId)}
                rosterSettings={state.rosterSettings}
                teamRosters={state.teamRosters}
                currentTeamId={state.currentTeamId}
                myTeamId={userTeam.id}
                allPicks={state.allPicks}
                draftSeason={state.season}
              />
            </TabsContent>

            <TabsContent value="roster" className="flex-1 min-h-0 m-0 overflow-hidden">
              <SidebarRoster
                teams={state.draftOrder}
                teamRosters={state.teamRosters}
                rosterSettings={state.rosterSettings}
                myTeamId={userTeam.id}
                initialSelectedTeamId={selectedRosterTeamId || state.currentTeamId || undefined}
                onUpdateTeamName={actions.updateTeamName}
              />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Commissioner post-draft pick editing */}
      <EditPickDialog
        pick={editingPick}
        players={state.availablePlayers}
        teams={state.draftOrder}
        teamRosters={state.teamRosters}
        onConfirm={async (playerId) => {
          if (!editingPick) return;
          actions.editPick(editingPick.id, playerId);
          setEditingPick(null);
          await revalidateLeague(leagueId);
        }}
        onClose={() => setEditingPick(null)}
      />

      {/* Trade Completed Announcement */}
      {completedTrade && (
        <TradeCompletedPopup
          trade={completedTrade}
          onDismiss={() => setCompletedTrade(null)}
        />
      )}

      {/* Incoming Trade Popup */}
      {incomingTrade && (
        <IncomingTradePopup
          trade={incomingTrade}
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

      {/* Error Display — fatal errors block the room; action failures toast */}
      {state.error && FATAL_ERROR_CODES.has(state.error.code) && (
        <Dialog open onOpenChange={() => { }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-destructive">Error</DialogTitle>
              <DialogDescription>{state.error.message}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Button onClick={() => window.location.reload()}>
                Try Reloading
              </Button>
              <Button variant="outline" onClick={handleLogout}>
                Sign Out
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <SocketErrorToast
        error={state.error && !FATAL_ERROR_CODES.has(state.error.code) ? state.error : null}
        onDismiss={actions.clearError}
      />
    </div>
  );
}

export default function DraftRoom() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <DraftRoomContent />
    </Suspense>
  );
}
