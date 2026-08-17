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

  // League-wide totals computed DIRECTLY from all picks/teams, not by summing the
  // per-team figures above. This matters because per-team attribution requires a
  // valid pick.roster_id, which real league drafts always have (verified) but
  // Sleeper mock drafts do not (verified: every pick comes back with roster_id:
  // null). If remainingTotalMoney were summed from teamEconomy (which silently
  // attributes $0 to every team when roster_id can't be matched), the league-wide
  // inflation index would read as if no money had been spent at all, even after
  // real picks happened - confirmed this produced a fake 1.52 reading instead of
  // the correct ~1.01 in a live mock draft test. Computing it directly from the
  // full picks list side-steps that: the league-wide total doesn't need to know
  // *who* bought a player, only that the money is gone. Per-team numbers above
  // still can't be fixed the same way - if the data genuinely doesn't say who
  // bought what, there's no way to attribute it to a specific team - but that
  // real limitation must not also corrupt the league-wide total.
  const totalOriginalBudget = baseline.teamBudgets.reduce((sum, t) => sum + t.effectiveBudget, 0)
  const totalActualSpent = picks.reduce((sum, p) => sum + Number(p.metadata?.amount ?? 0), 0)
  const remainingTotalMoney = totalOriginalBudget - totalActualSpent

  // Reserve $1 per remaining roster slot, same as the original spendablePool
  // (MODELING.md Layer 2) - needed so the inflation ratio compares like with like.
  // Without this, the index reads ~1.09 instead of exactly 1.00 at zero picks made,
  // since remainingTotalMoney (raw) and spendablePool (reserve-adjusted) aren't
  // directly comparable. Also computed directly from all picks, for the same
  // roster_id-robustness reason as remainingTotalMoney above.
  const totalOriginalSlots = baseline.teamBudgets.reduce((sum, t) => sum + t.remainingSlots, 0)
  const remainingSlotsTotal = totalOriginalSlots - picks.length
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
