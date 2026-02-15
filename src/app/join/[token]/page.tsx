import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default async function JoinPage({ params }: { params: { token: string } }) {
    const session = await auth();
    if (!session?.user?.id) {
        redirect(`/login?callbackUrl=/join/${params.token}`);
    }

    const userId = session.user.id;

    const invite = await prisma.leagueInvite.findUnique({
        where: { token: params.token },
        include: { league: true },
    });

    if (!invite || invite.expiresAt < new Date()) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <Card className="max-w-md w-full border-destructive/50">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-destructive">
                            <AlertCircle className="w-6 h-6" />
                            Invalid Invite
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-muted-foreground">
                            This invite link is invalid or has expired.
                        </p>
                        <Link href="/leagues" className="block">
                            <Button className="w-full">Back to Leagues</Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Check if user is already a member
    const existingMember = await prisma.leagueMember.findUnique({
        where: { userId_leagueId: { userId, leagueId: invite.leagueId } },
    });

    if (existingMember) {
        redirect(`/leagues/${invite.leagueId}`);
    }

    // Find first empty team
    const emptyTeam = await prisma.team.findFirst({
        where: {
            leagueId: invite.leagueId,
            ownerId: null,
        },
        orderBy: { draftPosition: 'asc' },
    });

    if (!emptyTeam) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <Card className="max-w-md w-full border-destructive/50">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-destructive">
                            <AlertCircle className="w-6 h-6" />
                            League Full
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-muted-foreground">
                            This league is already full. No open team slots are available.
                        </p>
                        <Link href="/leagues" className="block">
                            <Button className="w-full">Back to Leagues</Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Join the league
    await prisma.$transaction([
        prisma.leagueMember.create({
            data: {
                userId,
                leagueId: invite.leagueId,
                role: 'MEMBER',
            },
        }),
        prisma.team.update({
            where: { id: emptyTeam.id },
            data: {
                ownerId: userId,
                name: `${session.user.name}'s Team`,
            },
        }),
    ]);

    redirect(`/leagues/${invite.leagueId}`);
}
