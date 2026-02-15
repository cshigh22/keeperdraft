// Socket.IO Server Setup
// Handles real-time draft communication and trade processing

import { createServer } from 'http';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  SocketEventName,
  TradeAcceptedPayload,
  TradeAssetPayload,
  TeamSummary,
  DraftPickSummary,
} from '@/types/socket';
import { SocketEvents } from '@/types/socket';
import { prisma } from '@/lib/prisma';
import { DraftStateManager } from './draft-state-manager';
import { TradeProcessor } from './trade-processor';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

const httpServer = createServer();
const io: TypedServer = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
      : true, // Allow all origins in development
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Draft state managers per league
const draftManagers = new Map<string, DraftStateManager>();
const tradeProcessor = new TradeProcessor(prisma);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getDraftManager(leagueId: string): DraftStateManager {
  let manager = draftManagers.get(leagueId);
  if (!manager) {
    manager = new DraftStateManager(leagueId, prisma, io);
    draftManagers.set(leagueId, manager);
  }
  return manager;
}

function getRoomName(leagueId: string): string {
  return `draft:${leagueId}`;
}

async function verifyCommissioner(userId: string, leagueId: string): Promise<boolean> {
  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      commissionerId: userId,
    },
  });
  return !!league;
}

async function getTeamForUser(userId: string, leagueId: string): Promise<string | null> {
  const team = await prisma.team.findFirst({
    where: {
      ownerId: userId,
      leagueId,
    },
    select: { id: true },
  });
  return team?.id ?? null;
}

// ============================================================================
// CONNECTION HANDLER
// ============================================================================

io.on(SocketEvents.CONNECTION, (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // -------------------------------------------------------------------------
  // JOIN DRAFT ROOM
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.JOIN_DRAFT_ROOM, async (payload) => {
    const { leagueId, userId, teamId } = payload;

    console.log(`[DEBUG] JOIN_DRAFT_ROOM - userId: ${userId}, leagueId: ${leagueId}, teamId: ${teamId}`);

    try {
      // First, check if user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      console.log(`[DEBUG] User lookup (id: ${userId}):`, user?.email);

      // Check all league members for this league
      const allMembers = await prisma.leagueMember.findMany({
        where: { leagueId },
        include: { user: true },
      });
      console.log(
        `[DEBUG] All league members for ${leagueId}:`,
        allMembers.map((m) => ({ userId: m.userId, userEmail: m.user.email }))
      );

      // Verify user has access to this league
      let member = await prisma.leagueMember.findUnique({
        where: {
          userId_leagueId: { userId, leagueId },
        },
        include: {
          league: true,
        },
      });

      console.log(`[DEBUG] LeagueMember lookup result:`, member);

      // FALLBACK: If member record is missing but user is commissioner or has a team,
      // create the membership record on the fly to prevent lockout
      if (!member) {
        console.log(`[DEBUG] Member record missing for user ${userId} in league ${leagueId}. Checking fallback...`);

        const [leagueAsCommissioner, userTeam] = await Promise.all([
          prisma.league.findFirst({
            where: { id: leagueId, commissionerId: userId }
          }),
          prisma.team.findFirst({
            where: { leagueId, ownerId: userId }
          })
        ]);

        if (leagueAsCommissioner || userTeam) {
          console.log(`[DEBUG] User ${userId} is commissioner or has team. Creating missing LeagueMember record.`);
          member = await prisma.leagueMember.create({
            data: {
              userId,
              leagueId,
              role: leagueAsCommissioner ? 'COMMISSIONER' : 'MEMBER'
            },
            include: {
              league: true
            }
          });
        }
      }

      if (!member) {
        socket.emit(SocketEvents.ERROR, {
          code: 'UNAUTHORIZED',
          message: 'You are not a member of this league',
        });
        return;
      }

      // Store user data on socket
      socket.data.userId = userId;
      socket.data.leagueId = leagueId;
      socket.data.teamId = teamId || await getTeamForUser(userId, leagueId) || undefined;
      socket.data.isCommissioner = member.league.commissionerId === userId;

      // Join the draft room
      const room = getRoomName(leagueId);
      await socket.join(room);

      // Get draft manager and send current state
      const manager = getDraftManager(leagueId);
      const state = await manager.getFullState();

      // Debug logging
      console.log(`[DEBUG] Sending state to ${userId}:`, {
        availablePlayers: state.availablePlayers.length,
        teams: state.draftOrder.length,
        status: state.status,
      });

      socket.emit(SocketEvents.STATE_SYNC, state);

      console.log(`User ${userId} joined draft room for league ${leagueId}`);
    } catch (error) {
      console.error('Error joining draft room:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'JOIN_FAILED',
        message: 'Failed to join draft room',
      });
    }
  });

  // -------------------------------------------------------------------------
  // LEAVE DRAFT ROOM
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.LEAVE_DRAFT_ROOM, async (payload) => {
    const { leagueId } = payload;
    const room = getRoomName(leagueId);
    await socket.leave(room);
    console.log(`User ${socket.data.userId} left draft room for league ${leagueId}`);
  });

  // -------------------------------------------------------------------------
  // DRAFT START (Commissioner only)
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.DRAFT_START, async (payload) => {
    const { leagueId } = payload;

    if (!socket.data.isCommissioner) {
      socket.emit(SocketEvents.ERROR, {
        code: 'UNAUTHORIZED',
        message: 'Only the commissioner can start the draft',
      });
      return;
    }

    try {
      const manager = getDraftManager(leagueId);
      await manager.startDraft();
    } catch (error) {
      console.error('Error starting draft:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'START_FAILED',
        message: error instanceof Error ? error.message : 'Failed to start draft',
      });
    }
  });

  // -------------------------------------------------------------------------
  // DRAFT PAUSE/RESUME (Commissioner only)
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.DRAFT_PAUSE, async (payload) => {
    const { leagueId, reason } = payload;

    if (!socket.data.isCommissioner) {
      socket.emit(SocketEvents.ERROR, {
        code: 'UNAUTHORIZED',
        message: 'Only the commissioner can pause the draft',
      });
      return;
    }

    const manager = getDraftManager(leagueId);
    await manager.pauseDraft(reason || 'Commissioner paused', socket.data.userId!);
  });

  socket.on(SocketEvents.DRAFT_RESUME, async (payload) => {
    const { leagueId } = payload;

    if (!socket.data.isCommissioner) {
      socket.emit(SocketEvents.ERROR, {
        code: 'UNAUTHORIZED',
        message: 'Only the commissioner can resume the draft',
      });
      return;
    }

    const manager = getDraftManager(leagueId);
    await manager.resumeDraft();
  });

  socket.on(SocketEvents.DRAFT_RESET, async (payload) => {
    const { leagueId } = payload;

    if (!socket.data.isCommissioner) {
      socket.emit(SocketEvents.ERROR, {
        code: 'UNAUTHORIZED',
        message: 'Only the commissioner can reset the draft',
      });
      return;
    }

    try {
      const manager = getDraftManager(leagueId);
      await manager.resetDraft();
    } catch (error: any) {
      console.error('Error resetting draft:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'RESET_FAILED',
        message: error.message || 'Failed to reset draft',
      });
    }
  });

  // -------------------------------------------------------------------------
  // PICK MADE
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.PICK_MADE, async (payload) => {
    const { leagueId, playerId, teamId } = payload;

    try {
      const manager = getDraftManager(leagueId);

      // Verify it's this team's turn (or commissioner forcing)
      const canPick = await manager.canTeamPick(teamId, socket.data.isCommissioner);
      if (!canPick) {
        socket.emit(SocketEvents.ERROR, {
          code: 'NOT_YOUR_TURN',
          message: 'It is not your turn to pick',
        });
        return;
      }

      await manager.makePick(teamId, playerId);
    } catch (error) {
      console.error('Error making pick:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'PICK_FAILED',
        message: error instanceof Error ? error.message : 'Failed to make pick',
      });
    }
  });

  // -------------------------------------------------------------------------
  // FORCE PICK (Commissioner only)
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.FORCE_PICK, async (payload) => {
    const { leagueId, playerId } = payload;

    if (!socket.data.isCommissioner) {
      socket.emit(SocketEvents.ERROR, {
        code: 'UNAUTHORIZED',
        message: 'Only the commissioner can force a pick',
      });
      return;
    }

    try {
      const manager = getDraftManager(leagueId);
      await manager.forcePick(playerId);
    } catch (error) {
      console.error('Error forcing pick:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'FORCE_PICK_FAILED',
        message: error instanceof Error ? error.message : 'Failed to force pick',
      });
    }
  });

  // -------------------------------------------------------------------------
  // UNDO LAST PICK (Commissioner only)
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.PICK_UNDONE, async (payload) => {
    const { leagueId } = payload;

    if (!socket.data.isCommissioner) {
      socket.emit(SocketEvents.ERROR, {
        code: 'UNAUTHORIZED',
        message: 'Only the commissioner can undo picks',
      });
      return;
    }

    try {
      const manager = getDraftManager(leagueId);
      await manager.undoLastPick();
    } catch (error) {
      console.error('Error undoing pick:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'UNDO_FAILED',
        message: error instanceof Error ? error.message : 'Failed to undo pick',
      });
    }
  });

  // -------------------------------------------------------------------------
  // ORDER UPDATED (Commissioner only)
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.ORDER_UPDATED, async (payload) => {
    const { leagueId, teamOrder } = payload;

    if (!socket.data.isCommissioner) {
      socket.emit(SocketEvents.ERROR, {
        code: 'UNAUTHORIZED',
        message: 'Only the commissioner can update the draft order',
      });
      return;
    }

    try {
      const manager = getDraftManager(leagueId);
      await manager.setDraftOrder(teamOrder, socket.data.userId!);
    } catch (error) {
      console.error('Error updating order:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'ORDER_UPDATE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to update order',
      });
    }
  });

  // -------------------------------------------------------------------------
  // TRADE OFFERED
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.TRADE_OFFERED, async (payload) => {
    const { leagueId, receiverTeamId, initiatorAssets, receiverAssets } = payload;

    try {
      const initiatorTeamId = socket.data.teamId;
      if (!initiatorTeamId) {
        socket.emit(SocketEvents.ERROR, {
          code: 'NO_TEAM',
          message: 'You do not have a team in this league',
        });
        return;
      }

      const trade = await tradeProcessor.createTrade({
        leagueId,
        initiatorTeamId,
        receiverTeamId,
        initiatorAssets,
        receiverAssets,
      });

      // Broadcast to both teams and commissioner
      const room = getRoomName(leagueId);
      io.to(room).emit(SocketEvents.TRADE_OFFERED, trade);
    } catch (error) {
      console.error('Error creating trade:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'TRADE_CREATE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to create trade',
      });
    }
  });

  // -------------------------------------------------------------------------
  // TRADE ACCEPTED - CRITICAL HANDLER
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.TRADE_ACCEPTED, async (payload) => {
    const { leagueId, tradeId } = payload;

    try {
      // Verify the user can accept this trade
      const trade = await prisma.trade.findUnique({
        where: { id: tradeId },
        include: {
          receiverTeam: true,
          initiatorTeam: true,
        },
      });

      if (!trade) {
        socket.emit(SocketEvents.ERROR, {
          code: 'TRADE_NOT_FOUND',
          message: 'Trade not found',
        });
        return;
      }

      // Only receiver can accept (or commissioner can force)
      const canAccept =
        trade.receiverTeam.ownerId === socket.data.userId ||
        socket.data.isCommissioner;

      if (!canAccept) {
        socket.emit(SocketEvents.ERROR, {
          code: 'UNAUTHORIZED',
          message: 'Only the receiving team can accept this trade',
        });
        return;
      }

      // Get draft manager to check if we need to pause
      const manager = getDraftManager(leagueId);
      const draftState = await manager.getCurrentState();

      // Determine if draft should be paused
      const shouldPause = draftState.status === 'IN_PROGRESS' &&
        await shouldPauseForTrade(leagueId, tradeId, draftState.currentTeamId);

      // Mark as processing
      io.to(getRoomName(leagueId)).emit(SocketEvents.TRADE_PROCESSING, {
        leagueId,
        tradeId,
      });

      // If we should pause, do it before processing
      if (shouldPause) {
        await manager.pauseDraft('Trade in progress', 'system');
      }

      // Process the trade atomically
      const result = await tradeProcessor.acceptTrade(tradeId, socket.data.isCommissioner);

      // Clear cached state so syncCurrentTeam reads fresh DB data
      // (the cache was populated earlier in this handler and is now stale)
      manager.clearStateCache();

      // Sync current team in case the current pick was traded
      const newTeamId = await manager.syncCurrentTeam();
      console.log(`[TRADE_ACCEPTED] syncCurrentTeam returned: ${newTeamId} (was: ${draftState.currentTeamId})`);

      // Get updated rosters for the teams involved
      const [initiatorRoster, receiverRoster] = await Promise.all([
        manager.getTeamRoster(result.initiatorTeam.id),
        manager.getTeamRoster(result.receiverTeam.id),
      ]);

      // Build the payload
      const acceptedPayload: TradeAcceptedPayload = {
        leagueId,
        tradeId,
        initiatorTeam: result.initiatorTeam,
        receiverTeam: result.receiverTeam,
        initiatorAssets: result.initiatorAssets,
        receiverAssets: result.receiverAssets,
        updatedDraftOrder: result.updatedPicks,
        teamRosterUpdates: {
          [result.initiatorTeam.id]: initiatorRoster,
          [result.receiverTeam.id]: receiverRoster,
        },
        draftPaused: shouldPause,
        pauseReason: shouldPause ? 'Trade completed - draft paused for review' : undefined,
        timestamp: new Date().toISOString(),
      };

      // Broadcast trade accepted
      io.to(getRoomName(leagueId)).emit(SocketEvents.TRADE_ACCEPTED, acceptedPayload);

      // Send full state sync to ensure all clients have accurate state
      // (especially currentTeamId if the pick was traded)
      const fullState = await manager.getFullState();
      io.to(getRoomName(leagueId)).emit(SocketEvents.STATE_SYNC, fullState);

      // Log the activity
      await prisma.draftActivityLog.create({
        data: {
          leagueId,
          activityType: 'TRADE_ACCEPTED',
          description: `Trade accepted between ${result.initiatorTeam.name} and ${result.receiverTeam.name}`,
          tradeId,
          triggeredById: socket.data.userId,
          metadata: ({
            initiatorAssets: result.initiatorAssets,
            receiverAssets: result.receiverAssets,
            draftPaused: shouldPause,
          } as any),
        },
      });

      console.log(`Trade ${tradeId} accepted and processed`);
    } catch (error) {
      console.error('Error accepting trade:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'TRADE_ACCEPT_FAILED',
        message: error instanceof Error ? error.message : 'Failed to accept trade',
      });
    }
  });

  // -------------------------------------------------------------------------
  // TRADE REJECTED
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.TRADE_REJECTED, async (payload) => {
    const { leagueId, tradeId } = payload;

    try {
      await tradeProcessor.rejectTrade(tradeId, socket.data.userId!);

      io.to(getRoomName(leagueId)).emit(SocketEvents.TRADE_REJECTED, {
        leagueId,
        tradeId,
        rejectedBy: 'receiver',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error rejecting trade:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'TRADE_REJECT_FAILED',
        message: error instanceof Error ? error.message : 'Failed to reject trade',
      });
    }
  });

  // -------------------------------------------------------------------------
  // TRADE CANCELLED
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.TRADE_CANCELLED, async (payload) => {
    const { leagueId, tradeId } = payload;

    try {
      await tradeProcessor.cancelTrade(tradeId, socket.data.userId!);

      io.to(getRoomName(leagueId)).emit(SocketEvents.TRADE_CANCELLED, {
        leagueId,
        tradeId,
        rejectedBy: 'initiator',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error cancelling trade:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'TRADE_CANCEL_FAILED',
        message: error instanceof Error ? error.message : 'Failed to cancel trade',
      });
    }
  });
  // -------------------------------------------------------------------------
  // QUEUE UPDATED
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.UPDATE_QUEUE, async (payload) => {
    const { leagueId, teamId, playerIds } = payload;

    try {
      // Verify the user owns this team (or is commissioner)
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { ownerId: true }
      });

      if (!team || (team.ownerId !== socket.data.userId && !socket.data.isCommissioner)) {
        socket.emit(SocketEvents.ERROR, {
          code: 'UNAUTHORIZED',
          message: 'You do not have permission to update this queue'
        });
        return;
      }

      const manager = getDraftManager(leagueId);
      await manager.updateQueue(teamId, playerIds);
    } catch (error) {
      console.error('Error updating queue:', error);
      socket.emit(SocketEvents.ERROR, {
        code: 'QUEUE_UPDATE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to update queue'
      });
    }
  });


  // -------------------------------------------------------------------------
  // DISCONNECT
  // -------------------------------------------------------------------------
  socket.on(SocketEvents.DISCONNECT, () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ============================================================================
// HELPER: Check if draft should pause for trade
// ============================================================================

async function shouldPauseForTrade(
  leagueId: string,
  tradeId: string,
  currentTeamId: string | null
): Promise<boolean> {
  // Get draft settings
  const settings = await prisma.draftSettings.findUnique({
    where: { leagueId },
  });

  if (!settings?.pauseOnTrade) {
    return false;
  }

  // Get trade to see if it involves current team or affects current pick
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: {
      assets: {
        include: {
          draftPick: true,
        },
      },
    },
  });

  if (!trade) return false;

  // Check if either team in the trade is currently on the clock
  if (
    trade.initiatorTeamId === currentTeamId ||
    trade.receiverTeamId === currentTeamId
  ) {
    return true;
  }

  // Check if any traded picks affect the current pick order
  const currentState = await prisma.draftState.findUnique({
    where: { leagueId },
  });

  if (!currentState) return false;

  // Check if any of the traded picks are upcoming
  for (const asset of trade.assets) {
    if (asset.draftPick && !asset.draftPick.isComplete) {
      // If the pick is close to the current pick, pause
      if (
        asset.draftPick.overallPickNumber &&
        currentState.currentPick &&
        asset.draftPick.overallPickNumber <= currentState.currentPick + 3
      ) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// EXPORTS
// ============================================================================

export { io, httpServer };

export function startSocketServer(port: number = Number(process.env.SOCKET_PORT) || 3002): void {
  httpServer.once('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is already in use. Attempting to use port ${port + 1}...`);
      startSocketServer(port + 1);
    } else {
      console.error('Socket.IO server error:', err);
    }
  });

  httpServer.listen(port, () => {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║                                                        ║`);
    console.log(`║   🏈 KeeperDraft Socket.IO Server                      ║`);
    console.log(`║                                                        ║`);
    console.log(`║   Server running on port ${port}                         ║`);
    console.log(`║                                                        ║`);
    console.log(`║   WebSocket URL: ws://localhost:${port}                  ║`);
    console.log(`║                                                        ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);
  });
}

// Cleanup on process exit
process.on('SIGTERM', () => {
  console.log('Shutting down Socket.IO server...');
  io.close();
  httpServer.close();
});
