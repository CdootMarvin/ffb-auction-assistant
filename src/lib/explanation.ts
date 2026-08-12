import type { BaselinePlayerValue } from './valuation'
import type { DynamicPlayerValue } from './dynamicValue'
import type { PositionScarcity } from './scarcity'

// Turns the underlying numbers into plain-language sentences. See PROJECT_SPEC.md's
// "the application should explain itself" requirement and ROADMAP.md Phase 8.
export function generateExplanation(
  player: BaselinePlayerValue,
  dv: DynamicPlayerValue,
  scarcity: PositionScarcity | undefined,
  numTeams: number,
): string[] {
  const lines: string[] = []

  if (dv.currentValue === player.dollarValue) {
    lines.push(
      `Current value ($${dv.currentValue}) matches the preseason baseline — no ${player.position} pricing signal has moved it yet.`,
    )
  } else if (dv.currentValue > player.dollarValue) {
    lines.push(
      `Current value rose from $${player.dollarValue} to $${dv.currentValue}: ${player.position}s have been going for more than their baseline value so far this draft.`,
    )
  } else {
    lines.push(
      `Current value dropped from $${player.dollarValue} to $${dv.currentValue}: ${player.position}s have been going for less than their baseline value so far this draft.`,
    )
  }

  if (scarcity) {
    lines.push(
      `${scarcity.teamsNeedingStarter} of ${numTeams} teams still need a starting ${player.position}, with ${scarcity.remainingPlayerCount} comparable ${player.position}s left worth drafting.`,
    )
  }

  if (dv.realisticBidderCount === 0) {
    lines.push(
      `No teams currently look like realistic competitive bidders for this player, based on position need and remaining budget.`,
    )
  } else {
    lines.push(
      `${dv.realisticBidderCount} team${dv.realisticBidderCount === 1 ? '' : 's'} currently look able to bid competitively — they still need ${player.position} and have enough budget left to reach this player's value.`,
    )
  }

  if (dv.recommendation === 'BUY') {
    lines.push(
      `Expected price ($${dv.expectedPrice}) is below current value ($${dv.currentValue}) — this player looks likely to go for less than they're worth.`,
    )
  } else if (dv.recommendation === 'OVERPAY') {
    lines.push(
      `Expected price ($${dv.expectedPrice}) is above current value ($${dv.currentValue}) — the market looks likely to bid this past its worth. Don't chase it past $${dv.recommendedMax}.`,
    )
  } else {
    lines.push(`Expected price ($${dv.expectedPrice}) is roughly in line with current value ($${dv.currentValue}).`)
  }

  return lines
}
