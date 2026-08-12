import type { BaselinePlayerValue } from './valuation'
import type { LeagueEconomy } from './economy'
import type { PositionScarcity } from './scarcity'
import type { PlayerBidders } from './bidders'

// Combines every prior layer into one live number per player. See MODELING.md
// Layer 6.

export type Recommendation = 'BUY' | 'NEUTRAL' | 'OVERPAY'

export interface DynamicPlayerValue {
  playerId: string
  currentValue: number
  expectedPrice: number
  rangeLow: number
  rangeHigh: number
  recommendedMax: number
  recommendation: Recommendation
  realisticBidderCount: number
}

// Heuristic bidder-count price multiplier, not calibrated against real data yet -
// a documented assumption, revisit once real draft-day data exists (Phase 9/10).
//
// IMPORTANT: this is relative to a per-position REFERENCE bidder count (the
// median among currently-available players at that position), not a fixed
// absolute number. An earlier version used a fixed "2 bidders = neutral"
// reference, which broke completely at the start of a draft: with fresh budgets
// and every roster spot open, realistic bidder counts sit high (10-12) for
// nearly every player, so a fixed low reference flagged almost the entire player
// pool as OVERPAY - a signal that doesn't differentiate between players is
// useless. Comparing each player against their position's own current typical
// bidder count means only players who genuinely stand out from their peers
// (more or less contested than a typical player at that position, right now)
// get flagged - which is the actual point of this layer.
function bidderPriceFactor(bidderCount: number, referenceBidderCount: number): number {
  const diff = bidderCount - referenceBidderCount
  return Math.max(0.6, Math.min(1.4, 1 + diff * 0.05))
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// Range width stays on absolute bidder count, unlike the price factor above -
// more parties competing means more outcome uncertainty regardless of whether
// that count is typical for the position right now.
function rangeSpread(bidderCount: number): number {
  return 0.15 + Math.min(0.03 * bidderCount, 0.25)
}

export function computeDynamicValues(
  players: BaselinePlayerValue[],
  draftedPlayerIds: Set<string>,
  economy: LeagueEconomy,
  positionScarcity: PositionScarcity[],
  bidders: Map<string, PlayerBidders>,
): Map<string, DynamicPlayerValue> {
  const scarcityByPosition = new Map(positionScarcity.map((s) => [s.position, s]))
  const result = new Map<string, DynamicPlayerValue>()

  const availablePlayers = players.filter(
    (p) => !p.isKept && !draftedPlayerIds.has(p.playerId) && p.vor > 0,
  )
  const bidderCountsByPosition = new Map<string, number[]>()
  for (const player of availablePlayers) {
    const count = bidders.get(player.playerId)?.realisticBidderCount ?? 0
    const list = bidderCountsByPosition.get(player.position) ?? []
    list.push(count)
    bidderCountsByPosition.set(player.position, list)
  }
  const referenceBidderCountByPosition = new Map(
    [...bidderCountsByPosition.entries()].map(([position, counts]) => [position, medianOf(counts)]),
  )

  for (const player of availablePlayers) {
    // Position-specific inflation in place of league-wide when available (more
    // targeted signal), falling back to league-wide for positions with no live
    // picks yet. See MODELING.md Layer 6 for why these aren't multiplied together.
    const positionIndex = scarcityByPosition.get(player.position)?.positionInflationIndex
    const combinedIndex = positionIndex ?? economy.inflationIndex ?? 1
    const currentValue = Math.max(1, Math.round(player.dollarValue * combinedIndex))

    const bidderCount = bidders.get(player.playerId)?.realisticBidderCount ?? 0
    const referenceBidderCount = referenceBidderCountByPosition.get(player.position) ?? bidderCount
    const expectedPrice = Math.max(
      1,
      Math.round(currentValue * bidderPriceFactor(bidderCount, referenceBidderCount)),
    )

    const spread = rangeSpread(bidderCount)
    const rangeLow = Math.max(1, Math.round(expectedPrice * (1 - spread)))
    const rangeHigh = Math.round(expectedPrice * (1 + spread))

    let recommendation: Recommendation = 'NEUTRAL'
    if (expectedPrice < currentValue * 0.95) recommendation = 'BUY'
    else if (expectedPrice > currentValue * 1.05) recommendation = 'OVERPAY'

    result.set(player.playerId, {
      playerId: player.playerId,
      currentValue,
      expectedPrice,
      rangeLow,
      rangeHigh,
      recommendedMax: currentValue,
      recommendation,
      realisticBidderCount: bidderCount,
    })
  }

  return result
}
