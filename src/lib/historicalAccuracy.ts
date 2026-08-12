import { computeBaseline, type StartingPosition } from './valuation'
import type { SleeperLeague, SleeperPick, SleeperProjection, SleeperRoster } from './sleeperTypes'

// Phase 9: how accurate is the static baseline methodology (Layers 1-2) against
// real historical sale prices? See MODELING.md "Historical calibration" section.
//
// Only structurally comparable seasons should be used - a league that changed
// roster format (e.g. single-QB -> 2QB/SuperFlex, or added/dropped K/DEF slots)
// has different economics, and mixing them in would corrupt the comparison rather
// than calibrate it. Check with sameRosterFormat before calling this.

export function sameRosterFormat(a: string[], b: string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
}

export interface PlayerAccuracy {
  playerId: string
  name: string
  position: StartingPosition
  predicted: number
  actual: number
  error: number
  absError: number
  pctError: number
}

export interface AccuracySummary {
  count: number
  mae: number
  mape: number
  correlation: number | null
}

export interface HistoricalAccuracyResult {
  season: string
  players: PlayerAccuracy[]
  overall: AccuracySummary
  byPosition: Record<StartingPosition, AccuracySummary>
  excludedPickCount: number
}

export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 2) return null
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let denomX = 0
  let denomY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    num += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }
  const denom = Math.sqrt(denomX * denomY)
  return denom === 0 ? null : num / denom
}

function summarize(list: PlayerAccuracy[]): AccuracySummary {
  const count = list.length
  const mae = count > 0 ? list.reduce((s, p) => s + p.absError, 0) / count : 0
  const mape = count > 0 ? list.reduce((s, p) => s + p.pctError, 0) / count : 0
  const correlation = pearsonCorrelation(
    list.map((p) => p.predicted),
    list.map((p) => p.actual),
  )
  return { count, mae, mape, correlation }
}

export function computeHistoricalAccuracy(
  historicalLeague: SleeperLeague,
  historicalRosters: SleeperRoster[],
  historicalProjections: SleeperProjection[],
  historicalBudget: number,
  historicalPicks: SleeperPick[],
): HistoricalAccuracyResult {
  // No keepers that season for this league (keepers started 2026) - empty price
  // map means every roster's keeper cost is $0, matching reality.
  const baseline = computeBaseline(
    historicalProjections,
    historicalLeague.scoring_settings,
    historicalRosters,
    historicalLeague.roster_positions,
    historicalLeague.total_rosters,
    historicalBudget,
    new Map(),
  )
  const predictedByPlayerId = new Map(baseline.players.map((p) => [p.playerId, p]))

  const players: PlayerAccuracy[] = []
  let excludedPickCount = 0

  for (const pick of historicalPicks) {
    const predictedPlayer = predictedByPlayerId.get(pick.player_id)
    const actual = Number(pick.metadata?.amount ?? NaN)
    if (!predictedPlayer || Number.isNaN(actual)) {
      excludedPickCount++
      continue
    }
    const predicted = predictedPlayer.dollarValue
    const error = actual - predicted
    players.push({
      playerId: pick.player_id,
      name: predictedPlayer.name,
      position: predictedPlayer.position,
      predicted,
      actual,
      error,
      absError: Math.abs(error),
      pctError: Math.abs(error) / Math.max(1, predicted),
    })
  }

  const byPosition = {} as Record<StartingPosition, AccuracySummary>
  for (const position of ['QB', 'RB', 'WR', 'TE'] as StartingPosition[]) {
    byPosition[position] = summarize(players.filter((p) => p.position === position))
  }

  return {
    season: historicalLeague.season,
    players,
    overall: summarize(players),
    byPosition,
    excludedPickCount,
  }
}
