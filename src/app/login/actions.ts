'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';
import { safeCallbackUrl } from './safe-callback-url';

export async function signInWithGoogle(formData: FormData) {
    const redirectTo = safeCallbackUrl(formData.get('callbackUrl'));

    try {
        await signIn('google', { redirectTo });
    } catch (error) {
        if (error instanceof AuthError) {
            const params = new URLSearchParams({
                error: error.type,
                callbackUrl: redirectTo,
            });
            redirect(`/login?${params.toString()}`);
        }
        throw error;
    }
}
