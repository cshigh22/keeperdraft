// Draft Timer Component
// Displays a countdown timer with visual urgency indicators

'use client';

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Pause } from 'lucide-react';

interface DraftTimerProps {
    secondsRemaining: number | null;
    isPaused: boolean;
    totalDuration?: number; // Total timer duration for progress calculation
    className?: string;
}

export function DraftTimer({
    secondsRemaining,
    isPaused,
    totalDuration = 90,
    className,
}: DraftTimerProps) {
    const [flash, setFlash] = useState(false);

    const seconds = secondsRemaining ?? 0;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const progress = totalDuration > 0 ? Math.max(0, Math.min(1, seconds / totalDuration)) : 0;

    // Urgency levels
    const isUrgent = seconds <= 10 && seconds > 0;
    const isWarning = seconds <= 30 && seconds > 10;
    const isExpired = seconds <= 0;

    // Flash effect for urgent countdown
    useEffect(() => {
        if (isUrgent && !isPaused) {
            const interval = setInterval(() => {
                setFlash((prev) => !prev);
            }, 500);
            return () => clearInterval(interval);
        }
        setFlash(false);
        return undefined;
    }, [isUrgent, isPaused]);

    // SVG circle dimensions
    const size = 52;
    const strokeWidth = 3;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference * (1 - progress);

    // Color based on urgency
    const getColor = () => {
        if (isPaused) return 'text-yellow-500';
        if (isExpired) return 'text-muted-foreground';
        if (isUrgent) return 'text-red-500';
        if (isWarning) return 'text-amber-500';
        return 'text-emerald-500';
    };

    const getStrokeColor = () => {
        if (isPaused) return 'stroke-yellow-400';
        if (isExpired) return 'stroke-muted';
        if (isUrgent) return 'stroke-red-500';
        if (isWarning) return 'stroke-amber-400';
        return 'stroke-emerald-500';
    };

    const getBgRingColor = () => {
        if (isPaused) return 'stroke-yellow-100';
        if (isExpired) return 'stroke-muted';
        if (isUrgent) return 'stroke-red-100';
        if (isWarning) return 'stroke-amber-100';
        return 'stroke-emerald-100';
    };

    if (secondsRemaining === null) {
        return null;
    }

    return (
        <div
            className={cn(
                'relative flex items-center gap-2 transition-all duration-300',
                isUrgent && !isPaused && flash && 'scale-105',
                className
            )}
        >
            {/* Circular progress */}
            <div className="relative" style={{ width: size, height: size }}>
                <svg
                    width={size}
                    height={size}
                    className="transform -rotate-90"
                    viewBox={`0 0 ${size} ${size}`}
                >
                    {/* Background ring */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        strokeWidth={strokeWidth}
                        className={cn('transition-colors duration-300', getBgRingColor())}
                    />
                    {/* Progress ring */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        className={cn(
                            'transition-all duration-1000 ease-linear',
                            getStrokeColor()
                        )}
                    />
                </svg>

                {/* Center content */}
                <div className="absolute inset-0 flex items-center justify-center">
                    {isPaused ? (
                        <Pause className={cn('w-4 h-4', getColor())} />
                    ) : (
                        <span
                            className={cn(
                                'text-xs font-bold tabular-nums leading-none',
                                getColor(),
                                isUrgent && !isPaused && 'animate-pulse'
                            )}
                        >
                            {minutes}:{secs.toString().padStart(2, '0')}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
