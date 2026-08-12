'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Clock, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useGlobalSocket } from '@/hooks/useGlobalSocket';
import { TradeModal } from '@/components/trade/TradeModal';
import { SocketErrorToast } from '@/components/draft/SocketErrorToast';
import { SocketEvents } from '@/types/socket';
import type {
  DraftPickSummary,
  ErrorPayload,
  PlayerSummary,
  TeamSummary,
} from '@/types/socket';

// ============================================================================
// TYPES (serialized on the league page server component)
// ============================================================================

export interface PendingTradeAsset {
  id: string;
  assetType: 'DRAFT_PICK' | 'PLAYER' | 'FUTURE_PICK';
  playerId: string | null;
  draftPickId: string | null;
  label: string;
}

export interface PendingTradeData {
  tradeId: string;
  initiatorTeam: { id: string; name: string };
  receiverTeam: { id: string; name: string };
  // Assets each side is giving up
  initiatorAssets: PendingTradeAsset[];
  receiverAssets: PendingTradeAsset[];
  proposedAt: string;
  expiresAt: string | null;
}

interface PendingTradesProps {
  leagueId: string;
  userId?: string;
  myTeam: TeamSummary | null;
  allTeams: TeamSummary[];
  myPlayers: PlayerSummary[];
  allPicks: DraftPickSummary[];
  teamRosters: Record<string, PlayerSummary[]>;
  totalRounds: number;
  leagueSeason: number;
  pendingTrades: PendingTradeData[];
}

// ============================================================================
// HELPERS
// ============================================================================

function isExpired(trade: PendingTradeData): boolean {
  return !!trade.expiresAt && new Date(trade.expiresAt).getTime() < Date.now();
}

function expiryLabel(trade: PendingTradeData): string | null {
  if (!trade.expiresAt) return null;
  const msLeft = new Date(trade.expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return 'Expired';
  const hours = Math.floor(msLeft / 3_600_000);
  if (hours >= 1) return `Expires in ${hours}h`;
  return `Expires in ${Math.max(1, Math.floor(msLeft / 60_000))}m`;
}

// The trade modal keys selectable assets by playerId for players and by the
// DraftPick row id for current-season picks. Future picks use a composite id
// we can't always reconstruct here, so those simply aren't pre-selected.
function toModalAssetIds(assets: PendingTradeAsset[]): string[] {
  return assets
    .map((a) => a.playerId ?? a.draftPickId)
    .filter((id): id is string => !!id);
}

function AssetColumn({
  label,
  assets,
  tone,
  alignRight,
}: {
  label: string;
  assets: PendingTradeAsset[];
  tone: 'gain' | 'loss';
  alignRight?: boolean;
}) {
  return (
    <div className={cn('space-y-1.5 min-w-0', alignRight && 'text-right')}>
      <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{label}</p>
      <ul className="space-y-1">
        {assets.length === 0 ? (
          <li className="text-[11px] italic text-slate-400 p-1.5">Nothing</li>
        ) : (
          assets.map((asset) => (
            <li
              key={asset.id}
              className={cn(
                'text-[11px] font-bold p-1.5 rounded border truncate',
                tone === 'gain'
                  ? 'bg-green-50/50 text-green-700 border-green-100'
                  : 'bg-red-50/50 text-red-700 border-red-100'
              )}
            >
              {asset.label}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PendingTrades({
  leagueId,
  userId,
  myTeam,
  allTeams,
  myPlayers,
  allPicks,
  teamRosters,
  totalRounds,
  leagueSeason,
  pendingTrades,
}: PendingTradesProps) {
  const router = useRouter();
  const { socket, isConnected, acceptTrade, rejectTrade, cancelTrade } = useGlobalSocket(userId);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [counterFor, setCounterFor] = useState<PendingTradeData | null>(null);
  const [actedTradeIds, setActedTradeIds] = useState<Set<string>>(new Set());

  // Proposing (the counter) requires the socket to be league-scoped
  useEffect(() => {
    if (!socket || !isConnected) return;
    socket.emit(SocketEvents.JOIN_DRAFT_ROOM, { leagueId });
  }, [socket, isConnected, leagueId]);

  // Refresh the server-rendered list whenever any trade event reaches us
  useEffect(() => {
    if (!socket) return;
    const refresh = () => router.refresh();
    const onError = (payload: ErrorPayload) => setError(payload);
    socket.on(SocketEvents.TRADE_OFFERED, refresh);
    socket.on(SocketEvents.TRADE_ACCEPTED, refresh);
    socket.on(SocketEvents.TRADE_REJECTED, refresh);
    socket.on(SocketEvents.TRADE_CANCELLED, refresh);
    socket.on(SocketEvents.ERROR, onError);
    return () => {
      socket.off(SocketEvents.TRADE_OFFERED, refresh);
      socket.off(SocketEvents.TRADE_ACCEPTED, refresh);
      socket.off(SocketEvents.TRADE_REJECTED, refresh);
      socket.off(SocketEvents.TRADE_CANCELLED, refresh);
      socket.off(SocketEvents.ERROR, onError);
    };
  }, [socket, router]);

  const markActed = (tradeId: string) =>
    setActedTradeIds((prev) => new Set(prev).add(tradeId));

  const incoming = useMemo(
    () => pendingTrades.filter((t) => myTeam && t.receiverTeam.id === myTeam.id),
    [pendingTrades, myTeam]
  );
  const outgoing = useMemo(
    () => pendingTrades.filter((t) => myTeam && t.initiatorTeam.id === myTeam.id),
    [pendingTrades, myTeam]
  );

  const sendCounter = useCallback(
    (
      receiverTeamId: string,
      myAssets: { assetType: string; id: string }[],
      theirAssets: { assetType: string; id: string }[]
    ) => {
      if (!socket || !counterFor) return;
      socket.emit(SocketEvents.TRADE_OFFERED, {
        leagueId,
        receiverTeamId,
        initiatorAssets: myAssets,
        receiverAssets: theirAssets,
      });
      // Countering declines the original offer — one live offer per negotiation
      rejectTrade(counterFor.tradeId);
      markActed(counterFor.tradeId);
      setCounterFor(null);
      router.refresh();
    },
    [socket, counterFor, leagueId, rejectTrade, router]
  );

  if (!myTeam) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-2">
        <Inbox className="w-12 h-12 opacity-10" />
        <p className="text-sm font-medium">You need a team in this league to trade</p>
      </div>
    );
  }

  const renderTrade = (trade: PendingTradeData, direction: 'incoming' | 'outgoing') => {
    const expired = isExpired(trade);
    const expiry = expiryLabel(trade);
    const acted = actedTradeIds.has(trade.tradeId);
    const counterparty =
      direction === 'incoming' ? trade.initiatorTeam.name : trade.receiverTeam.name;
    // "You get" is always the other side's package
    const youGet = direction === 'incoming' ? trade.initiatorAssets : trade.receiverAssets;
    const youGive = direction === 'incoming' ? trade.receiverAssets : trade.initiatorAssets;

    return (
      <div
        key={trade.tradeId}
        className={cn(
          'border rounded-lg p-4 space-y-3',
          expired ? 'opacity-60 bg-slate-50' : 'bg-white'
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ArrowLeftRight className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-sm font-semibold truncate">
              {direction === 'incoming' ? `Offer from ${counterparty}` : `Offer to ${counterparty}`}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {expiry && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] gap-1',
                  expired
                    ? 'bg-red-50 text-red-600 border-red-200'
                    : 'bg-slate-50 text-slate-500 border-slate-200'
                )}
              >
                <Clock className="w-3 h-3" />
                {expiry}
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[1fr,auto,1fr] gap-4 items-start">
          <AssetColumn label="You Get" assets={youGet} tone="gain" />
          <div className="flex items-center justify-center pt-5">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
              <ArrowLeftRight className="w-4 h-4 text-slate-400" />
            </div>
          </div>
          <AssetColumn label="You Give" assets={youGive} tone="loss" alignRight />
        </div>

        <div className="flex justify-end gap-2 pt-1 border-t border-slate-100">
          {direction === 'incoming' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="text-xs font-bold"
                disabled={acted || !isConnected}
                onClick={() => setCounterFor(trade)}
              >
                Counter
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs font-bold hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                disabled={acted || !isConnected}
                onClick={() => {
                  rejectTrade(trade.tradeId);
                  markActed(trade.tradeId);
                }}
              >
                Decline
              </Button>
              <Button
                size="sm"
                className="text-xs font-bold bg-blue-600 hover:bg-blue-700"
                disabled={acted || expired || !isConnected}
                onClick={() => {
                  acceptTrade(trade.tradeId);
                  markActed(trade.tradeId);
                }}
              >
                Accept
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="text-xs font-bold hover:bg-red-50 hover:text-red-600 hover:border-red-200"
              disabled={acted || !isConnected}
              onClick={() => {
                cancelTrade(trade.tradeId);
                markActed(trade.tradeId);
              }}
            >
              Cancel Offer
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {incoming.length === 0 && outgoing.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-2">
          <Inbox className="w-12 h-12 opacity-10" />
          <p className="text-sm font-medium">No pending trades</p>
          <p className="text-xs">Offers you send or receive will show up here.</p>
        </div>
      ) : (
        <>
          {incoming.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
                Incoming Offers
              </h3>
              {incoming.map((t) => renderTrade(t, 'incoming'))}
            </div>
          )}
          {outgoing.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">
                Outgoing Offers
              </h3>
              {outgoing.map((t) => renderTrade(t, 'outgoing'))}
            </div>
          )}
        </>
      )}

      {/* Counter-offer composer: prefilled with the original package reversed */}
      {counterFor && (
        <TradeModal
          open={!!counterFor}
          onOpenChange={(open) => {
            if (!open) setCounterFor(null);
          }}
          myTeam={myTeam}
          allTeams={allTeams}
          myPlayers={myPlayers}
          allPicks={allPicks}
          teamRosters={teamRosters}
          totalRounds={totalRounds}
          leagueSeason={leagueSeason}
          initialTargetTeamId={counterFor.initiatorTeam.id}
          initialMyAssetIds={toModalAssetIds(counterFor.receiverAssets)}
          initialTheirAssetIds={toModalAssetIds(counterFor.initiatorAssets)}
          onProposeTrade={sendCounter}
        />
      )}

      <SocketErrorToast error={error} onDismiss={() => setError(null)} />
    </div>
  );
}
