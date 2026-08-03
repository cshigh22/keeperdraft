import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { joinLeague } from '@/server/actions/league';

function InviteProblem({ title, message }: { title: string; message: string }) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="max-w-md w-full border-destructive/50">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-destructive">
                        <AlertCircle className="w-6 h-6" />
                        {title}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-muted-foreground">{message}</p>
                    <Link href="/leagues" className="block">
                        <Button className="w-full">Back to Leagues</Button>
                    </Link>
                </CardContent>
            </Card>
        </div>
    );
}

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
            <InviteProblem
                title="Invalid Invite"
                message="This invite link is invalid or has expired."
            />
        );
    }

    // Check if user is already a member
    const existingMember = await prisma.leagueMember.findUnique({
        where: { userId_leagueId: { userId, leagueId: invite.leagueId } },
    });

    if (existingMember) {
        redirect(`/leagues/${invite.leagueId}`);
    }

    if (invite.usedAt) {
        return (
            <InviteProblem
                title="Invite Already Used"
                message="This invite link has already been claimed. Ask the commissioner for a new one."
            />
        );
    }

    const emptyTeam = await prisma.team.findFirst({
        where: {
            leagueId: invite.leagueId,
            ownerId: null,
        },
        orderBy: { draftPosition: 'asc' },
    });

    if (!emptyTeam) {
        return (
            <InviteProblem
                title="League Full"
                message="This league is already full. No open team slots are available."
            />
        );
    }

    // Joining happens on submit, never on page load — otherwise simply loading
    // this URL would spend the invite and add the viewer to the league.
    const confirmJoin = joinLeague.bind(null, params.token);

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="max-w-md w-full">
                <CardHeader>
                    <CardTitle>Join {invite.league.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-muted-foreground">
                        You&apos;ve been invited to join{' '}
                        <span className="font-medium text-foreground">{invite.league.name}</span> for
                        the {invite.league.season} season. You&apos;ll take over an open team slot.
                    </p>
                    <form action={confirmJoin}>
                        <Button type="submit" className="w-full">
                            Join League
                        </Button>
                    </form>
                    <Link href="/leagues" className="block">
                        <Button variant="outline" className="w-full">
                            Cancel
                        </Button>
                    </Link>
                </CardContent>
            </Card>
        </div>
    );
}
