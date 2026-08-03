import { Trophy } from 'lucide-react';
import type { AuthMode } from '../types';

export function AuthHeadline({ mode }: { mode: AuthMode }) {
    return (
        <>
            <div
                className={`inline-flex items-center gap-2.5 [@media(max-height:519px)]:mb-[18px] ${
                    mode === 'invite' ? 'mb-[30px]' : 'mb-[34px]'
                }`}
            >
                <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[rgba(52,211,153,0.32)] bg-[rgba(16,185,129,0.22)]">
                    <Trophy className="h-4 w-4 text-emerald-300" strokeWidth={2} />
                </div>
                <span className="text-[15px] font-semibold tracking-[0.01em] text-white">
                    KeeperDraft
                </span>
            </div>

            {mode === 'invite' ? (
                <>
                    <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
                        League invitation
                    </p>
                    <h1 className="mb-4 text-[32px] font-extrabold leading-[1.06] tracking-[-0.032em] text-white sm:text-[38px] sm:leading-[1.04] md:text-[42px] lg:text-[46px] xl:text-[50px] [@media(max-height:519px)]:text-[30px]">
                        You&rsquo;re invited
                        <br className="hidden lg:inline" /> to a league
                    </h1>
                    <p className="mx-auto mb-[30px] max-w-[430px] text-[15px] leading-[23px] text-[rgba(209,250,229,0.7)] sm:text-[16.5px] sm:leading-[27px]">
                        Your commissioner set up a keeper league on KeeperDraft. Sign in to claim
                        your team and get draft-ready.
                    </p>
                </>
            ) : (
                <>
                    <h1 className="mb-[18px] text-[34px] font-extrabold leading-[1.06] tracking-[-0.035em] text-white sm:text-[40px] sm:leading-[1.02] md:text-[46px] lg:text-[52px] xl:text-[58px] [@media(max-height:519px)]:text-[30px]">
                        The live draft board
                        <br className="hidden lg:inline" /> for keeper leagues.
                    </h1>
                    <p className="mx-auto mb-10 max-w-[420px] text-[15px] leading-[23px] text-[rgba(209,250,229,0.7)] sm:text-[16.5px] sm:leading-[27px]">
                        Manage picks, keepers, and trades in real-time.
                    </p>
                </>
            )}
        </>
    );
}
