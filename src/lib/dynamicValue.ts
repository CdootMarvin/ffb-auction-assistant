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

// Combines position-specific and league-wide inflation multiplicatively, with
// league-wide ALWAYS active (not diluted away as position data accumulates) and
// the position term dampened by how many real sales support it:
//
//   combinedIndex = leagueIndex * positionIndex^weight,  weight = n/(n+4)
//
// Why multiplicative with league-wide always-on: league-wide reflects real,
// ongoing money-conservation pressure across the WHOLE draft ("that $30 a
// discounted RB1 didn't cost has to be spent somewhere") that doesn't go away
// just because one position has built up a lot of its own sales history - it
// should keep compounding with the position-specific signal, not be replaced
// by it. Why the exponent is dampened by sample size: an UNDAMPENED multiply
// (weight always 1) would let a single outlier sale swing a position's price
// exactly as hard as a well-established trend would. Raising positionIndex to
// a fractional power pulls it toward neutral (1.0) when little real data
// supports it, and lets it fully express itself as more sales accumulate -
// converging to a plain multiply (leagueIndex * positionIndex) once well
// supported, without overreacting to n=1. K=4 is a round, documented default
// (not fitted): at 1 sale the position term is barely expressed (0.8^0.2≈0.96),
// at 4 sales half-expressed (0.8^0.5≈0.89), at 16 sales mostly expressed
// (0.8^0.8≈0.83). See MODELING.md Layer 6.
const POSITION_TRUST_K = 4

function positionWeight(salesCount: number): number {
  return salesCount / (salesCount + POSITION_TRUST_K)
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
    // Skip the dynamic multiplier entirely for near-replacement players
    // (baseline value <= $5). Real bidding for deep bench/waiver-tier players is
    // governed by the $1-minimum-bid mechanic and roster-filling necessity, not
    // broader market inflation - nudging a $1-2 baseline player up a dollar
    // doesn't reflect anything real, it just creates a large PERCENTAGE error
    // the moment actual price stays at the floor. $5 chosen after backtesting
    // $3 and $5 against Phase 10's historical draft - $5 meaningfully reduced
    // RB/TE's inflated MAPE without hurting MAE/correlation; stopped tuning
    // further deliberately to avoid overfitting to one draft. See MODELING.md
    // Layer 6 for the full before/after numbers.
    const NEAR_REPLACEMENT_THRESHOLD = 5
    if (player.dollarValue <= NEAR_REPLACEMENT_THRESHOLD) {
      result.set(player.playerId, {
        playerId: player.playerId,
        currentValue: player.dollarValue,
        expectedPrice: player.dollarValue,
        rangeLow: Math.max(1, player.dollarValue - 1),
        rangeHigh: player.dollarValue + 1,
        recommendedMax: player.dollarValue,
        recommendation: 'NEUTRAL',
        realisticBidderCount: bidders.get(player.playerId)?.realisticBidderCount ?? 0,
      })
      continue
    }

    // combinedIndex = leagueIndex * positionIndex^weight - see positionWeight
    // above for the full reasoning. League-wide always applies; the position
    // term is dampened toward neutral (1.0) until enough real sales support it.
    const positionScarcityInfo = scarcityByPosition.get(player.position)
    const positionIndex = positionScarcityInfo?.positionInflationIndex
    const leagueIndex = economy.inflationIndex ?? 1
    let combinedIndex = leagueIndex
    if (positionIndex != null && positionIndex > 0) {
      const weight = positionWeight(positionScarcityInfo?.salesCount ?? 0)
      combinedIndex = leagueIndex * Math.pow(positionIndex, weight)
    }
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
