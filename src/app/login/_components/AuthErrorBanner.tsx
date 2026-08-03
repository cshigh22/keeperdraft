import { AlertCircle } from 'lucide-react';

const errorMessages: Record<string, string> = {
    OAuthAccountNotLinked:
        'This email is already associated with another account. Please sign in with the original provider.',
    OAuthCallback: 'There was a problem with the Google sign-in. Please try again.',
    OAuthCreateAccount: 'Could not create your account. Please try again.',
    Callback: 'There was a problem signing you in. Please try again.',
    Default: 'An unexpected error occurred. Please try again.',
};

export function AuthErrorBanner({ error }: { error: string }) {
    return (
        <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] px-3 py-2.5"
        >
            <AlertCircle className="mt-px h-[15px] w-[15px] flex-none text-red-400" strokeWidth={2} />
            <p className="text-left text-[13px] leading-[19px] text-red-200">
                {errorMessages[error] ?? errorMessages.Default}
            </p>
        </div>
    );
}
