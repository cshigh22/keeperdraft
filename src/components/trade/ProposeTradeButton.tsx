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

interface ProposeTradeButtonProps {
    leagueId: string;
    myTeam: TeamSummary;
    allTeams: TeamSummary[];
    myPlayers: PlayerSummary[];
    allPicks: DraftPickSummary[];
    teamRosters: Record<string, PlayerSummary[]>;
    totalRounds: number;
    leagueSeason: number;
}

/**
 * Standalone Propose Trade entry point for pages outside the draft room.
 * Wraps TradeModal and wires it to the global socket: the server requires the
 * socket to be scoped to the league (JOIN_DRAFT_ROOM) before it accepts
 * TRADE_OFFERED, so we join on connect and ignore the STATE_SYNC reply.
 */
export function ProposeTradeButton({
    leagueId,
    myTeam,
    allTeams,
    myPlayers,
    allPicks,
    teamRosters,
    totalRounds,
    leagueSeason,
}: ProposeTradeButtonProps) {
    const { data: session } = useSession();
    const userId = session?.user?.id;
    const { socket, isConnected } = useGlobalSocket(userId);
    const [error, setError] = useState<ErrorPayload | null>(null);

    useEffect(() => {
        if (!socket || !isConnected) return;
        socket.emit(SocketEvents.JOIN_DRAFT_ROOM, { leagueId });
    }, [socket, isConnected, leagueId]);

    // Surface refused proposals (roster-breaking trades, etc.) as a toast
    useEffect(() => {
        if (!socket) return;
        const onError = (payload: ErrorPayload) => setError(payload);
        socket.on(SocketEvents.ERROR, onError);
        return () => {
            socket.off(SocketEvents.ERROR, onError);
        };
    }, [socket]);

    const proposeTrade = useCallback(
        (
            receiverTeamId: string,
            myAssets: { assetType: string; id: string }[],
            theirAssets: { assetType: string; id: string }[]
        ) => {
            if (!socket) return;
            socket.emit(SocketEvents.TRADE_OFFERED, {
                leagueId,
                receiverTeamId,
                initiatorAssets: myAssets,
                receiverAssets: theirAssets,
            });
        },
        [socket, leagueId]
    );

    return (
        <>
            <TradeModal
                myTeam={myTeam}
                allTeams={allTeams}
                myPlayers={myPlayers}
                allPicks={allPicks}
                teamRosters={teamRosters}
                totalRounds={totalRounds}
                leagueSeason={leagueSeason}
                onProposeTrade={proposeTrade}
                disabled={!isConnected}
            />
            <SocketErrorToast error={error} onDismiss={() => setError(null)} />
        </>
    );
}
