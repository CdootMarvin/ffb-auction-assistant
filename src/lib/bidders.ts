import type { BaselinePlayerValue } from './valuation'
import type { TeamEconomy } from './economy'
import type { TeamPositionNeeds } from './scarcity'

// Rule-based, not statistical (MODELING.md Layer 5) - not enough historical data to
// fit a model, and rules stay explainable. A team counts as a realistic bidder for
// a player if:
// 1. The team still needs that position (Phase 4's needsStarter check).
// 2. The team has enough remaining budget to bid competitively - defined as being
//    able to reach the player's baseline dollar value after reserving $1 for every
//    OTHER remaining roster slot (the standard auction "max possible bid" formula),
//    not just having *some* money left. This also folds in "enough roster slots
//    left that a big bid here doesn't strand them elsewhere" - a team down to its
//    last slot or two sees its max bid shrink accordingly.

export function computeMaxBid(remainingBudget: number, remainingSlots: number): number {
  if (remainingSlots <= 0) return 0
  return remainingBudget - (remainingSlots - 1) * 1
}

export interface PlayerBidders {
  playerId: string
  realisticBidderCount: number
  realisticBidderRosterIds: number[]
}

export function computeRealisticBidders(
  players: BaselinePlayerValue[],
  draftedPlayerIds: Set<string>,
  teamEconomyByRoster: Map<number, TeamEconomy>,
  teamNeeds: TeamPositionNeeds[],
): Map<string, PlayerBidders> {
  const needsByRoster = new Map(teamNeeds.map((t) => [t.rosterId, t]))
  const result = new Map<string, PlayerBidders>()

  for (const player of players) {
    if (player.isKept || draftedPlayerIds.has(player.playerId) || player.vor <= 0) continue

    const biddingRosterIds: number[] = []
    for (const [rosterId, te] of teamEconomyByRoster) {
      const needs = needsByRoster.get(rosterId)
      if (!needs?.needsStarter[player.position]) continue
      const maxBid = computeMaxBid(te.remainingBudget, te.remainingSlots)
      if (maxBid >= player.dollarValue) {
        biddingRosterIds.push(rosterId)
      }
    }

    result.set(player.playerId, {
      playerId: player.playerId,
      realisticBidderCount: biddingRosterIds.length,
      realisticBidderRosterIds: biddingRosterIds,
    })
  }

  return result
}
