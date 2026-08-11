import { Wrench } from 'lucide-react';
import { signInWithDevLogin } from '../actions';

// Seeded by `npm run db:seed` (prisma/seed.ts, development branch).
const DEMO_USERS = [
    { email: 'commissioner@demo.com', label: 'Demo Commissioner' },
    { email: 'player1@demo.com', label: 'Demo Player 1' },
];

// Rendered only when devLoginEnabled (see src/auth.ts) — never in production.
export function DevLoginPanel({ callbackUrl }: { callbackUrl: string }) {
    return (
        <div className="glass-card mx-auto mt-4 max-w-[420px] rounded-[14px] border border-dashed border-amber-400/40 p-4 sm:rounded-2xl">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300/80">
                <Wrench className="h-3.5 w-3.5" strokeWidth={2} />
                Dev sign-in — local only
            </p>
            <div className="flex gap-2">
                {DEMO_USERS.map((user) => (
                    <form key={user.email} action={signInWithDevLogin} className="flex-1">
                        <input type="hidden" name="callbackUrl" value={callbackUrl} />
                        <input type="hidden" name="email" value={user.email} />
                        <button
                            type="submit"
                            className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
                        >
                            {user.label}
                        </button>
                    </form>
                ))}
            </div>
        </div>
    );
}
