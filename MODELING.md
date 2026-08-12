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

## Layer 3 — Dynamic re-scaling (inflation index)

The core mechanism for tracking mid-draft value change. Recompute Layer 2 using **remaining** money and **remaining** VOR instead of preseason totals:

```
inflation index = (remaining league $ / remaining rosterable VOR) / (original $ / original VOR)
dynamic value (pre-scarcity) = static value * inflation index
```

If early players go for more than projected, remaining $/VOR drops relative to original → index < 1 isn't right, walk through the direction carefully when implementing: overspending early means *less* money remains relative to remaining talent, so remaining players' dynamic value should fall, and vice versa. Verify the sign empirically against a real backtest before trusting it.

## Layer 4 — Positional scarcity adjustment

Same inflation index calculation, computed **per position** instead of league-wide, since money-to-talent ratios diverge by position as a draft progresses (e.g. RBs drying up faster than WRs). Apply the positional index on top of (or in place of, needs empirical testing) the league-wide index for that player's position.

## Layer 5 — Realistic bidder count

Rule-based, not statistical (not enough data to fit a model, and rules stay explainable). A team counts as a realistic bidder for a player if:
- The team still needs that position (open starting slot, or a clear roster gap).
- The team has enough remaining budget to bid competitively (not just technically enough — enough after reserving $1 per remaining unfilled slot besides this one).
- The team has enough remaining roster slots that committing a large bid here doesn't strand them elsewhere.

Output: a bidder count per player. Used to adjust the point estimate and to widen/narrow the range (more realistic bidders → price pushed up and range widens toward the ceiling).

## Layer 6 — Range, not just a point estimate

V1 approach: heuristic range, not simulation (see [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) for why Monte Carlo is deferred). Range width driven by:
- Realistic bidder count (more bidders → wider, higher-skewed range).
- Observed historical prediction error for players in that value tier, once backtest data exists.

Label this range explicitly as heuristic in the UI — don't imply simulated statistical confidence it doesn't have.

## Historical calibration (avoiding overfitting)

- The Layer 1–5 formula must produce reasonable output with **zero** historical data — that's the always-available baseline.
- Historical drafts (pulled from Sleeper via `previous_league_id` chain, if available) are used only to tune a small number of interpretable constants (e.g. how strongly bidder count moves price), never to fit an opaque model.
- Use shrinkage: blend the league-specific observed pattern with a neutral default, weighted by how much history exists. 1-2 drafts should barely move the constant away from default.
- Do not attempt to fit a predictive model (regression, ML) on this data — the sample size cannot support it and it would break explainability.

## Evaluation / backtesting

Primary metric: mean absolute error (and % error) between predicted dynamic value and actual sale price, computed by replaying a real historical draft pick-by-pick through the engine. Use this to validate any formula or constant change before trusting it — don't tune by feel.

## Explicitly deferred (see [IDEAS.md](IDEAS.md))

- Monte Carlo simulation of auction outcomes.
- Behavioral/strategy inference per manager (stars-and-scrubs detection, year-over-year behavior shift modeling).
- Any statistical/ML model of bidder behavior.
