// Commissioner Dashboard
// Admin controls for managing the draft

'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Play,
  Pause,
  RotateCcw,
  Settings,
  Shield,
  Users,
  ArrowUpDown,
  Check,
  X,
  AlertTriangle,
  Clock,
  Shuffle,
  Loader2,
} from 'lucide-react';
import { useDraftSocket } from '@/hooks/useDraftSocket';

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

  useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('draftSession');
      if (stored) {
        setSession(JSON.parse(stored));
      }
    }
  });

  return session;
}

const MOCK_LEAGUE_ID = 'demo-league';

// ============================================================================
// COMMISSIONER DASHBOARD
// ============================================================================

export default function CommissionerDashboard() {
  const session = useMockSession();
  const [timerDuration, setTimerDuration] = useState('90');
  const [pauseReason, setPauseReason] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: string;
    onConfirm: () => void;
  }>({ open: false, action: '', onConfirm: () => { } });

  const { state, actions } = useDraftSocket({
    leagueId: MOCK_LEAGUE_ID,
    userId: session?.userId || '',
    teamId: session?.teamId,
  });

  // Check if session is loaded
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  // Check if user is commissioner (in production, use actual auth)
  if (!session.isCommissioner) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Shield className="w-5 h-5" />
              Access Denied
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This page is only accessible to league commissioners.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleAction = (action: string, onConfirm: () => void) => {
    setConfirmDialog({ open: true, action, onConfirm });
  };

  const executeAction = () => {
    confirmDialog.onConfirm();
    setConfirmDialog({ open: false, action: '', onConfirm: () => { } });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-8 h-8 text-primary" />
              <div>
                <h1 className="text-2xl font-bold">Commissioner Dashboard</h1>
                <p className="text-sm text-muted-foreground">
                  Manage your league's draft
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Badge
                variant={state.isConnected ? 'default' : 'destructive'}
                className="gap-1"
              >
                <span
                  className={cn(
                    'w-2 h-2 rounded-full',
                    state.isConnected ? 'bg-green-500' : 'bg-red-500'
                  )}
                />
                {state.isConnected ? 'Connected' : 'Disconnected'}
              </Badge>
              <Badge variant="outline" className="text-lg px-4 py-2">
                {state.status.replace('_', ' ')}
              </Badge>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Draft Controls */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Draft Controls
              </CardTitle>
              <CardDescription>
                Manage the draft flow and settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Primary Actions */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Button
                  size="lg"
                  className="h-24 flex-col gap-2"
                  onClick={() =>
                    handleAction('Start Draft', actions.startDraft)
                  }
                  disabled={state.status !== 'NOT_STARTED'}
                >
                  <Play className="w-8 h-8" />
                  Start Draft
                </Button>

                <Button
                  size="lg"
                  variant={state.isPaused ? 'default' : 'secondary'}
                  className="h-24 flex-col gap-2"
                  onClick={() => {
                    if (state.isPaused) {
                      handleAction('Resume Draft', actions.resumeDraft);
                    } else {
                      handleAction('Pause Draft', () =>
                        actions.pauseDraft(pauseReason || 'Commissioner paused')
                      );
                    }
                  }}
                  disabled={state.status !== 'IN_PROGRESS'}
                >
                  {state.isPaused ? (
                    <>
                      <Play className="w-8 h-8" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="w-8 h-8" />
                      Pause
                    </>
                  )}
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  className="h-24 flex-col gap-2"
                  onClick={() =>
                    handleAction('Undo Last Pick', actions.undoLastPick)
                  }
                  disabled={state.status !== 'IN_PROGRESS'}
                >
                  <RotateCcw className="w-8 h-8" />
                  Undo Pick
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  className="h-24 flex-col gap-2"
                  onClick={() =>
                    handleAction('Randomize Order', () => {
                      const shuffled = [...state.draftOrder]
                        .sort(() => Math.random() - 0.5)
                        .map((t) => t.id);
                      actions.updateOrder(shuffled);
                    })
                  }
                  disabled={state.status !== 'NOT_STARTED'}
                >
                  <Shuffle className="w-8 h-8" />
                  Randomize
                </Button>
              </div>

              <Separator />

              {/* Current Status */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-muted rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground">Current Pick</p>
                  <p className="text-3xl font-bold">{state.currentPick}</p>
                </div>
                <div className="bg-muted rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground">Current Round</p>
                  <p className="text-3xl font-bold">{state.currentRound}</p>
                </div>
                <div className="bg-muted rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground">On The Clock</p>
                  <p className="text-lg font-semibold truncate">
                    {state.currentTeam?.name || '-'}
                  </p>
                </div>
                <div className="bg-muted rounded-lg p-4 text-center">
                  <p className="text-sm text-muted-foreground">Timer</p>
                  <p className="text-3xl font-bold font-mono">
                    {state.timerSecondsRemaining !== null
                      ? `${Math.floor(state.timerSecondsRemaining / 60)}:${(
                        state.timerSecondsRemaining % 60
                      )
                        .toString()
                        .padStart(2, '0')}`
                      : '--:--'}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Settings */}
              <div className="space-y-4">
                <h3 className="font-semibold">Draft Settings</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="timer">Timer Duration (seconds)</Label>
                    <Input
                      id="timer"
                      type="number"
                      value={timerDuration}
                      onChange={(e) => setTimerDuration(e.target.value)}
                      disabled={state.status === 'IN_PROGRESS'}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pauseReason">Pause Reason</Label>
                    <Input
                      id="pauseReason"
                      placeholder="Optional reason for pause"
                      value={pauseReason}
                      onChange={(e) => setPauseReason(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch id="pauseOnTrade" defaultChecked />
                  <Label htmlFor="pauseOnTrade">
                    Auto-pause draft when trade is accepted
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Draft Order */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpDown className="w-5 h-5" />
                Draft Order
              </CardTitle>
              <CardDescription>
                {state.draftOrder.length} teams
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {state.draftOrder.map((team, index) => (
                    <div
                      key={team.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border',
                        team.id === state.currentTeamId &&
                        'bg-primary/10 border-primary'
                      )}
                    >
                      <Badge variant="outline" className="w-8 h-8 justify-center">
                        {index + 1}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{team.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {team.ownerName}
                        </p>
                      </div>
                      {team.id === state.currentTeamId && (
                        <Badge className="gap-1">
                          <Clock className="w-3 h-3" />
                          On Clock
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Pending Trades */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Pending Trades
              </CardTitle>
              <CardDescription>
                Review and manage trade proposals
              </CardDescription>
            </CardHeader>
            <CardContent>
              {state.pendingTrades.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No pending trades</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {state.pendingTrades.map((trade) => (
                    <div
                      key={trade.tradeId}
                      className="flex items-center gap-4 p-4 border rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline">
                            {trade.initiatorTeam.name}
                          </Badge>
                          <span className="text-muted-foreground">↔</span>
                          <Badge variant="outline">
                            {trade.receiverTeam.name}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {trade.initiatorAssets.length} assets ↔{' '}
                          {trade.receiverAssets.length} assets
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() =>
                            handleAction('Veto Trade', () =>
                              actions.rejectTrade(trade.tradeId)
                            )
                          }
                        >
                          <X className="w-4 h-4" />
                          Veto
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1"
                          onClick={() =>
                            handleAction('Force Approve', () =>
                              actions.acceptTrade(trade.tradeId)
                            )
                          }
                        >
                          <Check className="w-4 h-4" />
                          Force Approve
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) =>
          setConfirmDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Confirm Action
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to {confirmDialog.action.toLowerCase()}?
              This action may affect the draft.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setConfirmDialog({ open: false, action: '', onConfirm: () => { } })
              }
            >
              Cancel
            </Button>
            <Button onClick={executeAction}>{confirmDialog.action}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
