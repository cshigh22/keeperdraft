import { ArrowLeftRight, ShieldCheck, Timer, type LucideIcon } from 'lucide-react';

interface Feature {
    id: string;
    icon: LucideIcon;
    title: string;
}

const FEATURES: Feature[] = [
    { id: 'draft-room', icon: Timer, title: 'Live draft room' },
    { id: 'keepers', icon: ShieldCheck, title: 'Keeper management' },
    { id: 'trades', icon: ArrowLeftRight, title: 'Trades that just work' },
];

// ≥640px: 3-up grid whose 1px gaps over the translucent container background
// draw the internal dividers. <640px: stacked rows divided by hairlines.
export function FeatureStrip() {
    return (
        <div className="mt-11 divide-y divide-white/10 border-y border-white/10 sm:grid sm:grid-cols-3 sm:gap-px sm:divide-y-0 sm:bg-white/10 [@media(max-height:519px)]:hidden">
            {FEATURES.map((feature) => (
                <div
                    key={feature.id}
                    className="flex items-center gap-3 py-3.5 text-left sm:flex-col sm:justify-center sm:gap-0 sm:px-3.5 sm:py-[18px] sm:text-center"
                >
                    <feature.icon
                        className="h-4 w-4 flex-none text-emerald-400 sm:mb-2"
                        strokeWidth={2}
                    />
                    <p className="text-[12.5px] font-semibold leading-[17px] text-white/90">
                        {feature.title}
                    </p>
                </div>
            ))}
        </div>
    );
}
