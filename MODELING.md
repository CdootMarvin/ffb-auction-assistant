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

## Layer 1 — Projected points → VOR

Value Over Replacement: projected fantasy points minus a replacement-level baseline. Replacement level is derived from the league's actual roster requirements (team count × starting slots at each position, including flex allocation), not a fixed guess — pull real settings from the Sleeper league object rather than hardcoding.

## Layer 2 — Static (pre-draft) dollar value

Scale each player's VOR against the league's total spendable auction pool:

```
spendable pool = (teams * budget per team) - (total remaining bench/reserve slots league-wide * $1 minimum bid)
player static $ = (player VOR / total VOR of rosterable players) * spendable pool
```

This reproduces a normal preseason cheat sheet and is the "pre-draft value" baseline shown to the user.

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
