'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { SocketEvents } from '@/types/socket';
import type {
  TradeOfferedPayload,
  TradeAcceptedPayload,
  TradeRejectedPayload
} from '@/types/socket';
import { createAuthenticatedSocket, type TypedSocket } from '@/lib/socket-connection';

// Singleton socket instance to avoid multiple connections across the app
let globalSocket: TypedSocket | null = null;

export function useGlobalSocket(userId?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [activeTrade, setActiveTrade] = useState<TradeOfferedPayload | null>(null);
  // A commissioner-executed trade involving one of this user's teams
  const [executedTrade, setExecutedTrade] = useState<TradeAcceptedPayload | null>(null);
  // One-line outcome of an offer this user proposed or received (accepted /
  // declined / withdrawn by the other side)
  const [outcomeNotice, setOutcomeNotice] = useState<string | null>(null);
  const socketRef = useRef<TypedSocket | null>(null);

  useEffect(() => {
    if (!userId) return;

    if (!globalSocket) {
      globalSocket = createAuthenticatedSocket();
    }

    socketRef.current = globalSocket;

    const onConnect = () => {
      setIsConnected(true);
      console.log('Global socket connected');
      // The server puts this socket in the user's private room from the
      // authenticated handshake — nothing to announce here.
    };

    const onDisconnect = () => {
      setIsConnected(false);
      console.log('Global socket disconnected');
    };

    const onTradeOffered = (payload: TradeOfferedPayload) => {
      console.log('Global trade offered received:', payload);
      // Only show if it matches the current user (the receiver)
      // Note: The server already filters this by emitting to user room, but extra safety is good
      if (payload.receiverTeam.ownerId === userId) {
        setActiveTrade(payload);
      }
    };

    const onTradeAccepted = (payload: TradeAcceptedPayload) => {
        // If this trade was currently being shown, clear it
        setActiveTrade(current => current?.tradeId === payload.tradeId ? null : current);

        // Commissioner-executed trades have no offer step, so this is the
        // affected manager's first (and only) notification
        if (
          payload.forcedByCommissioner &&
          (payload.initiatorTeam.ownerId === userId ||
            payload.receiverTeam.ownerId === userId)
        ) {
          setExecutedTrade(payload);
        } else if (!payload.forcedByCommissioner && payload.initiatorTeam.ownerId === userId) {
          // The receiver accepted this user's offer
          setOutcomeNotice(`${payload.receiverTeam.name} accepted your trade offer`);
        }
    };

    const onTradeRejected = (payload: TradeRejectedPayload) => {
        console.log('Global trade rejected received:', payload.tradeId);
        setActiveTrade(current => current?.tradeId === payload.tradeId ? null : current);
        if (payload.rejectedBy === 'receiver' && payload.initiatorOwnerId === userId) {
          setOutcomeNotice(`${payload.receiverTeamName ?? 'The other team'} declined your trade offer`);
        }
    };

    const onTradeCancelled = (payload: TradeRejectedPayload) => {
        console.log('Global trade cancelled received:', payload.tradeId);
        setActiveTrade(current => current?.tradeId === payload.tradeId ? null : current);
        if (payload.rejectedBy === 'initiator' && payload.receiverOwnerId === userId) {
          setOutcomeNotice(`${payload.initiatorTeamName ?? 'The other team'} withdrew their trade offer`);
        }
    };

    socketRef.current.on('connect', onConnect);
    socketRef.current.on('disconnect', onDisconnect);
    socketRef.current.on(SocketEvents.TRADE_OFFERED, onTradeOffered);
    socketRef.current.on(SocketEvents.TRADE_ACCEPTED, onTradeAccepted);
    socketRef.current.on(SocketEvents.TRADE_REJECTED, onTradeRejected);
    socketRef.current.on(SocketEvents.TRADE_CANCELLED, onTradeCancelled);

    // Join room if already connected
    if (socketRef.current.connected) {
      onConnect();
    }

    return () => {
      // Don't disconnect globalSocket, just remove listeners
      socketRef.current?.off('connect', onConnect);
      socketRef.current?.off('disconnect', onDisconnect);
      socketRef.current?.off(SocketEvents.TRADE_OFFERED, onTradeOffered);
      socketRef.current?.off(SocketEvents.TRADE_ACCEPTED, onTradeAccepted);
      socketRef.current?.off(SocketEvents.TRADE_REJECTED, onTradeRejected);
      socketRef.current?.off(SocketEvents.TRADE_CANCELLED, onTradeCancelled);
    };
  }, [userId]);

  const acceptTrade = useCallback((tradeId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit(SocketEvents.TRADE_ACCEPTED, { tradeId });
    setActiveTrade(null);
  }, []);

  const rejectTrade = useCallback((tradeId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit(SocketEvents.TRADE_REJECTED, { tradeId });
    setActiveTrade(null);
  }, []);

  // Initiator withdrawing their own pending offer
  const cancelTrade = useCallback((tradeId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit(SocketEvents.TRADE_CANCELLED, { tradeId });
  }, []);

  const clearExecutedTrade = useCallback(() => setExecutedTrade(null), []);
  const clearOutcomeNotice = useCallback(() => setOutcomeNotice(null), []);

  return {
    socket: socketRef.current,
    isConnected,
    activeTrade,
    setActiveTrade,
    executedTrade,
    clearExecutedTrade,
    outcomeNotice,
    clearOutcomeNotice,
    acceptTrade,
    rejectTrade,
    cancelTrade,
  };
}
