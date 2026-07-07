// Shared player-rank constants and formatting

/** Sentinel rank for players with no ranking data; sorts them to the bottom. */
export const UNRANKED_RANK = 9999;

/** Renders a rank for display, hiding the unranked sentinel. */
export function formatRank(rank: number | null | undefined): string {
  if (!rank || rank >= UNRANKED_RANK) return '—';
  return String(rank);
}
