import {
  computeBaseline,
  parseRosterRequirements,
  type StartingPosition,
} from './valuation'
import { computeLeagueEconomy } from './economy'
import { computePositionScarcity, computeTeamPositionNeeds } from './scarcity'
import { computeRealisticBidders } from './bidders'
import { computeDynamicValues } from './dynamicValue'
import { pearsonCorrelation, type AccuracySummary } from './historicalAccuracy'
import type { SleeperLeague, SleeperPick, SleeperProjection, SleeperRoster } from './sleeperTypes'

// Phase 10: point-in-time backtesting. Unlike Phase 9 (which compares the STATIC
// baseline against final sale prices, computed once), this replays the historical
// draft pick by pick - at each point, only picks that happened BEFORE it are known,
// exactly like a live draft. Compares three tiers of increasing model complexity
// against actual price, to answer the real question: does the complexity actually
// help? See MODELING.md and ROADMAP.md Phase 10.
//
// HONEST LIMITATION: this draws on the same single 2025 draft Phase 9 already used
// for calibration discussion. This is not a held-out validation - it's a
// sanity/regression check, not proof. Don't let a good result here justify more
// model complexity than one draft's worth of data can actually support.

export interface BacktestPick {
  pickNo: number
  playerId: string
  name: string
  position: StartingPosition
  actual: number
  staticPrediction: number
  inflationOnlyPrediction: number
  fullModelPrediction: number
}

export interface BacktestResult {
  season: string
  picks: BacktestPick[]
  excludedPickCount: number
  static: AccuracySummary
  inflationOnly: AccuracySummary
  fullModel: AccuracySummary
  fullModelByPosition: Record<StartingPosition, AccuracySummary>
}

function summarizeTier(
  actuals: number[],
  predictions: number[],
): AccuracySummary {
  const count = actuals.length
  if (count === 0) return { count: 0, mae: 0, mape: 0, correlation: null }
  const absErrors = actuals.map((a, i) => Math.abs(a - predictions[i]))
  const mae = absErrors.reduce((a, b) => a + b, 0) / count
  const mape =
    actuals.reduce((s, a, i) => s + Math.abs(a - predictions[i]) / Math.max(1, predictions[i]), 0) / count
  const correlation = pearsonCorrelation(predictions, actuals)
  return { count, mae, mape, correlation }
}

export function runBacktest(
  league: SleeperLeague,
  rosters: SleeperRoster[],
  projections: SleeperProjection[],
  budget: number,
  picks: SleeperPick[],
): BacktestResult {
  const chronological = [...picks].sort((a, b) => a.pick_no - b.pick_no)

  // No keepers that season - this is the fixed pre-draft baseline every tier
  // scales from. It doesn't change during replay; only the dynamic layers do.
  const baseline = computeBaseline(
    projections,
    league.scoring_settings,
    rosters,
    league.roster_positions,
    league.total_rosters,
    budget,
    new Map(),
  )
  const req = parseRosterRequirements(league.roster_positions, league.total_rosters)
  const staticByPlayerId = new Map(baseline.players.map((p) => [p.playerId, p]))

  const results: BacktestPick[] = []
  let excludedPickCount = 0

  for (let i = 0; i < chronological.length; i++) {
    const pick = chronological[i]
    const picksSoFar = chronological.slice(0, i) // strictly before this pick - no hindsight
    const actual = Number(pick.metadata?.amount ?? NaN)
    const predictedPlayer = staticByPlayerId.get(pick.player_id)
    if (!predictedPlayer || Number.isNaN(actual)) {
      excludedPickCount++
      continue
    }

    const economy = computeLeagueEconomy(baseline, picksSoFar)
    const teamNeeds = computeTeamPositionNeeds(rosters, baseline, picksSoFar, req)
    const scarcity = computePositionScarcity(baseline, picksSoFar, teamNeeds)
    const teamEconomyByRoster = new Map(economy.teamEconomy.map((t) => [t.rosterId, t]))
    const bidders = computeRealisticBidders(baseline.players, economy.draftedPlayerIds, teamEconomyByRoster, teamNeeds)
    const dynamicValues = computeDynamicValues(
      baseline.players,
      economy.draftedPlayerIds,
      economy,
      scarcity,
      bidders,
    )

    const staticPrediction = predictedPlayer.dollarValue
    const inflationOnlyPrediction = Math.max(
      1,
      Math.round(predictedPlayer.dollarValue * (economy.inflationIndex ?? 1)),
    )
    const fullModelPrediction = dynamicValues.get(pick.player_id)?.expectedPrice ?? staticPrediction

    results.push({
      pickNo: pick.pick_no,
      playerId: pick.player_id,
      name: predictedPlayer.name,
      position: predictedPlayer.position,
      actual,
      staticPrediction,
      inflationOnlyPrediction,
      fullModelPrediction,
    })
  }

  const actuals = results.map((r) => r.actual)
  const fullModelResult = summarizeTier(
    actuals,
    results.map((r) => r.fullModelPrediction),
  )
  const byPosition = {} as Record<StartingPosition, AccuracySummary>
  for (const position of ['QB', 'RB', 'WR', 'TE'] as StartingPosition[]) {
    const subset = results.filter((r) => r.position === position)
    byPosition[position] = summarizeTier(
      subset.map((r) => r.actual),
      subset.map((r) => r.fullModelPrediction),
    )
  }

  return {
    season: league.season,
    picks: results,
    excludedPickCount,
    static: summarizeTier(actuals, results.map((r) => r.staticPrediction)),
    inflationOnly: summarizeTier(actuals, results.map((r) => r.inflationOnlyPrediction)),
    fullModel: fullModelResult,
    fullModelByPosition: byPosition,
  }
}
