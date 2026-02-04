// Socket.IO Server Entry Point
// Run with: npm run socket

import { startSocketServer } from './socket-server';

const PORT = parseInt(process.env.SOCKET_PORT || '3001', 10);

console.log('Starting KeeperDraft Socket.IO Server...');
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

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
