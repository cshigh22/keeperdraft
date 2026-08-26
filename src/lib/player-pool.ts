// Which Player rows count as current-NFL players worth surfacing in any
// available-player list (draft pool, free agency).
//
// Sleeper marks both unsigned free agents AND never-flagged retirees as
// ACTIVE with no team, and its search_rank is popularity (it ranks retired
// legends above starters) — so a team-less player is admitted only when
// FantasyCalc ranked them (positionRank is only ever written by the rankings
// update). That lets signable free agents in and keeps retired ghosts out.
//
// This fragment owns the top-level OR key: callers merging it into a where
// clause must not supply their own OR.
import type { Prisma } from '@prisma/client';

export const NFL_RELEVANT_PLAYER_WHERE = {
  status: { in: ['ACTIVE', 'INJURED_RESERVE'] },
  OR: [{ nflTeam: { not: null } }, { positionRank: { not: null } }],
} satisfies Prisma.PlayerWhereInput;
