import { auth } from '@/auth';
import { mintSocketToken, SOCKET_TOKEN_MAX_AGE_SECONDS } from '@/lib/socket-token';

// The browser cannot read the httpOnly session cookie, so it fetches a
// short-lived token here and presents it on the Socket.IO handshake.
export async function GET() {
    const session = await auth();

    if (!session?.user?.id) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return Response.json(
        {
            token: await mintSocketToken(session.user.id),
            expiresIn: SOCKET_TOKEN_MAX_AGE_SECONDS,
        },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}
