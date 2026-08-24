// Which PlayerRoster rows count as actually-rostered players.
//
// acquiredVia FREE_AGENT rows are pre-draft marketplace signals, not rostered
// players — EXCEPT when flagged isKeeper: keeper selection only flips the flag
// and deliberately preserves acquiredVia (KeeperService.saveKeepers), while
// Sleeper-imported and commissioner-added rosters are created as FREE_AGENT.
// Any query meaning "players on a roster" must use this filter; filtering on
// acquiredVia alone silently drops those keepers.
import type { Prisma } from '@prisma/client';

export const ROSTERED_PLAYER_WHERE: Pick<Prisma.PlayerRosterWhereInput, 'OR'> = {
  OR: [{ isKeeper: true }, { acquiredVia: { not: 'FREE_AGENT' } }],
};

// Same predicate for rows already in memory.
export function isRosteredEntry(entry: { isKeeper: boolean; acquiredVia: string }): boolean {
  return entry.isKeeper || entry.acquiredVia !== 'FREE_AGENT';
}
