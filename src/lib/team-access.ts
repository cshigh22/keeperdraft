// Owner-or-commissioner authorization for acting on a team. Plain module,
// NOT 'use server' — exporting from a server-action file would expose this
// as a public POST endpoint.
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

export async function requireTeamAccess(teamId: string, leagueId: string) {
    const session = await auth();
    if (!session?.user?.id) throw new Error('Unauthorized');

    const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { ownerId: true, leagueId: true },
    });

    if (!team || team.leagueId !== leagueId) throw new Error('Team not found');

    const league = await prisma.league.findUnique({
        where: { id: leagueId },
        select: { commissionerId: true },
    });

    const isOwner = team.ownerId === session.user.id;
    const isCommissioner = league?.commissionerId === session.user.id;

    if (!isOwner && !isCommissioner) {
        throw new Error('Unauthorized to access this team');
    }

    return session;
}
