import { CalendarDays, Users } from 'lucide-react';
import type { InviteSummary as InviteSummaryData } from '../types';

function initials(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]!.toUpperCase())
        .join('');
}

export function InviteSummary({ summary }: { summary: InviteSummaryData }) {
    return (
        <div className="mx-auto mb-[18px] max-w-[420px] rounded-[14px] border border-[rgba(255,255,255,0.13)] bg-white/[0.04] px-[18px] py-4 text-left">
            <div className="flex items-center gap-3 border-b border-white/10 pb-3.5">
                {summary.commissionerImage ? (
                    // Plain <img>: Google avatar hosts aren't in next.config remotePatterns,
                    // and a 36px circle gains nothing from next/image.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={summary.commissionerImage}
                        alt=""
                        className="h-9 w-9 flex-none rounded-full object-cover"
                    />
                ) : (
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/[0.08] text-[13px] font-semibold text-[rgba(209,250,229,0.85)]">
                        {summary.commissionerName ? initials(summary.commissionerName) : '?'}
                    </div>
                )}
                <div>
                    <p className="mb-[3px] text-[14.5px] font-semibold leading-[19px] text-white">
                        {summary.leagueName}
                    </p>
                    {summary.commissionerName && (
                        <p className="text-xs leading-4 text-[rgba(209,250,229,0.55)]">
                            Commissioned by {summary.commissionerName}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex gap-6 pt-[13px]">
                <div className="flex items-center gap-[7px]">
                    <Users className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2} />
                    <span className="text-xs text-[rgba(209,250,229,0.72)]">
                        {summary.teamCount} teams
                    </span>
                </div>
                {summary.draftAt && (
                    <div className="flex items-center gap-[7px]">
                        <CalendarDays className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2} />
                        <span className="text-xs text-[rgba(209,250,229,0.72)]">
                            Drafts {summary.draftAt}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
