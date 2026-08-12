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

## Phase 0 — Project Setup — **DONE (2026-08-12)**

Goal: create the skeleton.

- [x] Create project documentation (`PROJECT_SPEC.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `DESIGN_DECISIONS.md`, `MODELING.md`, `CONTRIBUTING.md`, `IDEAS.md`).
- [x] Create GitHub repository — public, [github.com/CdootMarvin/ffb-auction-assistant](https://github.com/CdootMarvin/ffb-auction-assistant).
- [x] Set up chosen technology stack (Vite + React + TypeScript).
- [x] Set up development environment (`npm run dev`; project-local `ffb-dev` launch config added to the shared `C:\Claude\.claude\launch.json` alongside the unrelated `claymont-estates-test` entry, additive only).
- [x] Set up deployment (GitHub Actions → GitHub Pages, deploys on every push to `main`).
- [x] Get a trivial version running end-to-end — confirmed live at [cdootmarvin.github.io/ffb-auction-assistant](https://cdootmarvin.github.io/ffb-auction-assistant/), verified in-browser (correct title, no console errors, current build's asset hashes served, not a stale cache).

**Already validated empirically ahead of schedule** (normally Phase 1 groundwork, pulled forward during the Phase -1 discussion since real league data was available): Sleeper API confirmed reachable server-side; real league settings, roster requirements, budget, and draft info confirmed for league `1389362840074199040`; undocumented projections endpoint confirmed working with real data; keeper mechanism and cost formula confirmed against the real league. See [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) for details.

**Still outstanding, carries into Phase 0/1:**
- Confirm Sleeper API (including the projections endpoint) permits direct browser `fetch` — only tested server-side so far.
- Confirm Sleeper's rate limits comfortably support polling every few seconds during a live draft.

Success: you can open the app and know the development/deployment pipeline works.

## Phase 1 — Sleeper Integration — **DONE (2026-08-12)**

Goal: get the live draft data flowing.

- [x] Connect to Sleeper; identify the league and users/teams (`src/lib/sleeperApi.ts`, `src/lib/sleeperTypes.ts` — types verified against real raw JSON, not paraphrased summaries).
- [x] Retrieve rosters — including each team's `keepers` array.
- [x] Retrieve draft information (auction type, budget, rounds all read from the real league/draft objects, not hardcoded).
- [x] Detect new auction purchases via polling `/draft/{id}/picks` every 3s (`src/hooks/useDraftPicks.ts`).
- [x] Track winning prices (`pick.metadata.amount`).
- [x] Update the application as the draft progresses — basic UI in `src/App.tsx`: connect form, teams table with keeper counts, live picks feed.

**Verified in-browser**, not just built: connected to last season's *completed* draft (192 real picks, correct names/prices/positions/buyer resolution) and to the real current *pre-draft* league (correct keeper counts per team, empty picks list handled cleanly). **Resolved the one open Phase 0 question**: direct browser `fetch` to the Sleeper API works with no CORS issues — confirmed with real network activity, not just a server-side check.

**Discovery that simplifies later phases:** each pick's `metadata` already includes the player's name/position/NFL team, so Phase 1 never needed Sleeper's large (5MB+) full player database. That fetch (needed for *remaining*/undrafted players) is deferred to whenever Phase 2 actually needs it, not pulled preemptively.

Note: this phase retrieves keeper *data* (who's kept). Computing keeper *cost* and the resulting post-keeper starting budget/pool is Phase 2's job, since that's where "value before the auction" is actually produced.

Success: you can watch your actual auction happening inside the application. Confirmed.

## Phase 2 — Baseline Player Values — **DONE (2026-08-12)**

Goal: establish the "before the auction" value. Don't try to be clever yet — a solid static baseline first.

- [x] Player projections — Sleeper's undocumented projections endpoint (`src/lib/sleeperApi.ts` `getProjections`, localStorage-cached, ~2.9MB for QB/RB/WR/TE). CSV fallback not built (not needed — primary path confirmed working); remains a documented fallback option only.
- [x] Fantasy points → Value Over Replacement (`src/lib/scoring.ts`, `src/lib/valuation.ts`), replacement levels derived from this league's real roster requirements including its 2QB/SuperFlex structure — see [MODELING.md](MODELING.md) Layer 1 for the exact convention used.
- [x] Convert VOR into auction dollars against the league's spendable pool ([MODELING.md](MODELING.md) Layer 2).
- [x] **Keeper-adjusted starting state** ([MODELING.md](MODELING.md) Layer 0) — implemented and verified: keeper costs computed from real prior-season prices, subtracted from each team's effective budget, kept players and their roster slots removed before the baseline is computed.
- [x] Account for league settings throughout — budget, roster requirements, and scoring all read from the real league/draft objects, not hardcoded.

**Verified in-browser** against the real current league: math is internally consistent (spendable pool $2,122 = $2,400 total budget − $92 total keeper cost − $186 reserved slots, matches exactly), 102 players computed above replacement level, sensible-looking value ordering.

**Sanity-check backtest — done, and it surfaced something real:** compared against last season's actual sale prices in this league. Elite QBs initially came out significantly cheaper relative to elite RBs than the real market bore out last year. Investigating why led to a genuine methodology fix, not a guessed patch: replacement level for RB/WR/TE originally used a fixed guessed FLEX-slot split (RB 50%/WR 40%/TE 10%), which produced a ~50-point gap between RB and WR replacement level that didn't hold up under scrutiny (user's suggestion). Replaced with a market-clearing allocation (FLEX slots go to whichever RB/WR/TE player has the most points, position-agnostic) — confirmed empirically to equalize RB/WR/TE replacement levels within ~1 point of each other and to narrow the QB-vs-RB pricing gap as a side effect. See [MODELING.md](MODELING.md) Layer 1. QB's own replacement convention (SUPER_FLEX = 100% QB) is unchanged and remains a flagged item for Phase 9/10.

## Phase 3 — League Economic Model — **DONE (2026-08-12)**

Goal: understand what has happened to the auction economy. After every purchase, track:

- [x] Dollars remaining by team, total dollars remaining (`src/lib/economy.ts` `computeLeagueEconomy`, wired into the Team Budgets table live).
- [x] Roster spots remaining, players remaining (drafted players removed from the "available" baseline table).
- [x] Spending relative to baseline — per-position spending tracked; per-player over/under baseline comparison deferred to Phase 6/8 (needs the "why" framing, not just raw tracking).
- [x] Inflation/deflation index ([MODELING.md](MODELING.md) Layer 3).
- [x] Position-specific spending, remaining projected VOR by position.

**Verified against real data, including a bug caught and fixed:** a completed historical draft (192/192 picks) shows exact conservation — every team lands at $0/0 slots remaining, and position spending sums to exactly $2,400 (the full league budget). The real pre-draft league (0 picks) initially showed the inflation index at 1.09 instead of the required 1.00 — caught by deliberately checking the zero-picks edge case, traced to comparing a reserve-adjusted number against a non-adjusted one, fixed, now reads exactly 1.00. See [MODELING.md](MODELING.md) Layer 3 for the full writeup, including a documented open question: the inflation index's direction has only been checked at the two extremes (0 and 192 picks), not against a genuinely in-progress draft, since the real 2026 draft hasn't started yet.

Answers: "What does the auction economy look like right now?"

## Phase 4 — Positional Scarcity & Team Needs — **DONE (2026-08-12)**

Goal: understand supply and demand.

- [x] Teams still needing QB/RB/WR/TE/etc. (`src/lib/scarcity.ts` `computeTeamPositionNeeds` — headcount vs. dedicated starter requirement, keepers + live picks).
- [x] Remaining players at each position, weighted by quality (remaining VOR, from `computePositionScarcity`, not raw headcount).
- [x] Position-specific scarcity index ([MODELING.md](MODELING.md) Layer 4 — reworked from the original per-position-inflation sketch, which didn't actually work since money isn't earmarked by position; replaced with actual-$/VOR-realized-so-far vs. the global baseline ratio).

**Verified against real data:** the completed historical draft shows directionally sensible position pricing (RB 1.39x premium, WR 0.90x discount, QB 1.09x, TE 1.06x) — RB running hot and WR running cool matches well-known real fantasy-market behavior. Team-needs counts verified indirectly against real keeper data (TE correctly shows 11/12 teams needing a starter, reflecting one team's second keeper also being a TE).

**Known simplification, documented not fixed:** late-draft $1 bench picks mechanically push the position pricing ratio up since they add to $ spent but ~0 to VOR drafted — plausibly a real signal (well-known $1 compression phenomenon) rather than a bug, but should be read cautiously very late in a draft.

Answers: "Which positions are becoming expensive, and why?"

## Phase 5 — Realistic Bidder Model — **DONE (2026-08-12)**

Goal: figure out who can actually compete for a player. Rule-based, not statistical ([MODELING.md](MODELING.md) Layer 5) — not enough historical data for a fitted model, and rules stay explainable.

- [x] For every remaining player, estimate which teams need that position (`src/lib/bidders.ts`, reuses Phase 4's `needsStarter`), can afford it competitively (max-bid formula against the player's baseline value), and how many legitimate bidders remain. The "enough roster slots left" criterion folds into the max-bid formula rather than needing a separate rule.
- [x] Wired into the Baseline Player Values table as a "Realistic Bidders" column.

**Verified against the real pre-draft league:** bidder counts for top players track "teams needing starter" closely at zero picks made (budget isn't binding yet) — QB shows exactly 10, TE exactly 11, matching Phase 4's counts. Budget constraints should meaningfully diverge bidder counts from raw need-counts as real money gets spent; not yet observed against an in-progress draft.

Moves us from "this player is worth $40" to "this player is worth $40, but only two teams are likely to bid aggressively, so the expected price is probably lower."

## Phase 6 — Dynamic Auction Values — **DONE (2026-08-12)**

Goal: combine everything into a live value. Baseline (Phase 2) + league economics (Phase 3) + positional scarcity (Phase 4) + team needs + realistic bidders (Phase 5) → current value, expected auction price, recommended maximum, buy/neutral/overpay zones ([MODELING.md](MODELING.md) Layer 6, `src/lib/dynamicValue.ts`). This is the heart of the product.

**Real bug caught and fixed during verification:** the first version used a fixed "2 bidders = neutral" reference for the price-adjustment factor, which broke completely at the start of a draft (every player showed OVERPAY, since realistic bidder counts sit high for everyone when budgets are fresh — no differentiation, a useless signal). Fixed by comparing each player's bidder count against the median for currently-available players at that position, not a fixed number. Verified: correctly shows uniform NEUTRAL at zero picks made (genuinely no differentiating signal exists yet, confirmed this is real not a bug — every player in a position really does have the same bidder count this early), and range math checks out exactly by hand (e.g. $61 value, 12 bidders → spread 0.40 → range $37-$85, confirmed). Not yet observed against a genuinely varied mid-draft state — only inferred from already-validated component layers; worth a spot check once the real 2026 draft is underway.

## Phase 7 — Auction Simulation

Goal: replace arbitrary multipliers with probability/distributions, **only if justified**. Investigate Monte Carlo simulation as a way to produce expected price / likely range / 90th-percentile ceiling instead of a hand-picked multiplier.

**Gate:** do not build this until Phase 10 backtesting shows the deterministic/heuristic model (Phases 2–6) has a real, measurable shortfall that simulation would fix. Simulating from uncalibrated guesses produces false statistical confidence, not more accuracy — see [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md). If testing shows simulation doesn't improve predictions, don't build it.

## Phase 8 — Decision Interface — **DONE (2026-08-12)**

Goal: make the information useful during a frantic auction. Answer "should I bid, and how high" at a glance: current value, expected price, range, your max, demand, remaining bidders, recommendation (buy/neutral/overpay), and the plain-language "why" behind any value change.

- [x] "On the Board" panel: player search (type a name, click a match) + a decision card with current value, expected price, range, your max, demand (bidders), and recommendation, color-coded by BUY/NEUTRAL/OVERPAY.
- [x] Plain-language "why" (`src/lib/explanation.ts`) — generates sentences from the same underlying factors already computed in Phases 2-6, not a separate model.
- [x] Existing detailed tables (teams, economy, scarcity, full player list) kept below the decision panel, unchanged — still useful for transparency/verification, not removed.

**Deliberately not built:** auto-detecting the current nomination from Sleeper's `metadata.hovered_player_id` field. Its exact semantics are unverified and can only really be tested against a genuinely live draft, which hasn't happened yet — logged in [IDEAS.md](IDEAS.md) rather than built on an unconfirmed assumption. Manual search is the reliable, verified interaction for now.

**Verified in-browser:** selected Jahmyr Gibbs via search, decision card showed $61 current value / $61 expected / $37-$85 range / 12 bidders / NEUTRAL — matching the detailed table exactly — with correctly-reasoned explanation text ("12 of 12 teams still need a starting RB, with 25 comparable RBs left worth drafting").

## Phase 9 — Historical Data & Calibration — **DONE (2026-08-12)**

Goal: make the model better without overfitting. Bring in historical auction results (this league's prior season, via `previous_league_id`) to investigate prediction accuracy, position-specific systematic behavior, and persistent league tendencies — blended with the general model via shrinkage, not trained from scratch on 1-2 drafts. See [MODELING.md](MODELING.md) calibration section.

**Caveat specific to this league:** all available historical data predates keepers. This season's economics will genuinely differ. Lean harder toward the neutral default than the shrinkage approach would normally suggest for an established non-keeper league.

- [x] Checked how much comparable history actually exists, rather than assuming the whole `previous_league_id` chain was usable: 2023 and 2024 used a completely different roster format (single-QB, K/DEF, 14 slots) than 2025/2026's 2QB/SuperFlex 16-slot format. Only 2025 is structurally comparable — `sameRosterFormat()` excludes the rest explicitly.
- [x] Ran the static baseline methodology against 2025's real projections/settings and compared to that season's actual 192 sale prices (`src/lib/historicalAccuracy.ts`, "Historical Model Accuracy" section in the app).
- [x] **Decision: no constants changed.** One historical draft doesn't justify shrinkage-adjusting anything meaningfully away from documented defaults, consistent with the anti-overfitting principle above.

**Findings (real, not anecdotal):** overall correlation 0.91, MAE $4.56 across all 192 picks. RB and TE show excellent correlation (0.97, 0.98) — good validation the Layer 1 market-clearing FLEX fix is working. **QB is the clear weak point** (correlation 0.89, MAE $8.21) — but the aggregate number undersells what's actually happening: drilling into individual picks showed the top 6 QBs sold for a mean of **+$7.50** over prediction (each individually $19-$31 over) while the remaining 21 sold for a mean of **-$2.62** under prediction. Not a uniform bias — a scarcity **cliff** at the startable/non-startable QB boundary that smooth points-based VOR doesn't capture. See [MODELING.md](MODELING.md) for the full pick-by-pick breakdown. Not patched — this needs a shape change to the QB value curve near the cliff, not a single tunable constant, and one data point isn't enough to design that responsibly. Flagged as a precise, evidence-based target for revisiting once the actual 2026 draft provides a second data point.

## Phase 10 — Backtesting — **DONE (2026-08-12)**

Goal: prove whether this actually works, as honestly as the data allows. Replay historical auctions pick-by-pick, predicting at each point without hindsight, and compare predicted vs. actual price. Compare the full model against simpler baselines (static cheat sheet, simple inflation-only, VOR alone) — if the complicated model doesn't beat the simple ones, don't use the complicated model.

**Honest limitation:** with only one clean pre-keeper historical draft realistically available for this league, this is not a rigorous held-out validation (Phase 9 calibration and Phase 10 testing would draw on the same limited data) — treat this phase as a sanity/regression check rather than proof, and don't let a good backtest result on thin data justify more model complexity than the data can actually support.

- [x] Point-in-time replay engine (`src/lib/backtest.ts`) — at each pick, only picks strictly before it are known, no hindsight. Three tiers compared: static baseline, +league-wide inflation, full model.

**Results, reported honestly rather than spun positive:** full model beats static on all 3 metrics (MAE $4.34 vs $4.56, MAPE 48% vs 52%, correlation 0.93 vs 0.91) but doesn't cleanly beat the simpler inflation-only tier (which had *better* correlation, 0.96, though much worse MAPE, 72%) — not a clean "more complexity wins" story. Per-position breakdown is the real payoff: full model clearly helps RB and WR, is roughly neutral for QB (doesn't fix the Layer 2 cliff — expected, that needs a shape change not a scaling one), and **actively hurts TE** — TE had the best static accuracy (correlation 0.98) and got worse (0.97) with the dynamic adjustment applied, traced to TE's thin sample size (only 26 picks total in the draft) making the position-inflation estimate unreliable early in a replay. See [MODELING.md](MODELING.md) for full numbers and the well-motivated (but not-yet-implemented) sample-size-weighting fix this suggests, logged in [IDEAS.md](IDEAS.md).

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
