export type AuthMode = 'signin' | 'invite';

export interface InviteSummary {
    leagueId: string;
    leagueName: string;
    commissionerName: string | null;
    commissionerImage: string | null;
    teamCount: number;
    draftAt: string | null;
}
