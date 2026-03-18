'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { SocketEvents } from '@/types/socket';
import type { 
  ServerToClientEvents, 
  ClientToServerEvents, 
  TradeOfferedPayload,
  TradeAcceptedPayload,
  TradeRejectedPayload
} from '@/types/socket';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Singleton socket instance to avoid multiple connections across the app
let globalSocket: TypedSocket | null = null;

export function useGlobalSocket(userId?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [activeTrade, setActiveTrade] = useState<TradeOfferedPayload | null>(null);
  const socketRef = useRef<TypedSocket | null>(null);

  useEffect(() => {
    if (!userId) return;

    if (!globalSocket) {
      const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      globalSocket = io(socketUrl, {
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        autoConnect: true,
      });
    }

    socketRef.current = globalSocket;

    const onConnect = () => {
      setIsConnected(true);
      console.log('Global socket connected');
      // Identify this user to join their private room
      globalSocket?.emit(SocketEvents.AUTHENTICATE, { userId });
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
    };

    const onTradeRejected = (payload: TradeRejectedPayload) => {
        setActiveTrade(current => current?.tradeId === payload.tradeId ? null : current);
    };

    const onTradeCancelled = (payload: TradeRejectedPayload) => {
        setActiveTrade(current => current?.tradeId === payload.tradeId ? null : current);
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

  const acceptTrade = useCallback((leagueId: string, tradeId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit(SocketEvents.TRADE_ACCEPTED, { leagueId, tradeId });
    setActiveTrade(null);
  }, []);

  const rejectTrade = useCallback((leagueId: string, tradeId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit(SocketEvents.TRADE_REJECTED, { leagueId, tradeId });
    setActiveTrade(null);
  }, []);

  return {
    socket: socketRef.current,
    isConnected,
    activeTrade,
    setActiveTrade,
    acceptTrade,
    rejectTrade,
  };
}
