// Computes league-specific projected fantasy points from Sleeper's season-total
// stat projections and this league's actual scoring_settings - not Sleeper's
// generic pts_ppr/half_ppr/std fields, which don't reflect this league's custom
// rules (e.g. a 0.5/reception TE premium). See MODELING.md Layer 1.
//
// KNOWN LIMITATION: this league's scoring includes several per-game threshold
// bonuses (bonus_pass_yd_300, bonus_pass_yd_400, bonus_rec_yd_100/200,
// bonus_rush_yd_100/200) and pass_sack. These can't be derived from a season-total
// projection (a player projected for 3650 yards over 17 games didn't necessarily
// throw for 300+ in any single game - that requires game-by-game data this app
// doesn't fetch). They are deliberately excluded below rather than approximated.
// Revisit only if backtesting (Phase 10) shows this materially skews rankings.
const SUPPORTED_SCORING_CATEGORIES = [
  'pass_yd',
  'pass_td',
  'pass_int',
  'pass_2pt',
  'rush_yd',
  'rush_td',
  'rush_2pt',
  'rec',
  'rec_yd',
  'rec_td',
  'rec_2pt',
  'fum_lost',
  'bonus_rec_te',
] as const

export function computeProjectedPoints(
  stats: Record<string, number>,
  scoringSettings: Record<string, number>,
): number {
  let total = 0
  for (const category of SUPPORTED_SCORING_CATEGORIES) {
    const statValue = stats[category] ?? 0
    const weight = scoringSettings[category] ?? 0
    total += statValue * weight
  }
  return total
}
