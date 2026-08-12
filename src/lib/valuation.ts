import { computeProjectedPoints } from './scoring'
import type { SleeperProjection, SleeperRoster } from './sleeperTypes'

type StartingPosition = 'QB' | 'RB' | 'WR' | 'TE'
const STARTING_POSITIONS: StartingPosition[] = ['QB', 'RB', 'WR', 'TE']

// How much of each FLEX/SUPER_FLEX slot is assumed to go to each position, for the
// purpose of computing replacement level. This is a documented convention, not a
// measured fact - revisit if backtesting (Phase 10) shows it's off. SUPER_FLEX is
// assumed 100% QB, which is standard practice for 2QB/SuperFlex leagues: QB scarcity
// makes a "replacement" QB2 worth more than a marginal RB/WR/TE flex play in
// practice. The 2 FLEX slots are split RB/WR/TE by rough typical usage.
const FLEX_ALLOCATION: Record<'RB' | 'WR' | 'TE', number> = { RB: 0.5, WR: 0.4, TE: 0.1 }

export interface RosterRequirements {
  numTeams: number
  starters: Record<StartingPosition, number>
  flexSlots: number
  superFlexSlots: number
  totalRosterSlots: number
}

export function parseRosterRequirements(
  rosterPositions: string[],
  numTeams: number,
): RosterRequirements {
  const starters: Record<StartingPosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0 }
  let flexSlots = 0
  let superFlexSlots = 0
  for (const slot of rosterPositions) {
    if (slot === 'QB' || slot === 'RB' || slot === 'WR' || slot === 'TE') {
      starters[slot]++
    } else if (slot === 'FLEX') {
      flexSlots++
    } else if (slot === 'SUPER_FLEX') {
      superFlexSlots++
    }
    // BN and any other slot types don't affect replacement level.
  }
  return { numTeams, starters, flexSlots, superFlexSlots, totalRosterSlots: rosterPositions.length }
}

function replacementRank(position: StartingPosition, req: RosterRequirements): number {
  let rank = req.numTeams * req.starters[position]
  if (position === 'QB') {
    rank += req.numTeams * req.superFlexSlots
  } else {
    rank += Math.round(req.numTeams * req.flexSlots * FLEX_ALLOCATION[position])
  }
  return rank
}

export interface ProjectedPlayer {
  playerId: string
  name: string
  position: StartingPosition
  nflTeam: string | null
  points: number
}

export function buildProjectedPlayers(
  projections: SleeperProjection[],
  scoringSettings: Record<string, number>,
): ProjectedPlayer[] {
  const players: ProjectedPlayer[] = []
  for (const proj of projections) {
    const position = proj.player?.position
    if (position !== 'QB' && position !== 'RB' && position !== 'WR' && position !== 'TE') continue
    if (!proj.player) continue
    players.push({
      playerId: proj.player_id,
      name: `${proj.player.first_name} ${proj.player.last_name}`,
      position,
      nflTeam: proj.player.team,
      points: computeProjectedPoints(proj.stats, scoringSettings),
    })
  }
  return players
}

export function computeReplacementLevels(
  players: ProjectedPlayer[],
  req: RosterRequirements,
): Record<StartingPosition, number> {
  const levels = {} as Record<StartingPosition, number>
  for (const position of STARTING_POSITIONS) {
    const sorted = players
      .filter((p) => p.position === position)
      .sort((a, b) => b.points - a.points)
    const rank = replacementRank(position, req)
    const idx = Math.min(rank, sorted.length - 1)
    levels[position] = sorted[idx]?.points ?? 0
  }
  return levels
}

// League rule: keeper cost = last season's auction price x 1.2, rounded to the
// nearest dollar, minimum $5. Flat $5 if the player wasn't in last season's
// auction (waiver pickup, in-season trade, rookie not in the prior-year league).
// See MODELING.md Layer 0.
export function computeKeeperCost(lastSeasonPrice: number | null): number {
  if (lastSeasonPrice == null) return 5
  return Math.max(Math.round(lastSeasonPrice * 1.2), 5)
}

export interface TeamBudgetState {
  rosterId: number
  keeperCostTotal: number
  effectiveBudget: number
  remainingSlots: number
}

export function computeTeamBudgets(
  rosters: SleeperRoster[],
  lastSeasonPriceByPlayerId: Map<string, number>,
  budgetPerTeam: number,
  totalRosterSlots: number,
): TeamBudgetState[] {
  return rosters.map((roster) => {
    const keepers = roster.keepers ?? []
    const keeperCostTotal = keepers.reduce(
      (sum, playerId) => sum + computeKeeperCost(lastSeasonPriceByPlayerId.get(playerId) ?? null),
      0,
    )
    return {
      rosterId: roster.roster_id,
      keeperCostTotal,
      effectiveBudget: budgetPerTeam - keeperCostTotal,
      remainingSlots: totalRosterSlots - keepers.length,
    }
  })
}

export interface BaselinePlayerValue extends ProjectedPlayer {
  vor: number
  dollarValue: number
  isKept: boolean
  keptByRosterId: number | null
}

export interface BaselineResult {
  players: BaselinePlayerValue[]
  teamBudgets: TeamBudgetState[]
  replacementLevels: Record<StartingPosition, number>
  spendablePool: number
}

export function computeBaseline(
  projections: SleeperProjection[],
  scoringSettings: Record<string, number>,
  rosters: SleeperRoster[],
  rosterPositions: string[],
  numTeams: number,
  budgetPerTeam: number,
  lastSeasonPriceByPlayerId: Map<string, number>,
): BaselineResult {
  const req = parseRosterRequirements(rosterPositions, numTeams)
  const allPlayers = buildProjectedPlayers(projections, scoringSettings)
  const replacementLevels = computeReplacementLevels(allPlayers, req)

  const keeperOwnerByPlayerId = new Map<string, number>()
  for (const roster of rosters) {
    for (const playerId of roster.keepers ?? []) {
      keeperOwnerByPlayerId.set(playerId, roster.roster_id)
    }
  }

  const teamBudgets = computeTeamBudgets(
    rosters,
    lastSeasonPriceByPlayerId,
    budgetPerTeam,
    req.totalRosterSlots,
  )
  const spendablePool =
    teamBudgets.reduce((sum, t) => sum + t.effectiveBudget, 0) -
    teamBudgets.reduce((sum, t) => sum + t.remainingSlots, 0)

  const withVor = allPlayers.map((p) => ({
    ...p,
    vor: Math.max(0, p.points - replacementLevels[p.position]),
    isKept: keeperOwnerByPlayerId.has(p.playerId),
    keptByRosterId: keeperOwnerByPlayerId.get(p.playerId) ?? null,
  }))

  const totalAvailableVor = withVor
    .filter((p) => !p.isKept)
    .reduce((sum, p) => sum + p.vor, 0)

  const players: BaselinePlayerValue[] = withVor.map((p) => {
    if (p.isKept || p.vor <= 0 || totalAvailableVor <= 0) {
      return { ...p, dollarValue: 1 }
    }
    const dollarValue = Math.max(1, Math.round((p.vor / totalAvailableVor) * spendablePool))
    return { ...p, dollarValue }
  })

  return { players, teamBudgets, replacementLevels, spendablePool }
}
