import type { BaselineResult, StartingPosition } from './valuation'
import type { SleeperPick } from './sleeperTypes'

// Tracks what has actually happened in the live auction so far, on top of the
// Phase 2 pre-draft baseline: money spent, money/roster slots remaining per team,
// which players are gone, and the resulting league-wide inflation index. See
// MODELING.md Layer 3.

export interface TeamEconomy {
  rosterId: number
  picksMade: number
  spentInDraft: number
  remainingBudget: number
  remainingSlots: number
}

export interface LeagueEconomy {
  teamEconomy: TeamEconomy[]
  draftedPlayerIds: Set<string>
  remainingTotalMoney: number
  remainingTotalVor: number
  inflationIndex: number | null
  positionSpending: Record<StartingPosition, number>
  otherSpending: number
  positionRemainingVor: Record<StartingPosition, number>
}

export function computeLeagueEconomy(baseline: BaselineResult, picks: SleeperPick[]): LeagueEconomy {
  const draftedPlayerIds = new Set(picks.map((p) => p.player_id))

  const picksByRoster = new Map<number, SleeperPick[]>()
  for (const pick of picks) {
    const list = picksByRoster.get(pick.roster_id) ?? []
    list.push(pick)
    picksByRoster.set(pick.roster_id, list)
  }

  const teamEconomy: TeamEconomy[] = baseline.teamBudgets.map((tb) => {
    const teamPicks = picksByRoster.get(tb.rosterId) ?? []
    const spentInDraft = teamPicks.reduce((sum, p) => sum + Number(p.metadata?.amount ?? 0), 0)
    return {
      rosterId: tb.rosterId,
      picksMade: teamPicks.length,
      spentInDraft,
      remainingBudget: tb.effectiveBudget - spentInDraft,
      remainingSlots: tb.remainingSlots - teamPicks.length,
    }
  })

  const remainingTotalMoney = teamEconomy.reduce((sum, t) => sum + t.remainingBudget, 0)
  // Reserve $1 per remaining roster slot, same as the original spendablePool
  // (MODELING.md Layer 2) - needed so the inflation ratio compares like with like.
  // Without this, the index reads ~1.09 instead of exactly 1.00 at zero picks made,
  // since remainingTotalMoney (raw) and spendablePool (reserve-adjusted) aren't
  // directly comparable.
  const remainingSlotsTotal = teamEconomy.reduce((sum, t) => sum + t.remainingSlots, 0)
  const remainingSpendablePool = remainingTotalMoney - remainingSlotsTotal

  const positionSpending = { QB: 0, RB: 0, WR: 0, TE: 0 } as Record<StartingPosition, number>
  let otherSpending = 0
  for (const pick of picks) {
    const amount = Number(pick.metadata?.amount ?? 0)
    const position = pick.metadata?.position
    if (position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE') {
      positionSpending[position] += amount
    } else {
      otherSpending += amount
    }
  }

  const positionRemainingVor = { QB: 0, RB: 0, WR: 0, TE: 0 } as Record<StartingPosition, number>
  let remainingTotalVor = 0
  for (const player of baseline.players) {
    if (player.isKept || draftedPlayerIds.has(player.playerId) || player.vor <= 0) continue
    positionRemainingVor[player.position] += player.vor
    remainingTotalVor += player.vor
  }

  const originalRatio = baseline.totalAvailableVor > 0 ? baseline.spendablePool / baseline.totalAvailableVor : null
  const remainingRatio = remainingTotalVor > 0 ? remainingSpendablePool / remainingTotalVor : null
  const inflationIndex =
    originalRatio != null && originalRatio > 0 && remainingRatio != null ? remainingRatio / originalRatio : null

  return {
    teamEconomy,
    draftedPlayerIds,
    remainingTotalMoney,
    remainingTotalVor,
    inflationIndex,
    positionSpending,
    otherSpending,
    positionRemainingVor,
  }
}
