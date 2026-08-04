'use client';

import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { ErrorPayload } from '@/types/socket';

// Errors that mean the draft room itself is broken, where reloading or signing
// out are the only fixes. The draft room shows its blocking dialog for these;
// every other error is a failed action (blocked trade, refused pick, failed
// start) and belongs in this self-dismissing toast.
export const FATAL_ERROR_CODES = new Set(['CONN_ERROR', 'JOIN_FAILED', 'NO_TEAM', 'UNAUTHORIZED']);

interface SocketErrorToastProps {
    error: ErrorPayload | null;
    onDismiss: () => void;
    autoHideMs?: number;
}

export function SocketErrorToast({ error, onDismiss, autoHideMs = 6000 }: SocketErrorToastProps) {
    useEffect(() => {
        if (!error) return;
        const timer = setTimeout(onDismiss, autoHideMs);
        return () => clearTimeout(timer);
    }, [error, onDismiss, autoHideMs]);

    if (!error) return null;

    return (
        <div
            role="alert"
            className="fixed top-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-lg border border-destructive/30 bg-white px-4 py-3 shadow-lg"
        >
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" />
            <p className="flex-1 text-sm text-slate-700">{error.message}</p>
            <button
                onClick={onDismiss}
                aria-label="Dismiss"
                className="flex-none rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
