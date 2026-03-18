'use client';

import { SessionProvider } from 'next-auth/react';
import { GlobalTradeNotifier } from '@/components/notifications/GlobalTradeNotifier';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            {children}
            <GlobalTradeNotifier />
        </SessionProvider>
    );
}
