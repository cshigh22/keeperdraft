'use client';

import React, { useEffect } from 'react';
import { useGlobalSocket } from '@/hooks/useGlobalSocket';
import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { IncomingTradePopup } from '@/components/trade/TradeModal';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeftRight, X } from 'lucide-react';
import type { TradeAcceptedPayload } from '@/types/socket';

const EXECUTED_TOAST_MS = 12000;

// Banner shown to a manager whose team was part of a commissioner-executed
// trade — there was no offer step, so this is their only notification.
function ExecutedTradeToast({
  trade,
  onDismiss,
}: {
  trade: TradeAcceptedPayload;
  onDismiss: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(onDismiss, EXECUTED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[380px] animate-in slide-in-from-right-full fade-in duration-500 ease-out">
      <Card className="border-2 border-amber-500 shadow-2xl bg-white/95 backdrop-blur-sm overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-1.5 bg-amber-500 rounded-md shrink-0">
              <ArrowLeftRight className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-slate-900">
                Commissioner executed a trade involving your team
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {trade.initiatorTeam.name} ↔ {trade.receiverTeam.name}
              </p>
              <Button
                variant="link"
                size="sm"
                className="px-0 h-auto text-xs mt-1"
                onClick={() => {
                  onDismiss();
                  router.refresh();
                }}
              >
                Refresh to see your updated roster
              </Button>
            </div>
            <button
              className="text-slate-400 hover:text-slate-600 shrink-0"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const OUTCOME_TOAST_MS = 8000;

// One-line notice that the other side accepted / declined / withdrew an offer
function OutcomeToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, OUTCOME_TOAST_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[380px] animate-in slide-in-from-right-full fade-in duration-500 ease-out">
      <Card className="border-2 border-blue-500 shadow-2xl bg-white/95 backdrop-blur-sm overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-1.5 bg-blue-500 rounded-md shrink-0">
              <ArrowLeftRight className="w-4 h-4 text-white" />
            </div>
            <p className="flex-1 min-w-0 font-bold text-sm text-slate-900">{message}</p>
            <button
              className="text-slate-400 hover:text-slate-600 shrink-0"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function GlobalTradeNotifier() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const {
    activeTrade,
    acceptTrade,
    rejectTrade,
    executedTrade,
    clearExecutedTrade,
    outcomeNotice,
    clearOutcomeNotice,
  } = useGlobalSocket(userId);
  const pathname = usePathname();

  // Don't show global notification if we're already on the draft page
  // (to avoid duplicate UI as DraftRoomContent handles its own notifications)
  const isDraftPage = pathname.startsWith('/draft');
  if (isDraftPage) return null;

  if (activeTrade) {
    return (
      <IncomingTradePopup
        trade={{
          tradeId: activeTrade.tradeId,
          initiatorTeam: activeTrade.initiatorTeam,
          initiatorAssets: activeTrade.initiatorAssets,
          receiverAssets: activeTrade.receiverAssets,
        }}
        onAccept={() => acceptTrade(activeTrade.tradeId)}
        onReject={() => rejectTrade(activeTrade.tradeId)}
      />
    );
  }

  if (executedTrade) {
    return <ExecutedTradeToast trade={executedTrade} onDismiss={clearExecutedTrade} />;
  }

  if (outcomeNotice) {
    return <OutcomeToast message={outcomeNotice} onDismiss={clearOutcomeNotice} />;
  }

  return null;
}
