'use server';

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function updateTeamName(formData: FormData) {
    const session = await auth();
    if (!session?.user?.id) {
        throw new Error("Unauthorized");
    }

    const teamId = formData.get('teamId') as string;
    const leagueId = formData.get('leagueId') as string;
    const name = formData.get('name') as string;

    if (!teamId || !name) {
        throw new Error("Missing team ID or name");
    }

    // Verify ownership or commissioner
    const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { ownerId: true, leagueId: true },
    });

    if (!team) {
        throw new Error("Team not found");
    }

    const league = await prisma.league.findUnique({
        where: { id: team.leagueId },
        select: { commissionerId: true },
    });

    const isOwner = team.ownerId === session.user.id;
    const isCommissioner = league?.commissionerId === session.user.id;

    if (!isOwner && !isCommissioner) {
        throw new Error("Unauthorized to update this team");
    }

    // Update the database
    await prisma.team.update({
        where: { id: teamId },
        data: { name },
    });

    // Revalidate paths for real-time updates on server components
    revalidatePath(`/leagues/${team.leagueId}`);
    revalidatePath(`/leagues/${team.leagueId}/`);
    revalidatePath(`/draft?leagueId=${team.leagueId}`);

    return { success: true };
}
