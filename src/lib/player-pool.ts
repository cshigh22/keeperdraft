// Which Player rows count as current-NFL players worth surfacing in any
// available-player list (draft pool, free agency).
//
// Sleeper's status field is unreliable at the edges: it marks both unsigned
// free agents AND never-flagged retirees as ACTIVE with no team, and some
// injured players land on INACTIVE instead of INJURED_RESERVE (e.g. an IR
// stint recorded as "Inactive"). Its search_rank is popularity, ranking
// retired legends above starters. So the admission rule is:
//
//   - on a current NFL roster with a plausible status, OR
//   - FantasyCalc-ranked (positionRank is only ever written by the rankings
//     update, and FantasyCalc doesn't rank retired ghosts) — this overrides
//     any Sleeper status quirk.
//
// This fragment owns the top-level OR key: callers merging it into a where
// clause must not supply their own OR.
import type { Prisma } from '@prisma/client';

export const NFL_RELEVANT_PLAYER_WHERE = {
  OR: [
    { status: { in: ['ACTIVE', 'INJURED_RESERVE'] }, nflTeam: { not: null } },
    { positionRank: { not: null } },
  ],
} satisfies Prisma.PlayerWhereInput;
