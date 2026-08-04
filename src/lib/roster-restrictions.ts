// Roster position restriction logic, shared by the draft server (auto-pick and
// pick validation in DraftStateManager) and the draft-room UI (disabling
// restricted players in PlayerPool). Pure — no DB or React dependencies.

export const CORE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
export type CorePosition = (typeof CORE_POSITIONS)[number];

// Fungible starter slots accept several positions; fill order matters and must
// stay stable (RB→WR→TE, then QB→RB→WR→TE) for restriction math to be deterministic.
const FLEX_ELIGIBLE: readonly CorePosition[] = ['RB', 'WR', 'TE'];
const SUPERFLEX_ELIGIBLE: readonly CorePosition[] = ['QB', 'RB', 'WR', 'TE'];

export interface RosterSlotSettings {
  qbCount: number;
  rbCount: number;
  wrCount: number;
  teCount: number;
  flexCount: number;
  superflexCount: number;
  kCount: number;
  defCount: number;
  benchCount: number;
}

// Legacy data sources use DST for team defenses; the app standardizes on DEF.
export function normalizePosition(position: string): string {
  return position === 'DST' ? 'DEF' : position;
}

function isCorePosition(position: string): position is CorePosition {
  return (CORE_POSITIONS as readonly string[]).includes(position);
}

export function totalRosterSlots(slots: RosterSlotSettings): number {
  return (
    (slots.qbCount || 0) +
    (slots.rbCount || 0) +
    (slots.wrCount || 0) +
    (slots.teCount || 0) +
    (slots.flexCount || 0) +
    (slots.superflexCount || 0) +
    (slots.kCount || 0) +
    (slots.defCount || 0) +
    (slots.benchCount || 0)
  );
}

// Shared roster/slot arithmetic behind position restrictions and trade
// feasibility: which starting slots are still empty once every rostered
// player (including overflow absorbed into FLEX/SUPERFLEX) is placed.
export interface RosterCoverage {
  // Core-position players on the roster
  rosterCount: number;
  // Dedicated slots still empty, per position
  unfilled: Record<CorePosition, number>;
  unfilledFlex: number;
  unfilledSuperflex: number;
  dedicatedUnfilled: number;
  totalUnfilledStarters: number;
  // Overflow players consuming bench spots after fungible slots absorbed them
  benchUsed: number;
}

export function analyzeRosterCoverage(
  rosterPositions: readonly string[],
  slots: RosterSlotSettings
): RosterCoverage {
  const rosterCounts: Record<CorePosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
  for (const raw of rosterPositions) {
    const position = normalizePosition(raw);
    if (isCorePosition(position)) {
      rosterCounts[position]++;
    }
  }

  const slotCounts: Record<CorePosition, number> = {
    QB: slots.qbCount || 0,
    RB: slots.rbCount || 0,
    WR: slots.wrCount || 0,
    TE: slots.teCount || 0,
    K: slots.kCount || 0,
    DEF: slots.defCount || 0,
  };

  // Split each position into unfilled dedicated slots vs. overflow players
  const unfilled = {} as Record<CorePosition, number>;
  const overflow = {} as Record<CorePosition, number>;
  for (const position of CORE_POSITIONS) {
    unfilled[position] = Math.max(0, slotCounts[position] - rosterCounts[position]);
    overflow[position] = Math.max(0, rosterCounts[position] - slotCounts[position]);
  }

  // Overflow players fill fungible slots (FLEX first, then SUPERFLEX);
  // returns the number of fungible slots still unfilled.
  const fillFungibleSlots = (slotCount: number, eligible: readonly CorePosition[]): number => {
    let unfilledSlots = slotCount;
    for (const position of eligible) {
      const used = Math.min(unfilledSlots, overflow[position]);
      overflow[position] -= used;
      unfilledSlots -= used;
    }
    return unfilledSlots;
  };

  const unfilledFlex = fillFungibleSlots(slots.flexCount || 0, FLEX_ELIGIBLE);
  const unfilledSuperflex = fillFungibleSlots(slots.superflexCount || 0, SUPERFLEX_ELIGIBLE);

  const dedicatedUnfilled = CORE_POSITIONS.reduce((sum, pos) => sum + unfilled[pos], 0);

  return {
    rosterCount: CORE_POSITIONS.reduce((sum, pos) => sum + rosterCounts[pos], 0),
    unfilled,
    unfilledFlex,
    unfilledSuperflex,
    dedicatedUnfilled,
    totalUnfilledStarters: dedicatedUnfilled + unfilledFlex + unfilledSuperflex,
    benchUsed: CORE_POSITIONS.reduce((sum, pos) => sum + overflow[pos], 0),
  };
}

/**
 * Determines which positions a team may NOT draft, so its remaining picks are
 * guaranteed to cover every unfilled starting slot.
 *
 * @param rosterPositions positions of players currently on the roster
 * @param slots           starting/bench slot counts from draft settings
 * @param remainingPicks  incomplete picks the team still owns
 */
export function getRestrictedPositions(
  rosterPositions: readonly string[],
  slots: RosterSlotSettings,
  remainingPicks: number
): string[] {
  const { unfilled, unfilledFlex, unfilledSuperflex, dedicatedUnfilled, totalUnfilledStarters, benchUsed } =
    analyzeRosterCoverage(rosterPositions, slots);

  // If all starters are filled, no restrictions needed
  if (totalUnfilledStarters === 0) return [];

  // A position is restricted when its dedicated slots are full and — when
  // fungible slots are considered — no FLEX/SUPERFLEX slot can absorb it.
  const restrictedPositions = (considerFungibleSlots: boolean): string[] =>
    CORE_POSITIONS.filter((position) => {
      if (unfilled[position] > 0) return false;
      if (!considerFungibleSlots) return true;
      if (unfilledSuperflex > 0 && SUPERFLEX_ELIGIBLE.includes(position)) return false;
      if (unfilledFlex > 0 && FLEX_ELIGIBLE.includes(position)) return false;
      return true;
    });

  // TIER 1: Remaining picks ≤ unfilled dedicated starters
  //   → Every pick MUST go toward a dedicated slot. No "wasting" a pick on a fungible slot.
  //   Example: 3 picks left, need RB(1)+K(1)+DEF(1)+FLEX(1) = 4 starters.
  //   Dedicated = 3 (RB+K+DEF). All 3 picks must fill dedicated slots → WR restricted.
  if (remainingPicks <= dedicatedUnfilled) {
    return restrictedPositions(false);
  }

  // TIER 2: Remaining picks ≤ total unfilled starters (but > dedicated)
  //   → Enough picks for dedicated slots but not all starters. Allow fungible positions too.
  if (remainingPicks <= totalUnfilledStarters) {
    return restrictedPositions(true);
  }

  // TIER 3: Plenty of picks remaining — only restrict once the bench is full
  if (benchUsed < (slots.benchCount || 0)) return [];

  return restrictedPositions(true);
}

// How a roster stands against its league's slots given its remaining picks.
// Used to judge whether a trade would leave a team unable to field a legal
// lineup: starterShortfall counts required starting slots that can no longer
// be filled; capacityOverflow counts players + picks beyond total roster room.
export interface RosterFeasibility {
  starterShortfall: number;
  capacityOverflow: number;
  // Distinct labels of the unfilled starting slots, e.g. ['WR', 'K', 'DEF', 'FLEX']
  unfilledStarterLabels: string[];
}

export function getRosterFeasibility(
  rosterPositions: readonly string[],
  slots: RosterSlotSettings,
  remainingPicks: number
): RosterFeasibility {
  const coverage = analyzeRosterCoverage(rosterPositions, slots);

  const unfilledStarterLabels: string[] = CORE_POSITIONS.filter(
    (pos) => coverage.unfilled[pos] > 0
  );
  if (coverage.unfilledFlex > 0) unfilledStarterLabels.push('FLEX');
  if (coverage.unfilledSuperflex > 0) unfilledStarterLabels.push('SUPERFLEX');

  return {
    starterShortfall: Math.max(0, coverage.totalUnfilledStarters - remainingPicks),
    capacityOverflow: Math.max(
      0,
      coverage.rosterCount + remainingPicks - totalRosterSlots(slots)
    ),
    unfilledStarterLabels,
  };
}
