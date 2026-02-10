// Draft Room Page
// Main draft interface combining board and player selection

'use client';

import React, { useState, useEffect } from 'react';
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
} from '@/components/ui/dialog';
import { DraftBoard } from '@/components/draft/DraftBoard';
import { PlayerQueue } from '@/components/draft/PlayerQueue';
import { TradeModal, IncomingTradePopup } from '@/components/trade/TradeModal';
import { useDraftSocket } from '@/hooks/useDraftSocket';
import {
  Wifi,
  WifiOff,
  Settings,
  LogOut,
  Bell,
  ArrowLeftRight,
} from 'lucide-react';
import type { TradeOfferedPayload } from '@/types/socket';

// ============================================================================
// MOCK SESSION (Replace with real auth in production)
// ============================================================================

function useMockSession() {
  const [session, setSession] = useState<{
    userId: string;
    teamId: string;
    teamName: string;
    isCommissioner: boolean;
  } | null>(null);

  useEffect(() => {
    // Check localStorage for mock session
    const stored = localStorage.getItem('draftSession');
    if (stored) {
      setSession(JSON.parse(stored));
    }
  }, []);

  return { session, setSession };
}

const MOCK_LEAGUE_ID = 'demo-league';

// ============================================================================
// DRAFT ROOM PAGE
// ============================================================================

export default function DraftRoom() {
  const { session, setSession } = useMockSession();
  const [incomingTrade, setIncomingTrade] = useState<TradeOfferedPayload | null>(null);
  const [notificationCount, setNotificationCount] = useState(0);

  // Socket connection
  const {
    state,
    isMyTurn,
    myTeam,
    actions,
  } = useDraftSocket({
    leagueId: MOCK_LEAGUE_ID,
    userId: session?.userId || '',
    teamId: session?.teamId,
    onTradeOffered: (trade) => {
      // Show popup if trade is for my team
      if (trade.receiverTeam.id === session?.teamId) {
        setIncomingTrade(trade);
      }
      setNotificationCount((n) => n + 1);
    },
    onPickMade: () => {
      // Clear notification count when viewing
    },
  });

  // Redirect to login if no session
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Draft Room</h1>
          <p className="text-muted-foreground mb-4">
            Please select a team to join the draft.
          </p>
          <Button onClick={() => (window.location.href = '/login')}>
            Select Team
          </Button>
        </div>
      </div>
    );
  }

  const handleDraftPlayer = (playerId: string) => {
    actions.makePick(playerId);
  };

  const handleLogout = () => {
    localStorage.removeItem('draftSession');
    setSession(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
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
                  myPicks={state.completedPicks.filter(
                    (p) => p.currentOwnerId === myTeam.id && !p.isComplete
                  )}
                  myPlayers={[]} // Would come from roster state
                  onProposeTrade={actions.proposeTrade}
                />
              )}

              {/* Commissioner link */}
              {session.isCommissioner && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => (window.location.href = '/admin')}
                >
                  <Settings className="w-5 h-5" />
                </Button>
              )}

              {/* User/Team info */}
              <div className="hidden sm:block text-right">
                <p className="text-sm font-medium">{session.teamName}</p>
                <p className="text-xs text-muted-foreground">
                  {session.isCommissioner ? 'Commissioner' : 'Team Owner'}
                </p>
              </div>

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
            You're on the clock! Make your pick!
          </div>
        )}

        {/* Paused banner */}
        {state.isPaused && (
          <div className="bg-yellow-500 text-yellow-950 py-2 px-4 text-center font-semibold">
            Draft Paused: {state.pauseReason || 'No reason provided'}
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-4">
        <div className="flex flex-col lg:flex-row gap-4 h-full">
          {/* Draft Board */}
          <div className="flex-1 min-w-0">
            <DraftBoard
              teams={state.draftOrder}
              completedPicks={state.completedPicks}
              totalRounds={state.totalRounds}
              currentPick={state.currentPick}
              currentTeamId={state.currentTeamId}
              isPaused={state.isPaused}
              draftType={state.draftType}
              myTeamId={session.teamId}
            />
          </div>

          {/* Player Queue Sidebar */}
          <div className="w-full lg:w-96 lg:flex-shrink-0">
            <PlayerQueue
              players={state.availablePlayers}
              isMyTurn={isMyTurn}
              currentTeamName={state.currentTeam?.name || null}
              timerSeconds={state.timerSecondsRemaining}
              isPaused={state.isPaused}
              isLoading={!state.isConnected}
              onDraftPlayer={handleDraftPlayer}
            />
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
            })),
            receiverAssets: incomingTrade.receiverAssets.map((a) => ({
              id: a.id,
              assetType: a.assetType,
              draftPick: a.draftPick,
              player: a.player,
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
                  localStorage.removeItem('draftSession');
                  window.location.href = '/login';
                }}
              >
                Back to Team Selection
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
