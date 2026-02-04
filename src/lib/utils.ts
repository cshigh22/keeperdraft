import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes with clsx
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format seconds to MM:SS display
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 */
export function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0] || 'th');
}

/**
 * Format a pick number to round and pick (e.g., "Round 3, Pick 5")
 */
export function formatPickNumber(overall: number, teamsCount: number): string {
  const round = Math.ceil(overall / teamsCount);
  const pick = ((overall - 1) % teamsCount) + 1;
  return `Round ${round}, Pick ${pick}`;
}

/**
 * Calculate overall pick number from round and pick
 */
export function calculateOverallPick(
  round: number,
  pickInRound: number,
  teamsCount: number,
  draftType: 'SNAKE' | 'LINEAR' = 'SNAKE'
): number {
  if (draftType === 'LINEAR') {
    return (round - 1) * teamsCount + pickInRound;
  }
  
  // Snake draft
  const isReversedRound = round % 2 === 0;
  const actualPickInRound = isReversedRound 
    ? teamsCount - pickInRound + 1 
    : pickInRound;
  
  return (round - 1) * teamsCount + actualPickInRound;
}

/**
 * Get position color for styling
 */
export function getPositionColor(position: string): string {
  const colors: Record<string, string> = {
    QB: 'bg-red-500',
    RB: 'bg-green-500',
    WR: 'bg-blue-500',
    TE: 'bg-orange-500',
    K: 'bg-purple-500',
    DEF: 'bg-gray-500',
  };
  return colors[position] || 'bg-gray-400';
}

/**
 * Get position text color for styling
 */
export function getPositionTextColor(position: string): string {
  const colors: Record<string, string> = {
    QB: 'text-red-600',
    RB: 'text-green-600',
    WR: 'text-blue-600',
    TE: 'text-orange-600',
    K: 'text-purple-600',
    DEF: 'text-gray-600',
  };
  return colors[position] || 'text-gray-500';
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Sleep utility for async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
