// The Socket.IO server runs on a different origin from the Next.js app, so the
// NextAuth session cookie is never sent with its handshake. The browser instead
// asks Next.js for a short-lived token derived from the same AUTH_SECRET and
// presents that on connect; the socket server verifies it before trusting any
// identity claim.

import { encode, decode } from 'next-auth/jwt';

// Distinct from the session cookie's salt, so a socket token can never be
// swapped in for a session cookie or vice versa.
const SOCKET_TOKEN_SALT = 'keeperdraft.socket-token';

// Long enough to outlast a draft. The client re-fetches if it ever expires.
export const SOCKET_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 12;

function requireSecret(): string {
    const secret = process.env.AUTH_SECRET;
    if (!secret) {
        throw new Error(
            'AUTH_SECRET is not set. Both the Next.js app and the Socket.IO server need it to issue and verify socket tokens.'
        );
    }
    return secret;
}

export async function mintSocketToken(userId: string): Promise<string> {
    return encode({
        token: { sub: userId },
        secret: requireSecret(),
        salt: SOCKET_TOKEN_SALT,
        maxAge: SOCKET_TOKEN_MAX_AGE_SECONDS,
    });
}

// Returns the authenticated user id, or null if the token is missing, malformed,
// expired, or was signed with a different secret. A missing AUTH_SECRET throws
// rather than returning null, so a misconfigured deploy fails loudly instead of
// silently rejecting every user.
export async function verifySocketToken(token: unknown): Promise<string | null> {
    const secret = requireSecret();

    if (typeof token !== 'string' || token.length === 0) return null;

    try {
        const claims = await decode({ token, secret, salt: SOCKET_TOKEN_SALT });
        return claims?.sub ?? null;
    } catch {
        return null;
    }
}
