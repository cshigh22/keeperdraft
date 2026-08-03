// Socket.IO Server Entry Point
// Run with: npm run socket

import { startSocketServer } from './socket-server';

// Railway provides PORT automatically; fall back to SOCKET_PORT for local dev
const PORT = parseInt(process.env.PORT || process.env.SOCKET_PORT || '3001', 10);

console.log('Starting KeeperDraft Socket.IO Server...');
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Database URL: ${process.env.DATABASE_URL ? '✅ Set' : '❌ Not set'}`);
console.log(`Auth secret: ${process.env.AUTH_SECRET ? '✅ Set' : '❌ Not set'}`);

// Without it every handshake fails, which looks like a total outage rather than
// a misconfiguration. Refuse to start instead.
if (!process.env.AUTH_SECRET) {
    console.error(
        '\n❌ AUTH_SECRET is not set. It must match the value used by the Next.js app,\n' +
        '   otherwise no client can authenticate against this server.\n'
    );
    process.exit(1);
}

startSocketServer(PORT);

console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🏈 KeeperDraft Socket.IO Server                      ║
║                                                        ║
║   Server running on port ${PORT}                         ║
║                                                        ║
║   WebSocket URL: ws://localhost:${PORT}                  ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
`);
