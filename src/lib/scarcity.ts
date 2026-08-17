import type { BaselineResult, RosterRequirements, StartingPosition } from './valuation'
import type { SleeperPick, SleeperRoster } from './sleeperTypes'

// Supply and demand per position, on top of Phase 3's league-wide economy. See
// MODELING.md Layer 4.

const POSITIONS: StartingPosition[] = ['QB', 'RB', 'WR', 'TE']

export interface TeamPositionNeeds {
  rosterId: number
  counts: Record<StartingPosition, number>
  needsStarter: Record<StartingPosition, boolean>
}

// Counts players a team already has (keepers + live picks) per position, and
// compares against that position's dedicated (non-flex) starter requirement.
// This can't know exactly which drafted player will fill which roster slot
// (Sleeper doesn't assign that during a live auction draft), so "needs starter"
// is a headcount-based estimate - a team with 2 RBs is assumed to have its RB
// starters covered even though real lineup assignment happens later in-season.
export function computeTeamPositionNeeds(
  rosters: SleeperRoster[],
  baseline: BaselineResult,
  picks: SleeperPick[],
  req: RosterRequirements,
): TeamPositionNeeds[] {
  const counts = new Map<number, Record<StartingPosition, number>>()
  for (const roster of rosters) {
    counts.set(roster.roster_id, { QB: 0, RB: 0, WR: 0, TE: 0 })
  }

  for (const player of baseline.players) {
    if (player.isKept && player.keptByRosterId != null) {
      const c = counts.get(player.keptByRosterId)
      if (c) c[player.position]++
    }
  }

  for (const pick of picks) {
    const position = pick.metadata?.position
    if (position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE') {
      const c = counts.get(pick.roster_id)
      if (c) c[position]++
    }
  }

  return rosters.map((roster) => {
    const c = counts.get(roster.roster_id) ?? { QB: 0, RB: 0, WR: 0, TE: 0 }
    const needsStarter = {} as Record<StartingPosition, boolean>
    for (const position of POSITIONS) {
      needsStarter[position] = c[position] < req.starters[position]
    }
    return { rosterId: roster.roster_id, counts: c, needsStarter }
  })
}

export interface PositionScarcity {
  position: StartingPosition
  remainingPlayerCount: number
  remainingVor: number
  teamsNeedingStarter: number
  actualDollarPerVor: number | null
  positionInflationIndex: number | null
  // Live sales at this position so far (excludes keepers - see actualDollarPerVor
  // above). Exposed so Layer 6 can weight how much to trust positionInflationIndex
  // vs the league-wide index by sample size, rather than an all-or-nothing switch.
  salesCount: number
}

// actualDollarPerVor uses real prices paid for players actually drafted at this
// position so far (live picks only - keeper costs are set by formula, not the
// market, so including them would contaminate the pricing signal), compared
// against the single global $/VOR ratio baseline dollar values were built from
// (every position shares the same original ratio by construction - see
// MODELING.md Layer 2 - so this directly measures whether THIS position is
// pricing above or below the rest of the league).
export function computePositionScarcity(
  baseline: BaselineResult,
  picks: SleeperPick[],
  teamNeeds: TeamPositionNeeds[],
): PositionScarcity[] {
  const originalRatio = baseline.totalAvailableVor > 0 ? baseline.spendablePool / baseline.totalAvailableVor : null
  const draftedPlayerIds = new Set(picks.map((p) => p.player_id))
  const vorByPlayerId = new Map(baseline.players.map((p) => [p.playerId, p]))

  const playersByPosition = new Map<StartingPosition, typeof baseline.players>()
  for (const position of POSITIONS) playersByPosition.set(position, [])
  for (const p of baseline.players) playersByPosition.get(p.position)?.push(p)

  return POSITIONS.map((position) => {
    const positionPlayers = playersByPosition.get(position) ?? []
    const remaining = positionPlayers.filter(
      (p) => !p.isKept && !draftedPlayerIds.has(p.playerId) && p.vor > 0,
    )
    const remainingVor = remaining.reduce((sum, p) => sum + p.vor, 0)

    const draftedAtPosition = picks.filter((pk) => pk.metadata?.position === position)
    const spentAtPosition = draftedAtPosition.reduce((sum, pk) => sum + Number(pk.metadata?.amount ?? 0), 0)
    const vorDraftedAtPosition = draftedAtPosition.reduce(
      (sum, pk) => sum + (vorByPlayerId.get(pk.player_id)?.vor ?? 0),
      0,
    )

    const actualDollarPerVor = vorDraftedAtPosition > 0 ? spentAtPosition / vorDraftedAtPosition : null
    const positionInflationIndex =
      actualDollarPerVor != null && originalRatio != null && originalRatio > 0
        ? actualDollarPerVor / originalRatio
        : null

    return {
      position,
      remainingPlayerCount: remaining.length,
      remainingVor,
      teamsNeedingStarter: teamNeeds.filter((t) => t.needsStarter[position]).length,
      actualDollarPerVor,
      positionInflationIndex,
      salesCount: draftedAtPosition.length,
    }
  })
}
