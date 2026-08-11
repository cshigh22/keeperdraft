'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useGlobalSocket } from '@/hooks/useGlobalSocket';
import { TradeModal } from '@/components/trade/TradeModal';
import { SocketErrorToast } from '@/components/draft/SocketErrorToast';
import { SocketEvents } from '@/types/socket';
import type {
    ErrorPayload,
    TeamSummary,
    PlayerSummary,
    DraftPickSummary,
} from '@/types/socket';

interface CommissionerTradeButtonProps {
    leagueId: string;
    allTeams: TeamSummary[];
    allPicks: DraftPickSummary[];
    teamRosters: Record<string, PlayerSummary[]>;
    totalRounds: number;
    leagueSeason: number;
}

/**
 * Commissioner entry point for executing a trade between any two teams on
 * their behalf. Wraps TradeModal in commissioner mode and wires it to the
 * global socket (JOIN_DRAFT_ROOM on connect, same as ProposeTradeButton —
 * the server requires league scope before accepting trade events). The
 * commissioner identity itself is verified server-side against the DB.
 */
export function CommissionerTradeButton({
    leagueId,
    allTeams,
    allPicks,
    teamRosters,
    totalRounds,
    leagueSeason,
}: CommissionerTradeButtonProps) {
    const { data: session } = useSession();
    const userId = session?.user?.id;
    const { socket, isConnected } = useGlobalSocket(userId);
    const [error, setError] = useState<ErrorPayload | null>(null);

    useEffect(() => {
        if (!socket || !isConnected) return;
        socket.emit(SocketEvents.JOIN_DRAFT_ROOM, { leagueId });
    }, [socket, isConnected, leagueId]);

    // Surface refused executions (unowned assets, etc.) as a toast
    useEffect(() => {
        if (!socket) return;
        const onError = (payload: ErrorPayload) => setError(payload);
        socket.on(SocketEvents.ERROR, onError);
        return () => {
            socket.off(SocketEvents.ERROR, onError);
        };
    }, [socket]);

    const executeTrade = useCallback(
        (
            teamAId: string,
            teamBId: string,
            teamAAssets: { assetType: string; id: string }[],
            teamBAssets: { assetType: string; id: string }[],
            notes?: string
        ) => {
            if (!socket) return;
            socket.emit(SocketEvents.COMMISSIONER_TRADE, {
                leagueId,
                teamAId,
                teamBId,
                teamAAssets,
                teamBAssets,
                notes,
            });
        },
        [socket, leagueId]
    );

    return (
        <>
            <TradeModal
                commissionerMode
                allTeams={allTeams}
                allPicks={allPicks}
                teamRosters={teamRosters}
                totalRounds={totalRounds}
                leagueSeason={leagueSeason}
                onCommissionerTrade={executeTrade}
                disabled={!isConnected}
            />
            <SocketErrorToast error={error} onDismiss={() => setError(null)} />
        </>
    );
}
