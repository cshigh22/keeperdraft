// Socket.IO Server Setup
// Handles real-time draft communication and trade processing

import { createServer } from 'http';
import { Server, type Socket } from 'socket.io';
import type { Prisma } from '@prisma/client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  TradeAcceptedPayload,
} from '@/types/socket';
import { SocketEvents } from '@/types/socket';
import { prisma } from '@/lib/prisma';
import { verifySocketToken } from '@/lib/socket-token';
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

type DraftSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

const httpServer = createServer();

// Build allowed origins for production
const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://keeper-fawn.vercel.app',
].filter(Boolean);

const io: TypedServer = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? allowedOrigins
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
// AUTHENTICATION
// ============================================================================

// Nothing below this point may trust an identity supplied in an event payload.
// Every connection presents a token minted by the Next.js app from the user's
// session; the id it carries is the only identity this server recognises.
io.use(async (socket, next) => {
  try {
    const userId = await verifySocketToken(socket.handshake.auth?.token);

    if (!userId) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }

    socket.data.userId = userId;
    next();
  } catch (error) {
    console.error('Socket authentication failed:', error);
    next(new Error('AUTH_UNAVAILABLE'));
  }
});

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

function emitError(socket: DraftSocket, code: string, message: string): void {
  socket.emit(SocketEvents.ERROR, { code, message });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// A socket's privileges are scoped to the one league it joined. Without this the
// commissioner of any league could aim a commissioner-only event at another one.
function requireLeague(socket: DraftSocket, leagueId: string): boolean {
  if (socket.data.leagueId === leagueId) return true;
  emitError(socket, 'UNAUTHORIZED', 'You have not joined this league');
  return false;
}

// Emits UNAUTHORIZED and returns false when the socket isn't the commissioner
function requireCommissioner(socket: DraftSocket, leagueId: string, action: string): boolean {
  if (!requireLeague(socket, leagueId)) return false;
  if (socket.data.isCommissioner) return true;
  emitError(socket, 'UNAUTHORIZED', `Only the commissioner can ${action}`);
  return false;
}

// Team-scoped actions are allowed for the team's owner or the commissioner.
// leagueId is passed explicitly (rather than read off socket.data) because
// Prisma silently drops an `undefined` filter, which would widen the lookup.
async function canManageTeam(
  socket: DraftSocket,
  leagueId: string,
  teamId: string
): Promise<boolean> {
  const team = await prisma.team.findFirst({
    where: { id: teamId, leagueId },
    select: { ownerId: true },
  });
  return !!team && (team.ownerId === socket.data.userId || socket.data.isCommissioner);
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
// ROOM MEMBERSHIP HANDLERS
// ============================================================================

function registerRoomHandlers(socket: DraftSocket): void {
  socket.on(SocketEvents.JOIN_DRAFT_ROOM, async (payload) => {
    const { leagueId } = payload;
    const userId = socket.data.userId;

    try {
      // Verify user has access to this league
      let member = await prisma.leagueMember.findUnique({
        where: {
          userId_leagueId: { userId, leagueId },
        },
        include: {
          league: true,
        },
      });

      // FALLBACK: If member record is missing but user is commissioner or has a team,
      // create the membership record on the fly to prevent lockout
      if (!member) {
        const [leagueAsCommissioner, userTeam] = await Promise.all([
          prisma.league.findFirst({
            where: { id: leagueId, commissionerId: userId },
          }),
          prisma.team.findFirst({
            where: { leagueId, ownerId: userId },
          }),
        ]);

        if (leagueAsCommissioner || userTeam) {
          console.log(
            `[JOIN_DRAFT_ROOM] Creating missing LeagueMember record for user ${userId} in league ${leagueId}`
          );
          member = await prisma.leagueMember.create({
            data: {
              userId,
              leagueId,
              role: leagueAsCommissioner ? 'COMMISSIONER' : 'MEMBER',
            },
            include: {
              league: true,
            },
          });
        }
      }

      if (!member) {
        emitError(socket, 'UNAUTHORIZED', 'You are not a member of this league');
        return;
      }

      // Scope this socket to the league. The team is looked up rather than taken
      // from the payload so a client cannot act as a team it does not own.
      socket.data.leagueId = leagueId;
      socket.data.teamId = (await getTeamForUser(userId, leagueId)) || undefined;
      socket.data.isCommissioner = member.league.commissionerId === userId;

      await socket.join(getRoomName(leagueId));

      // Send current state to the newly joined client
      const state = await getDraftManager(leagueId).getFullState();
      socket.emit(SocketEvents.STATE_SYNC, state);

      console.log(`User ${userId} joined draft room for league ${leagueId}`);
    } catch (error) {
      console.error('Error joining draft room:', error);
      emitError(socket, 'JOIN_FAILED', 'Failed to join draft room');
    }
  });

  socket.on(SocketEvents.LEAVE_DRAFT_ROOM, async (payload) => {
    const { leagueId } = payload;
    await socket.leave(getRoomName(leagueId));

    // Drop the league scope with the room, so a stale commissioner flag cannot
    // outlive membership of the league it was granted for.
    if (socket.data.leagueId === leagueId) {
      socket.data.leagueId = undefined;
      socket.data.teamId = undefined;
      socket.data.isCommissioner = false;
    }

    console.log(`User ${socket.data.userId} left draft room for league ${leagueId}`);
  });
}

// ============================================================================
// DRAFT CONTROL HANDLERS
// ============================================================================

function registerDraftControlHandlers(socket: DraftSocket): void {
  socket.on(SocketEvents.DRAFT_START, async ({ leagueId }) => {
    if (!requireCommissioner(socket, leagueId, 'start the draft')) return;

    try {
      await getDraftManager(leagueId).startDraft();
    } catch (error) {
      console.error('Error starting draft:', error);
      emitError(socket, 'START_FAILED', errorMessage(error, 'Failed to start draft'));
    }
  });

  socket.on(SocketEvents.DRAFT_PAUSE, async ({ leagueId, reason }) => {
    if (!requireCommissioner(socket, leagueId, 'pause the draft')) return;

    try {
      await getDraftManager(leagueId).pauseDraft(
        reason || 'Commissioner paused',
        socket.data.userId!
      );
    } catch (error) {
      console.error('Error pausing draft:', error);
      emitError(socket, 'PAUSE_FAILED', errorMessage(error, 'Failed to pause draft'));
    }
  });

  socket.on(SocketEvents.DRAFT_RESUME, async ({ leagueId }) => {
    if (!requireCommissioner(socket, leagueId, 'resume the draft')) return;

    try {
      await getDraftManager(leagueId).resumeDraft();
    } catch (error) {
      console.error('Error resuming draft:', error);
      emitError(socket, 'RESUME_FAILED', errorMessage(error, 'Failed to resume draft'));
    }
  });

  socket.on(SocketEvents.DRAFT_RESET, async ({ leagueId }) => {
    if (!requireCommissioner(socket, leagueId, 'reset the draft')) return;

    try {
      await getDraftManager(leagueId).resetDraft();
    } catch (error) {
      console.error('Error resetting draft:', error);
      emitError(socket, 'RESET_FAILED', errorMessage(error, 'Failed to reset draft'));
    }
  });

  socket.on(SocketEvents.PICK_MADE, async ({ leagueId, playerId }) => {
    if (!requireLeague(socket, leagueId)) return;

    // Always the socket's own team. Picking for anyone else is FORCE_PICK,
    // which is commissioner-gated.
    const teamId = socket.data.teamId;
    if (!teamId) {
      emitError(socket, 'NO_TEAM', 'You do not have a team in this league');
      return;
    }

    try {
      await getDraftManager(leagueId).makePick(teamId, playerId, socket.data.isCommissioner);
    } catch (error) {
      console.error('Error making pick:', error);
      emitError(socket, 'PICK_FAILED', errorMessage(error, 'Failed to make pick'));
    }
  });

  socket.on(SocketEvents.FORCE_PICK, async ({ leagueId, playerId }) => {
    if (!requireCommissioner(socket, leagueId, 'force a pick')) return;

    try {
      await getDraftManager(leagueId).forcePick(playerId);
    } catch (error) {
      console.error('Error forcing pick:', error);
      emitError(socket, 'FORCE_PICK_FAILED', errorMessage(error, 'Failed to force pick'));
    }
  });

  socket.on(SocketEvents.PICK_UNDONE, async ({ leagueId }) => {
    if (!requireCommissioner(socket, leagueId, 'undo picks')) return;

    try {
      await getDraftManager(leagueId).undoLastPick();
    } catch (error) {
      console.error('Error undoing pick:', error);
      emitError(socket, 'UNDO_FAILED', errorMessage(error, 'Failed to undo pick'));
    }
  });

  socket.on(SocketEvents.EDIT_PICK, async ({ leagueId, pickId, playerId }) => {
    if (!requireCommissioner(socket, leagueId, 'edit completed picks')) return;

    try {
      await getDraftManager(leagueId).editCompletedPick(pickId, playerId, socket.data.userId!);
    } catch (error) {
      console.error('Error editing pick:', error);
      // P2002: the roster unique constraint lost a race with a concurrent add
      const message =
        (error as { code?: string })?.code === 'P2002'
          ? 'That player was just added to a roster by someone else'
          : errorMessage(error, 'Failed to edit pick');
      emitError(socket, 'EDIT_PICK_FAILED', message);
    }
  });

  socket.on(SocketEvents.ORDER_UPDATED, async ({ leagueId, teamOrder }) => {
    if (!requireCommissioner(socket, leagueId, 'update the draft order')) return;

    try {
      await getDraftManager(leagueId).setDraftOrder(teamOrder, socket.data.userId!);
    } catch (error) {
      console.error('Error updating order:', error);
      emitError(socket, 'ORDER_UPDATE_FAILED', errorMessage(error, 'Failed to update order'));
    }
  });
}

// ============================================================================
// TRADE HANDLERS
// ============================================================================

// Trade responses can arrive on the global socket, which has no joined league,
// so the room to broadcast into comes from the trade itself rather than from a
// client-supplied id that could point at another league. Both managers' private
// user rooms are included so outcomes reach them outside the draft room too.
async function getTradeBroadcastTargets(tradeId: string) {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: {
      leagueId: true,
      initiatorTeam: { select: { name: true, ownerId: true } },
      receiverTeam: { select: { name: true, ownerId: true } },
    },
  });
  if (!trade) return null;
  return {
    leagueId: trade.leagueId,
    initiatorTeam: trade.initiatorTeam,
    receiverTeam: trade.receiverTeam,
    ownerIds: [trade.initiatorTeam.ownerId, trade.receiverTeam.ownerId].filter(
      (id): id is string => !!id
    ),
  };
}

function registerTradeHandlers(socket: DraftSocket): void {
  socket.on(SocketEvents.TRADE_OFFERED, async (payload) => {
    const { leagueId, receiverTeamId, initiatorAssets, receiverAssets } = payload;

    if (!requireLeague(socket, leagueId)) return;

    try {
      const initiatorTeamId = socket.data.teamId;
      if (!initiatorTeamId) {
        emitError(socket, 'NO_TEAM', 'You do not have a team in this league');
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
      io.to(getRoomName(leagueId)).emit(SocketEvents.TRADE_OFFERED, trade);

      // ALSO emit to receiver directly for global notification
      if (trade.receiverTeam.ownerId) {
        io.to(`user:${trade.receiverTeam.ownerId}`).emit(SocketEvents.TRADE_OFFERED, trade);
      }
    } catch (error) {
      console.error('Error creating trade:', error);
      emitError(socket, 'TRADE_CREATE_FAILED', errorMessage(error, 'Failed to create trade'));
    }
  });

  socket.on(SocketEvents.TRADE_ACCEPTED, async ({ tradeId }) => {
    try {
      await handleTradeAccepted(socket, tradeId);
    } catch (error) {
      console.error('Error accepting trade:', error);
      emitError(socket, 'TRADE_ACCEPT_FAILED', errorMessage(error, 'Failed to accept trade'));
    }
  });

  // Commissioner composes a trade between any two teams; it executes
  // immediately with no acceptance step. Commissioner identity is verified
  // against the DB inside createCommissionerTrade, not socket.data (which is
  // only populated with isCommissioner after a draft-room join).
  socket.on(SocketEvents.COMMISSIONER_TRADE, async (payload) => {
    const { leagueId, teamAId, teamBId, teamAAssets, teamBAssets, notes } = payload;

    if (!requireLeague(socket, leagueId)) return;

    if (teamAId === teamBId) {
      emitError(socket, 'INVALID_TRADE', 'A trade needs two different teams');
      return;
    }
    if (teamAAssets.length === 0 && teamBAssets.length === 0) {
      emitError(socket, 'INVALID_TRADE', 'Select at least one player or pick to trade');
      return;
    }

    let tradeId: string | null = null;
    try {
      const offered = await tradeProcessor.createCommissionerTrade(
        {
          leagueId,
          initiatorTeamId: teamAId,
          receiverTeamId: teamBId,
          initiatorAssets: teamAAssets,
          receiverAssets: teamBAssets,
        },
        socket.data.userId,
        notes
      );
      tradeId = offered.tradeId;
      // Deliberately no TRADE_OFFERED emit — there is no pending offer to show.

      await finalizeTradeExecution(
        leagueId,
        offered.tradeId,
        true,
        socket.data.userId,
        { activityType: 'TRADE_FORCED' }
      );
    } catch (error) {
      // If acceptance failed after the row was created, cancel it so it never
      // lingers as a pending offer in state syncs.
      if (tradeId) {
        await prisma.trade
          .updateMany({
            where: { id: tradeId, status: 'PENDING' },
            data: {
              status: 'CANCELLED',
              respondedAt: new Date(),
              commissionerNotes: 'Commissioner trade failed during execution',
            },
          })
          .catch(() => {});
      }
      console.error('Error executing commissioner trade:', error);
      emitError(
        socket,
        'COMMISSIONER_TRADE_FAILED',
        errorMessage(error, 'Failed to execute trade')
      );
    }
  });

  socket.on(SocketEvents.TRADE_REJECTED, async ({ tradeId }) => {
    try {
      const targets = await getTradeBroadcastTargets(tradeId);
      if (!targets) {
        emitError(socket, 'TRADE_NOT_FOUND', 'Trade not found');
        return;
      }

      await tradeProcessor.rejectTrade(tradeId, socket.data.userId);

      const payload = {
        leagueId: targets.leagueId,
        tradeId,
        rejectedBy: 'receiver' as const,
        timestamp: new Date().toISOString(),
        initiatorTeamName: targets.initiatorTeam.name,
        receiverTeamName: targets.receiverTeam.name,
        initiatorOwnerId: targets.initiatorTeam.ownerId,
        receiverOwnerId: targets.receiverTeam.ownerId,
      };
      io.to(getRoomName(targets.leagueId)).emit(SocketEvents.TRADE_REJECTED, payload);
      for (const ownerId of targets.ownerIds) {
        io.to(`user:${ownerId}`).emit(SocketEvents.TRADE_REJECTED, payload);
      }
    } catch (error) {
      console.error('Error rejecting trade:', error);
      emitError(socket, 'TRADE_REJECT_FAILED', errorMessage(error, 'Failed to reject trade'));
    }
  });

  socket.on(SocketEvents.TRADE_CANCELLED, async ({ tradeId }) => {
    try {
      const targets = await getTradeBroadcastTargets(tradeId);
      if (!targets) {
        emitError(socket, 'TRADE_NOT_FOUND', 'Trade not found');
        return;
      }

      await tradeProcessor.cancelTrade(tradeId, socket.data.userId);

      const payload = {
        leagueId: targets.leagueId,
        tradeId,
        rejectedBy: 'initiator' as const,
        timestamp: new Date().toISOString(),
        initiatorTeamName: targets.initiatorTeam.name,
        receiverTeamName: targets.receiverTeam.name,
        initiatorOwnerId: targets.initiatorTeam.ownerId,
        receiverOwnerId: targets.receiverTeam.ownerId,
      };
      io.to(getRoomName(targets.leagueId)).emit(SocketEvents.TRADE_CANCELLED, payload);
      for (const ownerId of targets.ownerIds) {
        io.to(`user:${ownerId}`).emit(SocketEvents.TRADE_CANCELLED, payload);
      }
    } catch (error) {
      console.error('Error cancelling trade:', error);
      emitError(socket, 'TRADE_CANCEL_FAILED', errorMessage(error, 'Failed to cancel trade'));
    }
  });
}

// The critical path: validates, processes the trade atomically, then
// broadcasts the targeted trade events to every client.
async function handleTradeAccepted(socket: DraftSocket, tradeId: string): Promise<void> {
  const trade = await prisma.trade.findUnique({
    where: { id: tradeId },
    include: {
      receiverTeam: true,
      initiatorTeam: true,
      league: { select: { commissionerId: true } },
    },
  });

  if (!trade) {
    emitError(socket, 'TRADE_NOT_FOUND', 'Trade not found');
    return;
  }

  const leagueId = trade.leagueId;

  // Resolved against the trade's own league rather than socket.data, which is
  // only populated for sockets that joined a draft room.
  const isCommissioner = trade.league.commissionerId === socket.data.userId;
  const isReceiver = trade.receiverTeam.ownerId === socket.data.userId;

  // Only receiver can accept (or commissioner can force)
  if (!isReceiver && !isCommissioner) {
    emitError(socket, 'UNAUTHORIZED', 'Only the receiving team can accept this trade');
    return;
  }

  // A "force" is the commissioner accepting on another manager's behalf —
  // commissioners accepting their own incoming trades get no special treatment
  // (forced trades bypass the feasibility guard and are flagged on the record).
  const forcedByCommissioner = isCommissioner && !isReceiver;

  await finalizeTradeExecution(leagueId, tradeId, forcedByCommissioner, socket.data.userId, {
    activityType: 'TRADE_ACCEPTED',
  });

  console.log(`Trade ${tradeId} accepted and processed`);
}

// Shared execution tail for accepted and commissioner-executed trades:
// atomic swap, targeted broadcasts, and activity log. The draft is NOT
// paused — clients announce the completed trade instead, and syncCurrentTeam
// re-points the clock if the current pick changed owner. Returns the payload
// so callers can emit it to additional rooms.
async function finalizeTradeExecution(
  leagueId: string,
  tradeId: string,
  forcedByCommissioner: boolean,
  triggeredByUserId: string,
  log: { activityType: 'TRADE_ACCEPTED' | 'TRADE_FORCED' }
): Promise<TradeAcceptedPayload> {
  const manager = getDraftManager(leagueId);

  // Mark as processing
  io.to(getRoomName(leagueId)).emit(SocketEvents.TRADE_PROCESSING, {
    leagueId,
    tradeId,
  });

  // Process the trade atomically
  const result = await tradeProcessor.acceptTrade(tradeId, forcedByCommissioner);

  // Clear cached state so syncCurrentTeam reads fresh DB data
  // (the cache was populated earlier in this handler and is now stale)
  manager.clearStateCache();

  // Sync current team in case the current pick was traded
  await manager.syncCurrentTeam();

  // Get updated rosters for the teams involved
  const [initiatorRoster, receiverRoster] = await Promise.all([
    manager.getTeamRoster(result.initiatorTeam.id),
    manager.getTeamRoster(result.receiverTeam.id),
  ]);

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
    forcedByCommissioner: forcedByCommissioner || undefined,
    timestamp: new Date().toISOString(),
  };

  io.to(getRoomName(leagueId)).emit(SocketEvents.TRADE_ACCEPTED, acceptedPayload);

  // Both managers hear the outcome in their private rooms too, so a proposer
  // who is neither in the draft room nor online-at-the-moment still learns
  // their offer completed (their inbox/toast picks it up on next connect/view).
  for (const team of [acceptedPayload.initiatorTeam, acceptedPayload.receiverTeam]) {
    if (team.ownerId) {
      io.to(`user:${team.ownerId}`).emit(SocketEvents.TRADE_ACCEPTED, acceptedPayload);
    }
  }

  // Deliberately no STATE_SYNC here: the targeted events above carry
  // everything a trade changes (picks, both rosters, and — via
  // syncCurrentTeam's ON_THE_CLOCK — the clock). A full getFullState()
  // snapshot is not transactionally consistent with concurrently committing
  // picks, so broadcasting one here could overwrite a pick that landed while
  // the snapshot was being read, blanking its board cell on every client.

  const description =
    log.activityType === 'TRADE_FORCED'
      ? `Commissioner executed a trade between ${result.initiatorTeam.name} and ${result.receiverTeam.name}`
      : `Trade accepted between ${result.initiatorTeam.name} and ${result.receiverTeam.name}`;

  await prisma.draftActivityLog.create({
    data: {
      leagueId,
      activityType: log.activityType,
      description,
      tradeId,
      triggeredById: triggeredByUserId,
      metadata: {
        initiatorAssets: result.initiatorAssets,
        receiverAssets: result.receiverAssets,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return acceptedPayload;
}

// ============================================================================
// TEAM & QUEUE HANDLERS
// ============================================================================

function registerTeamHandlers(socket: DraftSocket): void {
  socket.on(SocketEvents.UPDATE_QUEUE, async ({ leagueId, teamId, playerIds }) => {
    if (!requireLeague(socket, leagueId)) return;

    try {
      if (!(await canManageTeam(socket, leagueId, teamId))) {
        emitError(socket, 'UNAUTHORIZED', 'You do not have permission to update this queue');
        return;
      }

      await getDraftManager(leagueId).updateQueue(teamId, playerIds);
    } catch (error) {
      console.error('Error updating queue:', error);
      emitError(socket, 'QUEUE_UPDATE_FAILED', errorMessage(error, 'Failed to update queue'));
    }
  });

  socket.on(SocketEvents.UPDATE_TEAM, async ({ leagueId, teamId, name }) => {
    if (!requireLeague(socket, leagueId)) return;

    try {
      if (!(await canManageTeam(socket, leagueId, teamId))) {
        emitError(socket, 'UNAUTHORIZED', 'You are not authorized to update this team');
        return;
      }

      const updatedTeam = await prisma.team.update({
        where: { id: teamId },
        data: { name },
      });

      // Broadcast to all team members in the league
      io.to(getRoomName(leagueId)).emit(SocketEvents.TEAM_UPDATED, {
        teamId,
        name: updatedTeam.name,
      });

      console.log(`Team ${teamId} updated to name: ${name}`);
    } catch (error) {
      console.error('Error updating team:', error);
      emitError(socket, 'UPDATE_FAILED', 'Failed to update team name');
    }
  });
}

// ============================================================================
// CONNECTION HANDLER
// ============================================================================

io.on(SocketEvents.CONNECTION, (socket) => {
  console.log(`Client connected: ${socket.id} (user ${socket.data.userId})`);

  // Private room for direct notifications (e.g. trade offers outside the draft).
  // Joined from the verified handshake identity, not on the client's say-so.
  socket.join(`user:${socket.data.userId}`);

  registerRoomHandlers(socket);
  registerDraftControlHandlers(socket);
  registerTradeHandlers(socket);
  registerTeamHandlers(socket);

  socket.on(SocketEvents.DISCONNECT, () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ============================================================================
// EXPORTS
// ============================================================================

export { io, httpServer };

export function startSocketServer(
  port: number = Number(process.env.PORT) || Number(process.env.SOCKET_PORT) || 3001
): void {
  httpServer.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is already in use. Attempting to use port ${port + 1}...`);
      startSocketServer(port + 1);
    } else {
      console.error('Socket.IO server error:', err);
    }
  });

  // Bind to 0.0.0.0 for Railway/Docker compatibility
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║                                                        ║`);
    console.log(`║   🏈 KeeperDraft Socket.IO Server                      ║`);
    console.log(`║                                                        ║`);
    console.log(`║   Server running on port ${port}                         ║`);
    console.log(`║   Bound to 0.0.0.0 (all interfaces)                    ║`);
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
