'use client';

import { useEffect } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { IncomingAssetList } from '@/components/trade/TradeModal';
import type { TradeAcceptedPayload } from '@/types/socket';

const AUTO_HIDE_MS = 10000;

interface TradeCompletedPopupProps {
  trade: TradeAcceptedPayload;
  onDismiss: () => void;
  autoHideMs?: number;
}

// League-wide announcement shown to everyone in the draft room when a trade
// completes. The draft keeps running — this replaces the old auto-pause.
export function TradeCompletedPopup({
  trade,
  onDismiss,
  autoHideMs = AUTO_HIDE_MS,
}: TradeCompletedPopupProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, autoHideMs);
    return () => clearTimeout(timer);
  }, [onDismiss, autoHideMs]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[440px] max-w-[calc(100vw-2rem)] animate-in slide-in-from-top-full fade-in duration-500 ease-out">
      <Card className="border-2 border-emerald-500 shadow-2xl bg-white/95 backdrop-blur-sm overflow-hidden">
        <CardHeader className="pb-3 bg-slate-50 border-b border-slate-100">
          <CardTitle className="flex items-center justify-between text-base">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-500 rounded-md">
                <ArrowLeftRight className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-slate-900 text-sm">Trade Completed</span>
              {trade.forcedByCommissioner && (
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wider bg-amber-50 text-amber-600 border-amber-200"
                >
                  Commissioner Trade
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 -mr-1 text-slate-400 hover:text-slate-600"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </Button>
          </CardTitle>
          <CardDescription className="text-[11px] font-medium text-slate-500">
            {trade.initiatorTeam.name} &harr; {trade.receiverTeam.name} &middot; the draft
            continues
          </CardDescription>
        </CardHeader>

        <CardContent className="p-4">
          <div className="grid grid-cols-[1fr,auto,1fr] gap-4 items-center">
            {/* initiatorAssets = what the initiator gave up, so each side "gets" the other's list */}
            <IncomingAssetList
              label={`${trade.initiatorTeam.name} gets`}
              assets={trade.receiverAssets}
              tone="gain"
            />

            <div className="flex items-center justify-center">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                <ArrowLeftRight className="w-4 h-4 text-slate-400" />
              </div>
            </div>

            <IncomingAssetList
              label={`${trade.receiverTeam.name} gets`}
              assets={trade.initiatorAssets}
              tone="gain"
              alignRight
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
