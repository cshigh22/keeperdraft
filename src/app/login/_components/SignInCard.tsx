import { Lock } from 'lucide-react';
import { signInWithGoogle } from '../actions';
import { AuthErrorBanner } from './AuthErrorBanner';
import { GoogleButton } from './GoogleButton';
import type { AuthMode } from '../types';

interface SignInCardProps {
    mode: AuthMode;
    callbackUrl: string;
    error?: string;
}

export function SignInCard({ mode, callbackUrl, error }: SignInCardProps) {
    const invite = mode === 'invite';

    return (
        <div
            className={`glass-card mx-auto max-w-[420px] rounded-[14px] p-[22px] sm:rounded-2xl ${
                invite ? 'sm:px-[26px] sm:pb-[26px] sm:pt-6' : 'sm:p-[26px]'
            }`}
        >
            {invite && (
                <>
                    <h2 className="mb-1.5 text-[22px] font-bold leading-[1.15] tracking-[-0.02em] text-white">
                        Claim your team
                    </h2>
                    <p className="mb-5 text-sm leading-5 text-[rgba(209,250,229,0.65)]">
                        One tap with Google and you&rsquo;re on the roster.
                    </p>
                </>
            )}

            {error && <AuthErrorBanner error={error} />}

            <form action={signInWithGoogle}>
                <input type="hidden" name="callbackUrl" value={callbackUrl} />
                <GoogleButton />
            </form>

            <div
                className={`flex justify-center gap-[7px] text-[12.5px] leading-[18px] text-[rgba(209,250,229,0.6)] ${
                    invite ? 'mt-[13px] items-start text-left' : 'mt-3.5 items-center'
                }`}
            >
                <Lock
                    className={`h-[13px] w-[13px] ${invite ? 'mt-px flex-none' : ''}`}
                    strokeWidth={2}
                />
                <p>
                    We only use your Google account to sign you in.
                    {invite && (
                        <> Your invite is saved &mdash; you&rsquo;ll land straight in the league.</>
                    )}
                </p>
            </div>
        </div>
    );
}
