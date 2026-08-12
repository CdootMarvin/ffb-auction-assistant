# Roadmap

Twelve phases, each earning its way to the next. Do not skip ahead — the temptation with AI-assisted coding is to jump straight to the exciting parts (simulation, live dynamic values); the plan is deliberately structured to prove each layer works before building the next one on top of it. The most important checkpoint is Phase 2 → Phase 3: get a defensible static valuation first, then prove that live adjustments actually improve on it.

```
Phase -1   "What should we build?"
Phase 0-1  "Can we reliably get the draft data?"
Phase 2    "What are players theoretically worth?"
Phase 3-5  "What is happening in THIS auction?"
Phase 6    "What are players worth RIGHT NOW?"
Phase 7    "What's the likely range of outcomes?"
Phase 8    "What should I actually do with that information?"
Phase 9-10 "Does this thing actually work?"
Phase 11   "Make it bulletproof for draft day."
```

---

## Phase -1 — Architecture & Design Meeting — **DONE (2026-08-12)**

Decided the product vision, compared browser/desktop/hybrid architectures, designed the layered valuation approach, addressed overfitting, defined how ranges should work, produced the initial project documents. See [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) for the record of decisions made.

## Phase 0 — Project Setup — **IN PROGRESS**

Goal: create the skeleton.

- [x] Create project documentation (`PROJECT_SPEC.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `DESIGN_DECISIONS.md`, `MODELING.md`, `CONTRIBUTING.md`, `IDEAS.md`).
- [ ] Create GitHub repository.
- [ ] Set up chosen technology stack (Vite + React + TypeScript).
- [ ] Set up development environment.
- [ ] Set up deployment (GitHub Pages).
- [ ] Get a trivial version running end-to-end (proves the $0 pipeline works before any real feature is built on top of it).

**Already validated empirically ahead of schedule** (normally Phase 1 groundwork, pulled forward during the Phase -1 discussion since real league data was available): Sleeper API confirmed reachable server-side; real league settings, roster requirements, budget, and draft info confirmed for league `1389362840074199040`; undocumented projections endpoint confirmed working with real data; keeper mechanism and cost formula confirmed against the real league. See [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) for details.

**Still outstanding, carries into Phase 0/1:**
- Confirm Sleeper API (including the projections endpoint) permits direct browser `fetch` — only tested server-side so far.
- Confirm Sleeper's rate limits comfortably support polling every few seconds during a live draft.

Success: you can open the app and know the development/deployment pipeline works.

## Phase 1 — Sleeper Integration

Goal: get the live draft data flowing.

- Connect to Sleeper; identify the league (`1389362840074199040`) and users/teams.
- Retrieve rosters — including each team's `keepers` array (native Sleeper field, confirmed present).
- Retrieve draft information (draft `1389362840074199041`, auction type, $200/team, 16 rounds, 2QB/SuperFlex).
- Detect new auction purchases via polling `/draft/{id}/picks`.
- Track winning prices.
- Update the application as the draft progresses.

Note: this phase retrieves keeper *data* (who's kept). Computing keeper *cost* and the resulting post-keeper starting budget/pool is Phase 2's job, since that's where "value before the auction" is actually produced.

Success: you can watch your actual auction happening inside the application.

## Phase 2 — Baseline Player Values

Goal: establish the "before the auction" value. Don't try to be clever yet — a solid static baseline first.

- Player projections (Sleeper's undocumented projections endpoint, primary; CSV import fallback).
- Fantasy points → Value Over Replacement, with replacement levels derived from this league's actual roster requirements (2QB/SuperFlex changes QB replacement level significantly — don't use single-QB assumptions).
- Convert VOR into auction dollars against the league's spendable pool.
- **Keeper-adjusted starting state** ([MODELING.md](MODELING.md) Layer 0): apply each team's keeper cost (last season's price × 1.2, rounded to nearest dollar, min $5, or flat $5 with no prior price) against their budget, remove kept players from the pool, and subtract the roster slots they fill — *before* computing the displayed baseline. There is no clean pre-keeper baseline this year; this step is not optional.
- Account for league settings throughout (budget, roster requirements, 2QB/SuperFlex).

**Sanity-check backtest (lightweight, not the full Phase 10 suite):** once this baseline exists, spot-check it against last season's actual sale prices (same league, pre-keeper era) — does the static VOR ranking roughly track actual relative prices? This is a cheap early warning if the VOR/replacement-level math is fundamentally off, before any dynamic machinery gets built on top of it.

## Phase 3 — League Economic Model

Goal: understand what has happened to the auction economy. After every purchase, track:

- Dollars remaining by team, total dollars remaining.
- Roster spots remaining, players remaining.
- Spending relative to baseline.
- Inflation/deflation — the league-wide (remaining $ / remaining VOR) index vs. the original ratio ([MODELING.md](MODELING.md) Layer 3).
- Position-specific spending, remaining projected production.

Answers: "What does the auction economy look like right now?"

## Phase 4 — Positional Scarcity & Team Needs

Goal: understand supply and demand.

- Teams still needing QB/RB/WR/TE/etc. (2QB/SuperFlex means QB need is structurally higher than a single-QB league).
- Remaining players at each position, weighted by quality (remaining VOR at that position, not raw headcount — a position with 5 remaining scrubs is not the same scarcity picture as 5 remaining starters).
- Roster slots available, position-specific scarcity index ([MODELING.md](MODELING.md) Layer 4), team-specific needs.

Answers: "Which positions are becoming expensive, and why?"

## Phase 5 — Realistic Bidder Model

Goal: figure out who can actually compete for a player. Rule-based, not statistical ([MODELING.md](MODELING.md) Layer 5) — not enough historical data for a fitted model, and rules stay explainable.

For every remaining player, estimate which teams need that position, can afford it, have competing roster priorities, and how many legitimate bidders remain.

Moves us from "this player is worth $40" to "this player is worth $40, but only two teams are likely to bid aggressively, so the expected price is probably lower."

## Phase 6 — Dynamic Auction Values

Goal: combine everything into a live value. Baseline (Phase 2) + league economics (Phase 3) + positional scarcity (Phase 4) + team needs + realistic bidders (Phase 5) → current value, expected auction price, recommended maximum, buy/neutral/overpay zones. This is the heart of the product.

## Phase 7 — Auction Simulation

Goal: replace arbitrary multipliers with probability/distributions, **only if justified**. Investigate Monte Carlo simulation as a way to produce expected price / likely range / 90th-percentile ceiling instead of a hand-picked multiplier.

**Gate:** do not build this until Phase 10 backtesting shows the deterministic/heuristic model (Phases 2–6) has a real, measurable shortfall that simulation would fix. Simulating from uncalibrated guesses produces false statistical confidence, not more accuracy — see [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md). If testing shows simulation doesn't improve predictions, don't build it.

## Phase 8 — Decision Interface

Goal: make the information useful during a frantic auction. Answer "should I bid, and how high" at a glance: current value, expected price, range, your max, demand, remaining bidders, recommendation (buy/neutral/overpay), and the plain-language "why" behind any value change.

## Phase 9 — Historical Data & Calibration

Goal: make the model better without overfitting. Bring in historical auction results (this league's prior season, via `previous_league_id`) to investigate prediction accuracy, position-specific systematic behavior, and persistent league tendencies — blended with the general model via shrinkage, not trained from scratch on 1-2 drafts. See [MODELING.md](MODELING.md) calibration section.

**Caveat specific to this league:** all available historical data predates keepers. This season's economics will genuinely differ. Lean harder toward the neutral default than the shrinkage approach would normally suggest for an established non-keeper league.

## Phase 10 — Backtesting

Goal: prove whether this actually works, as honestly as the data allows. Replay historical auctions pick-by-pick, predicting at each point without hindsight, and compare predicted vs. actual price. Compare the full model against simpler baselines (static cheat sheet, simple inflation-only, VOR alone) — if the complicated model doesn't beat the simple ones, don't use the complicated model.

**Honest limitation:** with only one clean pre-keeper historical draft realistically available for this league, this is not a rigorous held-out validation (Phase 9 calibration and Phase 10 testing would draw on the same limited data) — treat this phase as a sanity/regression check rather than proof, and don't let a good backtest result on thin data justify more model complexity than the data can actually support.

## Phase 11 — Draft-Day Polish

Goal: make it rock-solid for the actual draft. Performance, mobile/laptop usability, error handling, connection recovery, draft pause/reconnect, clear alerts, fast updates, manual override, local persistence, backup state. On draft day, the technology should be invisible.

---

## Explicitly postponed beyond Phase 11 (see [IDEAS.md](IDEAS.md) for the full parking lot)

- Behavioral/strategy inference per manager.
- Multi-league or cross-league historical calibration.
- League-wide sharing / multi-user.
- Offline support / PWA.
- Mobile-optimized UI polish (responsive is in scope; mobile-first polish is not).

## How this roadmap is used

Each future coding session implements exactly one phase (or a clearly-scoped slice of one), per the workflow in [CONTRIBUTING.md](CONTRIBUTING.md). Update this file's checkboxes/status as work completes. Don't jump ahead to a later phase without finishing and validating the current one — per Phase -1's own conclusion, simple + reliable + explainable beats complex + theoretically perfect, and complexity should be earned with evidence (Phase 10), not assumed upfront.
