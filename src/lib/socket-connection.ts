'use client';

import { io, type Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@/types/socket';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// The session cookie is httpOnly and scoped to the Next.js origin, so it never
// reaches the socket server. This exchanges it for a token the socket server
// can verify.
async function fetchSocketToken(): Promise<string> {
    const response = await fetch('/api/socket-token', { credentials: 'include' });

    if (!response.ok) {
        throw new Error(`Could not obtain socket token (${response.status})`);
    }

    const { token } = await response.json();
    return token as string;
}

export function createAuthenticatedSocket(): TypedSocket {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

    return io(socketUrl, {
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        // Runs before every connection attempt, including reconnects, so a draft
        // that outlasts a token picks up a fresh one automatically.
        auth: (cb) => {
            fetchSocketToken()
                .then((token) => cb({ token }))
                // Send an empty token so the server rejects the handshake promptly.
                // Never calling cb would leave the connection hanging instead.
                .catch((error) => {
                    console.error('Socket auth failed:', error);
                    cb({ token: '' });
                });
        },
    });
}
