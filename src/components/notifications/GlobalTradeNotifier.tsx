'use client';

import React from 'react';
import { useGlobalSocket } from '@/hooks/useGlobalSocket';
import { useSession } from 'next-auth/react';
import { IncomingTradePopup } from '@/components/trade/TradeModal';
import { usePathname } from 'next/navigation';

export function GlobalTradeNotifier() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const { activeTrade, acceptTrade, rejectTrade } = useGlobalSocket(userId);
  const pathname = usePathname();

  // Don't show global notification if we're already on the draft page 
  // (to avoid duplicate UI as DraftRoomContent handles its own notifications)
  const isDraftPage = pathname.startsWith('/draft');
  if (isDraftPage || !activeTrade) return null;

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
