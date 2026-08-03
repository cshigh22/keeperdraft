import React from 'react';

// Full-bleed dark canvas: gradient, yard lines, two glows, one centred column.
// The column uses my-auto (not items-center on the root) so content taller than
// the viewport pushes the root instead of clipping at the top.
export function AuthCanvas({ children }: { children: React.ReactNode }) {
    return (
        <div
            className="relative flex min-h-[100dvh] justify-center overflow-hidden py-10"
            style={{
                background: 'linear-gradient(160deg, #022c22 0%, #064e3b 46%, #020617 100%)',
            }}
        >
            {/* Yard lines */}
            <div
                aria-hidden
                className="absolute inset-0 opacity-[0.05]"
                style={{
                    backgroundImage:
                        'repeating-linear-gradient(to right, #fff 0px, #fff 2px, transparent 2px, transparent 96px)',
                }}
            />
            {/* Top glow */}
            <div
                aria-hidden
                className="absolute -top-[180px] left-1/2 -ml-[320px] h-[520px] w-[640px] rounded-full bg-[rgba(16,185,129,0.16)] blur-[90px] [@media(max-height:519px)]:hidden"
            />
            {/* Bottom-right glow */}
            <div
                aria-hidden
                className="absolute -bottom-[220px] -right-[120px] h-[520px] w-[520px] rounded-full bg-[rgba(6,78,59,0.55)] blur-[90px]"
            />

            <div className="relative my-auto w-full px-6 text-center text-white md:w-[480px] md:px-0 lg:w-[520px] xl:w-[560px]">
                {children}
            </div>
        </div>
    );
}
