import { prisma } from '@/lib/prisma';
import { AuthCanvas } from './_components/AuthCanvas';
import { AuthHeadline } from './_components/AuthHeadline';
import { FeatureStrip } from './_components/FeatureStrip';
import { InviteSummary } from './_components/InviteSummary';
import { SignInCard } from './_components/SignInCard';
import { safeCallbackUrl } from './safe-callback-url';
import type { AuthMode, InviteSummary as InviteSummaryData } from './types';

interface LoginPageProps {
    searchParams: { callbackUrl?: string; error?: string };
}

const draftDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

async function getInviteSummary(token: string): Promise<InviteSummaryData | null> {
    const invite = await prisma.leagueInvite.findUnique({
        where: { token },
        include: {
            league: {
                include: {
                    commissioner: { select: { name: true, image: true, avatarUrl: true } },
                    teams: { select: { id: true } },
                    draftSettings: { select: { scheduledStartTime: true } },
                },
            },
        },
    });

    if (!invite || invite.usedAt || invite.expiresAt < new Date()) return null;

    const scheduledStart = invite.league.draftSettings?.scheduledStartTime ?? null;

    return {
        leagueId: invite.leagueId,
        leagueName: invite.league.name,
        commissionerName: invite.league.commissioner.name,
        commissionerImage:
            invite.league.commissioner.image ?? invite.league.commissioner.avatarUrl ?? null,
        teamCount: invite.league.teams.length,
        draftAt: scheduledStart ? draftDateFormat.format(scheduledStart) : null,
    };
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
    const callbackUrl = safeCallbackUrl(searchParams.callbackUrl);
    const token = callbackUrl.startsWith('/join/')
        ? callbackUrl.slice('/join/'.length)
        : null;

    // An invalid, used, or expired token falls back to plain sign-in copy rather
    // than advertising a league that can't be joined. /join/[token] still owns
    // the post-sign-in error screens.
    const summary = token ? await getInviteSummary(token) : null;
    const mode: AuthMode = summary ? 'invite' : 'signin';

    return (
        <AuthCanvas>
            <AuthHeadline mode={mode} />
            {summary && <InviteSummary summary={summary} />}
            <SignInCard mode={mode} callbackUrl={callbackUrl} error={searchParams.error} />
            {mode === 'signin' && <FeatureStrip />}
        </AuthCanvas>
    );
}
