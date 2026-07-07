'use client';

import React, { useState, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Trophy, Loader2, AlertCircle, Timer, ShieldCheck, ArrowLeftRight, Mail } from 'lucide-react';

const FEATURES = [
  {
    icon: Timer,
    title: 'Live draft room',
    description: 'Real-time draft board with pick timers, queues, and auto-pick.',
  },
  {
    icon: ShieldCheck,
    title: 'Keeper management',
    description: 'Lock in your keepers before draft night — the board adjusts itself.',
  },
  {
    icon: ArrowLeftRight,
    title: 'Trades that just work',
    description: 'Swap players and picks any time, even mid-draft.',
  },
];

function LoginContent() {
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const callbackUrl = searchParams.get('callbackUrl') || '/leagues';
  const isInvite = callbackUrl.startsWith('/join/');

  const errorMessages: Record<string, string> = {
    OAuthAccountNotLinked: 'This email is already associated with another account. Please sign in with the original provider.',
    OAuthCallback: 'There was a problem with the Google sign-in. Please try again.',
    OAuthCreateAccount: 'Could not create your account. Please try again.',
    Callback: 'There was a problem signing you in. Please try again.',
    Default: 'An unexpected error occurred. Please try again.',
  };

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      await signIn('google', { callbackUrl });
    } catch (error) {
      console.error("Login error:", error);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Hero panel */}
      <div className="relative overflow-hidden bg-gradient-to-br from-emerald-950 via-emerald-900 to-slate-950 text-white flex flex-col justify-center px-8 py-12 lg:px-16">
        {/* Yard lines */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to right, white 0px, white 2px, transparent 2px, transparent 96px)',
          }}
        />
        {/* Glow */}
        <div
          aria-hidden
          className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-emerald-500/20 blur-3xl"
        />

        <div className="relative max-w-lg mx-auto lg:mx-0">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center">
              <Trophy className="w-6 h-6 text-emerald-300" />
            </div>
            <span className="text-2xl font-bold tracking-tight">KeeperDraft</span>
          </div>

          <h1 className="text-4xl lg:text-5xl font-bold tracking-tight leading-tight mb-4">
            {isInvite ? (
              <>You&apos;re invited to a&nbsp;league</>
            ) : (
              <>Draft night,<br />done right.</>
            )}
          </h1>
          <p className="text-lg text-emerald-100/80 mb-10">
            {isInvite
              ? 'Your commissioner set up a keeper league on KeeperDraft. Sign in to claim your team and get draft-ready.'
              : 'Run your keeper league’s draft live — picks, keepers, and trades in one room, no spreadsheets required.'}
          </p>

          <div className="hidden sm:flex flex-col gap-5">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <feature.icon className="w-5 h-5 text-emerald-300" />
                </div>
                <div>
                  <p className="font-semibold">{feature.title}</p>
                  <p className="text-sm text-emerald-100/70">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Auth panel */}
      <div className="flex items-center justify-center p-6 lg:p-12 bg-gradient-to-b from-background to-muted">
        <Card className="w-full max-w-md border-0 shadow-none lg:border lg:shadow-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold tracking-tight">
              {isInvite ? 'Claim your team' : 'Sign in'}
            </CardTitle>
            <CardDescription className="text-base">
              {isInvite
                ? 'One tap with Google and you’re on the roster.'
                : 'Continue with Google to access your leagues.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <p>{errorMessages[error] || errorMessages.Default}</p>
              </div>
            )}
            <Button
              variant="outline"
              className="w-full py-7 text-lg font-semibold border-2 hover:bg-primary/5 hover:border-primary/50 transition-all duration-300"
              onClick={handleGoogleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-3 h-6 w-6 animate-spin text-primary" />
              ) : (
                <svg className="mr-3 h-6 w-6" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              )}
              Continue with Google
            </Button>

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              <p>We only use your Google account to sign you in.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
      <LoginContent />
    </Suspense>
  );
}
