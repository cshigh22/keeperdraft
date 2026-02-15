// Commissioner Dashboard
// Admin controls for managing the draft

'use client';

import React, { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getMyTeam } from '@/lib/actions';
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
import { updateDraftSettingsAction, getDraftSettingsAction } from '@/app/actions/commissioner';

// ============================================================================
// COMMISSIONER DASHBOARD
// ============================================================================

export default function CommissionerDashboard() {
  const { data: authSession, status: authStatus } = useSession();
  const searchParams = useSearchParams();
  const leagueId = searchParams.get('leagueId') || '';
  const [userTeam, setUserTeam] = useState<any | null>(null);
  const [timerDuration, setTimerDuration] = useState('90');
  const [pauseReason, setPauseReason] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: string;
    onConfirm: () => void;
  }>({ open: false, action: '', onConfirm: () => { } });

  const [maxKeepers, setMaxKeepers] = useState(3);
  const [keeperDeadline, setKeeperDeadline] = useState('');

  // Fetch team and settings
  React.useEffect(() => {
    async function fetchData() {
      if (authSession?.user?.id && leagueId) {
        const team = await getMyTeam(leagueId);
        setUserTeam(team);

        const result = await getDraftSettingsAction(leagueId);
        if (result.success && result.data) {
          setMaxKeepers(result.data.maxKeepers || 3);
          setTimerDuration(result.data.timerDurationSeconds?.toString() || '90');
          if (result.data.keeperDeadline) {
            const d = new Date(result.data.keeperDeadline);
            const offset = d.getTimezoneOffset() * 60000;
            const localISOTime = (new Date(d.getTime() - offset)).toISOString().slice(0, 16);
            setKeeperDeadline(localISOTime);
          }
        }
      }
    }
    if (authStatus !== 'loading') {
      fetchData();
    }
  }, [authSession, authStatus, leagueId]);

  const handleUpdateSettings = async () => {
    await updateDraftSettingsAction({
      leagueId,
      maxKeepers,
      keeperDeadline: keeperDeadline ? new Date(keeperDeadline) : null,
      timerDurationSeconds: parseInt(timerDuration),
    });
    // Optional: show feedback
  };

  const { state, actions } = useDraftSocket({
    leagueId,
    userId: authSession?.user?.id || '',
    teamId: userTeam?.id,
  });

  // Check if session is loaded
  if (authStatus === 'loading' || (authSession && !userTeam && leagueId)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!authSession || !userTeam) {
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
                  Manage your league&apos;s draft
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
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold">Draft Settings</h3>
                  <Button size="sm" onClick={handleUpdateSettings}>Save Settings</Button>
                </div>

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
                  <div className="space-y-2">
                    <Label htmlFor="maxKeepers">Max Keepers per Team</Label>
                    <Input
                      id="maxKeepers"
                      type="number"
                      min="0"
                      max="20"
                      value={maxKeepers}
                      onChange={(e) => setMaxKeepers(parseInt(e.target.value) || 0)}
                      disabled={state.status === 'IN_PROGRESS'}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="keeperDeadline">Keeper Deadline</Label>
                    <Input
                      id="keeperDeadline"
                      type="datetime-local"
                      value={keeperDeadline}
                      onChange={(e) => setKeeperDeadline(e.target.value)}
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
