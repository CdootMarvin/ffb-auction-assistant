# Modeling — Valuation Engine

This is the source of truth for how player values are actually calculated. Keep formulas and rationale here, not scattered across code comments, so future sessions can tune the model without re-deriving it.

## Design principle

Layered, explainable, deterministic-first. No black-box statistical fitting in V1 — not enough historical data to support it, and it would break the self-explanation requirement (every number on screen must trace back to a stated reason).

## Layer 0 — Keeper-adjusted starting state (added 2026-08-12, first keeper year for this league)

This league has keepers for the first time this season. That means there is no genuinely clean "preseason" baseline: by the time the auction starts, some players are already off the board and some team budget/roster slots are already committed. Treat keepers as auction purchases that happened before pick 1:

- Remove each kept player from the available pool (they don't re-enter the auction).
- Subtract each keeper's cost from that team's effective starting budget.
- Subtract the roster slot(s) the keeper fills from that team's remaining slots.

Everything downstream (Layers 1-6, including what's displayed as "pre-draft value") should be computed from this post-keeper starting state, not a naive full-budget/full-pool calculation. In effect, "pre-draft value" this year *is* the Day-1 output of the same engine used for in-draft dynamics, just evaluated before any live picks have happened.

**Confirmed 2026-08-12 against the real league (ID 1389362840074199040):**

- Sleeper natively tracks keepers per team: `GET /league/{league_id}/rosters` returns a `keepers` array (list of player IDs) per roster. League setting `max_keepers: 2`, `keeper_deadline` 7 days out — as of this check, 3 of 12 teams had declared (partial declarations expected until the deadline; re-poll close to draft day, not just once).
- Sleeper does **not** store keeper cost anywhere (confirmed: the draft object has no keeper settings). Cost must be computed by us:

```
raw = last_season_auction_price(player) * 1.2
keeper_cost = max(round_to_nearest_dollar(raw), 5)   // e.g. $49 -> $58.80 -> $59; $3 -> $3.60 -> $5 (floor)
if player has no last-season auction price (e.g. waiver pickup, in-season trade, rookie not in prior league):
    keeper_cost = 5   // flat, per user's explicit rule
```

- "Last season's auction price" comes from the previous season's draft, reached via the league's `previous_league_id` chain (this league: `1257477700449214464` → its draft `1257477700449214465`), matched by player_id against that draft's picks. Confirmed this chain exists and resolves correctly for this league.
- The roster slot(s) a keeper fills for scarcity/roster-need purposes should be read from the player's actual position (e.g. Drake Maye keeper fills a QB slot), not assumed.

**Still open:** none for the mechanism itself — fully confirmed. Remaining risk is operational: keeper declarations can still change until the deadline, so the app must re-fetch `keepers` close to draft day rather than caching an early read.

**Calibration caution:** historical drafts available for this league all predate keepers. The league's economics this year (total spendable money, positional distribution) will genuinely differ from that history. Weight historical calibration constants more toward the neutral default than usual for this season specifically — see the shrinkage approach below.

## Layer 1 — Projected points → VOR — **implemented 2026-08-12** (`src/lib/scoring.ts`, `src/lib/valuation.ts`)

**Projected points:** computed from Sleeper's per-stat season projections dot-producted against this league's actual `scoring_settings` (`computeProjectedPoints`) — not Sleeper's generic `pts_ppr`/`pts_half_ppr`/`pts_std` fields, which don't reflect this league's custom rules (e.g. a 0.5/reception TE premium, non-standard yardage weights). Supported categories: `pass_yd`, `pass_td`, `pass_int`, `pass_2pt`, `rush_yd`, `rush_td`, `rush_2pt`, `rec`, `rec_yd`, `rec_td`, `rec_2pt`, `fum_lost`, `bonus_rec_te`.

**Known, deliberate limitation:** this league's scoring also includes several *per-game threshold* bonuses (`bonus_pass_yd_300/400`, `bonus_rec_yd_100/200`, `bonus_rush_yd_100/200`) and `pass_sack`. These cannot be derived from a season-total projection — you can't tell from "3650 projected passing yards over 17 games" whether any single game crossed 300. Excluded rather than approximated. Revisit only if Phase 10 backtesting shows this materially skews rankings (it's a small point contribution for most players).

**Value Over Replacement:** projected points minus a replacement-level baseline, computed per position from this league's actual roster requirements (`parseRosterRequirements`, `computeReplacementLevels`) — not a fixed guess.

**Replacement rank convention:**

QB: `teams x (starting QB slots + SUPER_FLEX slots)`, treating SUPER_FLEX as fully QB — standard for 2QB/SuperFlex leagues (this league is one), since QB scarcity typically makes a "replacement" QB2 worth more than a marginal RB/WR/TE flex play. This one is a documented assumption, not derived from data — see the QB scarcity finding below.

RB/WR/TE (**changed 2026-08-12, was a fixed guessed percentage split, now market-clearing**): rather than assuming a fixed split of the FLEX slots (the original approach guessed RB 50%/WR 40%/TE 10%), each of the `teams x FLEX slots` slots leaguewide is assigned to whichever RB/WR/TE player — beyond that position's own dedicated (non-flex) starters — has the most points, position-agnostic. Concretely: pool together everyone left over after dedicated starters are removed from each position's sorted list, sort that combined pool by points, and give the top N (N = teams × FLEX slots) to whichever positions they actually belong to. This was the user's suggestion, prompted by noticing the fixed-split version produced a ~50-point replacement-level gap between RB and WR that didn't seem justified. Confirmed empirically against this league's real 2026 projections: the market-clearing method allocated the 24 leaguewide FLEX slots as RB 1 / WR 17 / TE 6 (RB talent falls off a cliff fast beyond its dedicated starters; WR stays deep), and the resulting replacement levels landed within ~1 point of each other across RB/WR/TE (vs. a ~50-point spread under the old fixed-percentage guess). This is a more principled, self-consistent method than a guessed split and needed no external calibration data to compute — it falls out of the shape of the actual projected talent pool.

**Replacement level itself is computed over the full player pool** (including kept players) — it represents "what a typical startable/waiver-level player is worth," which doesn't change based on which specific players happen to be kept. Keepers only affect the *auction-eligible pool and spendable money* (Layer 0 / Layer 2), not the replacement-level baseline itself.

## Layer 2 — Static (pre-draft) dollar value — **implemented 2026-08-12**

Scale each non-kept player's VOR against the league's keeper-adjusted spendable auction pool:

```
spendable pool = sum(effective_team_budget) - sum(remaining_roster_slots) * $1
player static $ = max(1, round((player VOR / total VOR of available non-kept players) * spendable pool))
```

`effective_team_budget` and `remaining_roster_slots` are the Layer 0 post-keeper numbers, not the naive full-budget/full-slot numbers. Players at or below replacement level (VOR clamped to 0) get the $1 floor rather than a share of the pool. This reproduces a keeper-adjusted preseason cheat sheet and is the "pre-draft value" baseline shown to the user. Verified internally consistent: for this league, $2400 total budget − $92 total keeper cost − $186 reserved (1/remaining slot) = $2122 spendable pool, matching the app's computed output exactly.

**Empirical finding, partially improved by the market-clearing FLEX fix above (2026-08-12):** comparing this baseline's output against last season's *actual* sale prices in this same league, elite QBs sold for roughly the same price as elite RBs last year (Allen $61, Lamar $65, Daniels $61, vs. Bijan $63, Saquon $60). Under the original fixed-percentage FLEX split, this baseline put RB1 (Gibbs, $68) well above QB1 (Allen, $48) — a bigger gap than the real market showed. After switching RB/WR/TE replacement to the market-clearing method, the gap narrowed substantially (Gibbs $61 vs. Allen $52) simply as a side effect of RB/WR/TE replacement levels becoming more consistent with each other — QB wasn't touched directly. Still somewhat below the historical top-of-market pattern, and QB's own replacement convention (SUPER_FLEX = 100% QB, a fixed assumption) hasn't been re-examined the same way RB/WR/TE's was. **Still not patched with an arbitrary QB premium** — remains a candidate for Phase 9/10 to test properly (e.g., whether QB's replacement rank should also be derived some other way, rather than assumed), now a smaller gap than before but not fully explained away.

## Layer 3 — League economic tracking + inflation index — **implemented 2026-08-12** (`src/lib/economy.ts`)

Tracks what has actually happened in the live auction, on top of the Phase 2 baseline: per-team picks made/spent/remaining budget/remaining slots (`computeLeagueEconomy`), which players are gone, per-position spending and remaining VOR, and the league-wide inflation index.

```
remaining spendable pool = sum(remaining team budgets) - sum(remaining roster slots) * $1
inflation index = (remaining spendable pool / remaining rosterable VOR) / (original spendable pool / original VOR)
```

**Bug caught during verification, worth documenting so it isn't reintroduced:** the first implementation compared the *raw* sum of remaining team budgets against the *reserve-adjusted* original `spendablePool` (which already subtracts $1 per remaining slot, per Layer 2) — an apples-to-oranges comparison. This showed up as the inflation index reading ~1.09 at zero picks made, when it must be *exactly* 1.00 at that point (nothing has happened yet). Caught by deliberately checking the zero-picks case rather than only checking a populated draft. Fixed by applying the same $1/remaining-slot reserve to the remaining-money side before computing the ratio.

**Verified against real data:** a fully completed historical draft (192/192 picks, this same league's prior season) shows every team landing at exactly $0 remaining budget / 0 remaining slots, and position spending (QB $548 + RB $809 + WR $819 + TE $224) sums to exactly $2,400 — the league's full budget, dollar for dollar. The real current pre-draft league (0 picks) shows the inflation index at exactly 1.00, as it must.

**Direction, confirmed against PROJECT_SPEC's own example:** if the first five players sell for ~$100 against a $60 baseline, the league has burned a large amount of money relative to how much VOR those five players actually represented — less money remains, relative to remaining talent, than at the start. `remaining $/VOR` falls below `original $/VOR`, inflation index drops below 1, and remaining players read as *cheaper* than baseline. This is the same direction PROJECT_SPEC's own example describes ("the league has spent a huge amount of money early... the $60 value may no longer be appropriate" — implicitly cheaper, since less money is chasing the rest). Conversely, if early players go for less than baseline, more money remains relative to remaining talent, and the index rises above 1 (remaining players read as more expensive) — matching PROJECT_SPEC's second example directly. Confirmed at the two extremes (0 and 192 picks) at the time this was written; since then, confirmed against a genuinely in-progress draft too (see the mock-draft bug below), which is what this section originally flagged as still outstanding.

**Second bug caught, this one via live mock-draft testing (2026-08-12), more consequential than the first:** `remainingTotalMoney` was computed by *summing* each team's individually-tracked remaining budget, which requires correctly attributing every pick to a team via `pick.roster_id`. Real league drafts always populate this (verified). Sleeper mock drafts do not — confirmed every pick in a live test came back with `roster_id: null` — so no team's spend was ever recorded, and the league-wide "remaining money" stayed frozen at the full pre-draft total even as real picks happened. This produced a fake inflation index of **1.52** after 18 real picks, when the correct value (hand-verified from the same picks) was **1.01**. Fixed by computing `remainingTotalMoney` and `remainingSlotsTotal` directly from the full picks list/team totals rather than summing the per-team breakdown — the league-wide figure doesn't need to know *who* bought a player, only that the money is gone, so it shouldn't depend on data (`roster_id`) it doesn't actually need. Per-team figures still require valid `roster_id` and remain genuinely unknowable when the data doesn't provide it (a real, unavoidable limitation for mock-draft testing specifically) — but that limitation must not also corrupt the league-wide aggregate the way it was. Re-verified after the fix: real historical draft still shows exact $0 remaining at 192/192 picks (unchanged), and the mock draft now correctly shows $1,641 remaining money and a 1.01 inflation index.

**Important scope note on this bug:** position-specific inflation (Layer 4 below) was never affected by this — it's computed directly from `pick.metadata.position` and player VOR, never from `roster_id`. Only the league-wide aggregate (and anything falling back to it, i.e. positions with zero sales so far) was corrupted. Real draft day is unaffected either way, since real drafts have valid `roster_id`.

## Layer 4 — Positional scarcity & team needs — **implemented 2026-08-12** (`src/lib/scarcity.ts`)

**Positional inflation index — different framing than originally sketched here, for a concrete reason.** The original plan called for "the same inflation index calculation, computed per position." That doesn't actually work as written: Layer 3's index compares *remaining* money against *remaining* VOR, but money isn't earmarked by position — a team's whole budget can go to any position, so there's no real "remaining $ for RBs specifically" to use as a numerator.

What's implemented instead: for each position, compare the **actual $/VOR realized by live picks at that position so far** against the single global $/VOR ratio the entire baseline was built from (`baseline.spendablePool / baseline.totalAvailableVor` — every position shares this same ratio by construction, since Layer 2 assigns dollar value proportional to VOR with one universal constant, so there's no positional pricing built into the static baseline at all). If a position's actual realized $/VOR is running above that global ratio, it's pricing at a premium; below, a discount. Keeper costs are excluded from this (they're set by formula, not the market, and would contaminate the signal).

```
position $/VOR realized = (sum of prices paid for that position's live picks) / (sum of VOR of those same picked players)
position inflation index = position $/VOR realized / (spendablePool / totalAvailableVor)
```

**Verified against the completed historical draft:** RB inflation 1.39 (RBs went for a real premium — a well-known, widely-discussed real-market phenomenon, good sign the signal is picking up something real), WR 0.90 (ran at a discount, consistent with WR depth), QB 1.09, TE 1.06. Directionally sensible across the board.

**Team needs:** counts each team's players per position (keepers + live picks) against that position's dedicated (non-flex) starter requirement — e.g. a team with 1 RB still "needs a starter" at RB since the requirement is 2. This is a headcount estimate, not a real lineup assignment (Sleeper doesn't assign drafted players to specific roster slots during a live auction — that happens later in-season), and doesn't try to account for FLEX/SUPER_FLEX coverage, only dedicated starter slots. **Verified indirectly against real keeper data:** TE showed 11 of 12 teams still needing a starter (not 12), correctly reflecting that one team's second keeper is also a TE (2 kept TEs ≥ the 1-TE requirement) — matches what the raw keeper data implies without that being separately checked going in.

**Known simplification, not yet addressed:** late-draft $1 bench-filler picks (below replacement level, ~0 VOR) still count toward `spentAtPosition` but contribute ~0 to `vorDraftedAtPosition`, which will push the realized $/VOR ratio up mechanically as a draft nears its end, independent of any real scarcity. This is arguably a real signal too (late-draft $1 compression is a known, real fantasy-auction phenomenon), not obviously a bug — but it means the index should be read cautiously very late in a draft. Not fixed now; revisit if it turns out misleading during Phase 8 UI design or Phase 10 backtesting.

## Layer 5 — Realistic bidder count — **implemented 2026-08-12** (`src/lib/bidders.ts`)

Rule-based, not statistical (not enough data to fit a model, and rules stay explainable). For every available player, a team counts as a realistic bidder if:

1. **The team still needs that position** — reuses Phase 4's `needsStarter` check (dedicated starter slots not yet filled by keepers + live picks). A team that's already filled its starters at a position is excluded, matching the original brief's example directly: "if every team already has its starting QB except me, a QB may be much cheaper for me."
2. **The team has enough remaining budget to bid competitively** — not just *some* money left, but enough to reach the player's baseline dollar value after reserving $1 for every other remaining roster slot (the standard auction "max possible bid" formula: `remainingBudget - (remainingSlots - 1) * 1`). This single formula also captures the third original criterion ("enough roster slots that a big bid doesn't strand them elsewhere") — a team down to its last slot or two sees its max bid shrink accordingly, without a separate rule needed.

```
maxBid(team) = remainingBudget - (remainingSlots - 1) * $1   // 0 if remainingSlots <= 0
realistic bidder = needsStarter[position] AND maxBid >= player's baseline dollar value
```

The competitive-bid threshold (baseline dollar value, not some fraction of it) is a round-number default — this is the best available "expected price" reference until Phase 6 produces a true dynamic value; revisit if it turns out too strict/loose once real bidding data exists.

**Verified against the real pre-draft league:** at zero picks made, budget isn't yet a binding constraint (every team has $136+ remaining), so realistic bidder counts for top players closely track "teams needing starter" directly — RB/WR show 12/12 (everyone needs one, no money constraint yet), QB shows 10 (exactly matching Phase 4's QB teams-needing-starter count), TE shows 11 (matching Phase 4's TE count). This is expected at the very start of a draft; the budget constraint should start meaningfully diverging bidder counts from raw need-counts once real money gets spent — worth re-checking once the actual 2026 draft is underway.

## Layer 6 — Combining everything into a live value — **implemented 2026-08-12** (`src/lib/dynamicValue.ts`)

Combines every prior layer into current value, expected price, a range, a recommended max, and a buy/neutral/overpay call, per player.

**Current value** = static baseline (Layer 2) × a combined inflation index. This went through two real design revisions, both prompted by the user during live mock-draft testing, both checked against the Phase 10 backtest rather than adopted on reasoning alone.

**Revision 1 (original, 2026-08-12):** position-specific index *in place of* league-wide when available, falling back to league-wide only for positions with zero live picks. Reasoning at the time: multiplying both risked double-counting the same signal.

**Revision 2 (2026-08-12, same day, superseded above):** during live mock-draft testing, user pointed out a real flaw: an all-or-nothing switch means a single outlier sale (e.g. a $60-baseline RB1 selling for $30) makes the model treat *every remaining player at that position* as uniformly discounted — but that $30 in "savings" doesn't vanish, it's still in the pool and will get spent on *something*, which is a league-wide signal the switch was throwing away the moment any position had even one sale. Redesigned as **multiplicative, with league-wide always active**, and the position term dampened by how much real data supports it:

```
weight = salesAtPosition / (salesAtPosition + 4)
combinedIndex = leagueIndex * positionIndex^weight   // positionIndex^weight -> 1 (neutral) as weight -> 0
```

At 1 sale the position term is barely expressed (0.8^0.2≈0.96); at 4 sales half-expressed; at 16+ sales it converges to a plain multiply (`leagueIndex * positionIndex`), which is also exactly the simple formula the user proposed for the "lots of data" case. League-wide's influence never fully vanishes at any finite sample size, addressing the user's core objection directly.

**Checked against the Phase 10 backtest, not just reasoned about — and the result was genuinely mixed, not a clean win:**

| | Revision 1 (in-place-of) | Revision 2 (multiplicative) |
|---|---|---|
| Overall MAE / MAPE / Corr | $4.34 / 48% / 0.93 | $3.85 / 67% / 0.96 |
| QB MAE / Corr | $8.45 / 0.90 | **$5.30 / 0.96** (clear improvement) |
| WR MAE / Corr | $4.18 / 0.93 | **$2.86 / 0.97** (clear improvement) |
| RB MAE / MAPE | $3.16 / 58% | $4.32 / **105%** (regression) |
| TE MAE / MAPE | $2.38 / 43% | $3.62 / 72% (regression) |

Diagnosis: RB and TE both carry a lot of near-replacement bench players sitting at the $1-2 floor. With league-wide now *always* multiplying in (this draft's league-wide index ran hot most of the way through), those already-cheap players get nudged up a little — trivial in absolute dollars, but a huge *percentage* swing on a $1-2 baseline, which is exactly what inflated MAPE without meaningfully hurting MAE.

**Revision 3, the fix actually shipped:** skip the dynamic multiplier entirely for near-replacement players (baseline value ≤ **$5**) — for these, `currentValue = expectedPrice = baseline value` unchanged, on the theory that real bidding for deep bench/waiver-tier players is governed by the $1-minimum-bid mechanic, not broader market inflation. Tested thresholds of $3 and $5 against the backtest before settling on $5 (diminishing returns beyond that — see commit history/session notes, not re-litigated here):

| | Revision 2 (no exclusion) | + exclude ≤$3 | + exclude ≤$5 (shipped) |
|---|---|---|---|
| Overall MAE / MAPE / Corr | $3.85 / 67% / 0.96 | $3.82 / 56% / 0.96 | **$3.80 / 53% / 0.96** |
| RB MAPE | 105% | 81% | **78%** |
| TE MAPE | 72% | 63% | **56%** |

Final result vs. the original Revision 1: MAE and correlation are better across the board (overall MAE $4.34→$3.80, correlation 0.93→0.96), overall MAPE is close to parity (48%→53%), QB and WR are clearly better, and RB/TE — while still not fully back to their Revision 1 numbers — are far better than the intermediate multiplicative-only version. **Stopped tuning the threshold deliberately at $5** rather than continuing to chase RB/TE parity: each further nudge fits more specifically to this one 2025 draft, which is the exact overfitting risk this project has tried to avoid everywhere else. Verified this doesn't just look good on paper: sanity-checked against the live mock draft too, values move by small, plausible amounts rather than swinging wildly.

**Expected price** = current value × a bidder-count price factor.

**Real bug caught and fixed during verification, worth documenting in full:** the first version treated a *fixed* "2 realistic bidders = neutral" reference point, on the theory that auction price roughly converges near the 2nd-highest true valuation. This completely broke in practice: at the start of a draft, every team has a fresh budget and open roster spots, so realistic bidder counts sit high (10-12) for nearly *every* player — a fixed low reference flagged almost the entire 102-player available pool as OVERPAY, which isn't a useful signal (it doesn't differentiate between players, it just restates "this is early in the draft"). Fixed by comparing each player's bidder count against a **per-position reference: the median bidder count among currently-available players at that position**, not a fixed number. This correctly produces uniform NEUTRAL across the board at zero picks made (verified: every player within a position genuinely has the *same* bidder count that early, since budget isn't remotely a binding constraint yet at $200 vs. even a $61 top player) — real differentiation should emerge once picks start happening and team budgets/needs diverge from each other. This hasn't been directly observed against a genuinely varied mid-draft state yet (only inferred from already-validated component logic); worth a spot check once the real 2026 draft is underway.

```
bidder price factor = clamp(1 + 0.05 * (bidderCount - positionMedianBidderCount), 0.6, 1.4)
expected price = round(currentValue * bidder price factor)
```

**Recommended max** = current value itself — don't pay more than what the player is actually worth, regardless of what the market is expected to do. Matches PROJECT_SPEC's original worked example directly (recommended max = "current model value").

**Recommendation**: BUY if expected price is >5% below current value (market likely underpricing relative to your own valuation), OVERPAY if >5% above, else NEUTRAL.

**Range** — heuristic, not simulation (see [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) for why Monte Carlo is deferred). Unlike the price factor above, range width uses the player's **absolute** bidder count, not the position-relative one — more parties competing means more outcome uncertainty regardless of whether that count happens to be typical for the position right now.

```
spread = 0.15 + min(0.03 * bidderCount, 0.25)
range = [round(expectedPrice * (1 - spread)), round(expectedPrice * (1 + spread))]
```

No separate "aggressive ceiling" beyond the range's upper bound (PROJECT_SPEC's original example had one) — merged into range-high for V1 simplicity.

All of the above are round-number heuristic constants, not calibrated against real data — label this range explicitly as heuristic in the UI, don't imply simulated statistical confidence it doesn't have. Prime candidates for Phase 9/10 calibration once real draft-day outcomes exist.

## Historical calibration (avoiding overfitting) — **implemented 2026-08-12** (`src/lib/historicalAccuracy.ts`)

- The Layer 1–5 formula must produce reasonable output with **zero** historical data — that's the always-available baseline.
- Historical drafts (pulled from Sleeper via `previous_league_id` chain, if available) are used only to tune a small number of interpretable constants (e.g. how strongly bidder count moves price), never to fit an opaque model.
- Use shrinkage: blend the league-specific observed pattern with a neutral default, weighted by how much history exists. 1-2 drafts should barely move the constant away from default.
- Do not attempt to fit a predictive model (regression, ML) on this data — the sample size cannot support it and it would break explainability.

**How much history actually exists — checked, not assumed:** this league's `previous_league_id` chain goes back to 2023, but only the 2025 season is structurally comparable — 2023 and 2024 both used a single-QB format with K/DEF roster slots (14 total slots), while 2025 switched to the current 2QB/SuperFlex, no-K/DEF, 16-slot format the same as 2026. Mixing incompatible formats into "historical data" would corrupt the comparison, not calibrate it. `sameRosterFormat()` checks this explicitly and excludes non-matching seasons rather than silently including them. Net result: genuinely **one** usable historical draft (2025) — which strongly reinforces the shrinkage principle above; there's no realistic way one draft justifies moving a constant far from its default.

**What was actually run:** applied the static baseline methodology (Layers 1-2 — VOR, replacement level, dollar conversion) to 2025's real projections and league settings, and compared the resulting predicted dollar values against that season's actual sale prices (192 real picks). Results:

| Position | Picks | MAE | MAPE | Correlation |
|---|---|---|---|---|
| Overall | 192 | $4.56 | 52% | 0.91 |
| QB | 33 | $8.21 | 58% | **0.89** |
| RB | 62 | $3.81 | 70% | 0.97 |
| WR | 71 | $4.68 | 38% | 0.91 |
| TE | 26 | $1.42 | 40% | **0.98** |

All 192 picks matched to a projected player (no exclusions). RB and TE show excellent correlation (0.97, 0.98) with low MAE — good quantitative validation that the market-clearing FLEX fix (Layer 1) is working well. **QB is the clear weak point**: lowest correlation (0.89) and highest MAE ($8.21) of any position.

**Drilled into the QB numbers pick-by-pick, not just the summary stats — this revealed the finding is sharper than "QBs are undervalued."** Mean signed error (actual − predicted) across all 33 QB picks is only +$1.06, which looks like a small, unremarkable bias — but that average is flattening two opposite effects:

| Tier | n | Mean (actual − predicted) |
|---|---|---|
| Top 6 QBs by predicted value | 6 | **+$7.50** |
| Remaining 21 QBs | 21 | **−$2.62** |

The top 6 (Lamar Jackson, Josh Allen, Jayden Daniels, Jalen Hurts, Joe Burrow, Patrick Mahomes) *all* sold for $19-$31 more than predicted individually. Below that tier, most QBs sold for at or below prediction, several cratering toward the $1 floor while the model still expected real value (e.g. Trevor Lawrence and Jared Goff both predicted ~$16-17, actually sold for $6 and $5).

This confirms the specific mechanism hypothesized back in Layer 1/2, not just the general direction: real 2QB-league demand creates a sharp scarcity **cliff** at the boundary of "clearly startable" QBs, which smooth points-based VOR doesn't capture — it's not a uniform undervaluation, it's a shape problem concentrated entirely at the tier boundary. A single "shift QB values up" adjustment would be the wrong fix; it would overcorrect the bottom tier, which is already priced about right (or slightly high).

**Decision: still not patched.** This isn't a "constant to nudge via shrinkage" the way the FLEX split was — the fix here would need to change the *shape* of the QB value curve near the replacement cliff (e.g. a steeper drop-off right at the startable/non-startable boundary), not a single tunable number, and one data point isn't enough to design that responsibly. Documented here as a precise, evidence-based target for Phase 9/10 revisit once real 2026 draft-day data provides a second data point — see ROADMAP.md.

## Evaluation / backtesting — **implemented 2026-08-12** (`src/lib/backtest.ts`)

Primary metric: mean absolute error (and % error) between predicted dynamic value and actual sale price, computed by replaying a real historical draft pick-by-pick through the engine. Use this to validate any formula or constant change before trusting it — don't tune by feel.

**Point-in-time replay, unlike Phase 9's static comparison:** at each pick, only picks strictly *before* it are known — exactly like a real live draft, no hindsight. Three tiers compared against actual sale price: (1) static baseline only, (2) + league-wide inflation only, (3) full model (+ positional scarcity + bidders). Run against the same 2025 draft used in Phase 9 (still the only structurally comparable historical draft — see above).

**Overall results:**

| Tier | MAE | MAPE | Correlation |
|---|---|---|---|
| Static baseline only | $4.56 | 52% | 0.91 |
| + League-wide inflation only | $4.36 | 72% | 0.96 |
| Full model | $4.34 | 48% | 0.93 |

Full model beats static on all three metrics (modestly on MAE). It does *not* cleanly beat the middle "inflation-only" tier — worse correlation (0.93 vs 0.96), though much better MAPE (48% vs 72%). Not a clean "more complexity wins" story, and reported as such rather than spun positive.

**Full model, by position — this is where it gets specific and useful:**

| Position | Static MAE / Corr | Full Model MAE / Corr | Verdict |
|---|---|---|---|
| QB | $8.21 / 0.89 | $8.45 / 0.90 | Roughly a wash — as expected, the position-inflation/bidder layers don't fix the QB cliff (Layer 2 finding above); that needs a shape change, not a scaling adjustment |
| RB | $3.81 / 0.97 | $3.16 / 0.96 | Clear improvement |
| WR | $4.68 / 0.91 | $4.18 / 0.93 | Clear improvement |
| TE | $1.42 / 0.98 | $2.38 / 0.97 | **Got worse** |

**TE getting worse is a real, specific, mechanistically-understood finding, not noise to shrug off:** TE has only 26 total picks in the entire draft — the fewest of any position. Early in a point-in-time replay, Layer 4's "actual $/VOR realized so far" for TE is often computed from just 1-2 picks, an inherently volatile small-sample estimate that then gets applied to every remaining TE valuation. TE had the *best* static accuracy to start (correlation 0.98) — the dynamic adjustment is actively hurting an already well-calibrated position because its own input signal is too thin to trust yet.

**Well-motivated candidate for future work, not implemented now:** shrink the position-specific inflation index toward the league-wide index when few picks have happened at that position yet (e.g. weight by sample size), rather than trusting a 1-2-pick ratio as fully reliable. This is a concrete, evidence-backed idea — but still only supported by one draft's worth of replay data, so it stays a documented candidate (see IDEAS.md) rather than something to build now, consistent with the project's shrinkage philosophy above.

**Conclusion, per ROADMAP's own test ("if the complicated model doesn't beat the simple ones, don't use it"):** the full model earns its complexity for RB and WR. For QB, the added layers are neutral — harmless but not curative. For TE, they currently hurt. This is exactly the kind of honest, position-specific signal Phase 10 was meant to surface, and it's more useful than a single aggregate "the model works" verdict would have been.

## Explicitly deferred (see [IDEAS.md](IDEAS.md))

- Monte Carlo simulation of auction outcomes.
- Behavioral/strategy inference per manager (stars-and-scrubs detection, year-over-year behavior shift modeling).
- Any statistical/ML model of bidder behavior.
