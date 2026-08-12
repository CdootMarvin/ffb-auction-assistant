# Design Decisions

Append-only log of significant architectural/modeling decisions and the reasoning behind them. When a future session reconsiders one of these, add a new entry rather than editing history — note what changed and why.

---

## 2026-08-12 — Browser app (TS/React/Vite/GitHub Pages), not desktop or hybrid

**Decision:** V1 is a client-side browser app only. No Python backend, no local desktop app, no dual-stack hybrid.

**Why:**
- Sleeper's public API is read-only, needs no auth key — there's no secret to protect, which removes the usual reason to add a backend.
- Simulation/computation load at this problem's scale (~200 players, ~12 teams) is trivial for JavaScript; the assumption that this needs Python for performance was evaluated and rejected.
- Browser app wins decisively on cost ($0, no hosting to manage), device reach (laptop + phone/tablet with no install), and future league-sharing (send a URL vs. asking non-technical leaguemates to install Python and dependencies).
- A hybrid (Python for research, TS for the live app) was considered and rejected for V1: it would require manually keeping valuation formulas in sync across two languages/codebases, a maintenance burden not justified at current historical-data scale. Revisit only if serious multi-league statistical modeling becomes necessary later.

**Uncertain / to verify:** Sleeper API CORS behavior from a browser origin, and rate limits under live polling. Not yet empirically confirmed — Phase 0 task.

---

## 2026-08-12 — Deterministic/heuristic valuation in V1, Monte Carlo deferred

**Decision:** V1 valuation engine uses closed-form formulas (VOR, inflation index, positional scarcity, rule-based bidder count) plus a heuristic range. No Monte Carlo simulation.

**Why:** Monte Carlo only adds value if fed calibrated bid-distribution parameters; without real historical data to calibrate from, a simulation would produce a statistically-dressed-up version of the same guesses a simpler heuristic range already encodes — false rigor, not more accuracy. Revisit once (a) real historical draft data exists for calibration, and (b) the simpler model's ranges are observed (via backtesting) to be wrong in a way simulation would actually fix.

---

## 2026-08-12 — Rule-based realistic-bidder model, not statistical

**Decision:** "Is this team a realistic bidder for this player" is computed via explicit filter rules (position need, budget headroom, roster-slot headroom), not a fitted statistical/ML model.

**Why:** Not enough historical data to fit such a model reliably, and a black-box model would break the explicit self-explanation requirement in [PROJECT_SPEC.md](PROJECT_SPEC.md). Deeper behavioral inference (roster-strategy detection) is parked in [IDEAS.md](IDEAS.md).

---

## 2026-08-12 — Corrected: Sleeper does provide projections (undocumented endpoint), manual CSV import demoted to fallback

**Original decision (same day, superseded within the session):** assumed Sleeper's public API doesn't provide projections and required a manual CSV import.

**Correction:** That assumption was wrong and was stated without verification — caught when the product owner asked "are you sure?" A live fetch confirmed `api.sleeper.com/projections/nfl/{season}?season_type=regular&position[]={pos}` returns real season-long projected points (PPR/half-PPR/standard) and ADP, no auth required. Sample verified: 2026 RB projections returned correctly (e.g. Jahmyr Gibbs, 299.9 half-PPR points).

**New decision:** use this endpoint as the primary projections source. Keep manual CSV import as a documented fallback only, not the default path.

**Why it's still worth being cautious:** this endpoint is not in Sleeper's official documentation (only `/players` and `/players/trending` are documented) — it could change or be removed without notice. Don't build the projections import path in a way that makes swapping in the CSV fallback difficult if that happens.

**Lesson for future sessions:** verify API/library claims empirically (fetch it, run it) rather than stating them from memory, especially when a claim becomes a load-bearing architectural assumption. This instance is a concrete example of why — a plausible-sounding "Sleeper doesn't have X" was false and had already been written into four project documents before being checked.

---

## 2026-08-12 — Keeper-aware starting state required (first keeper year for this league)

**Decision:** the "pre-draft static value" concept, as originally designed, assumed a clean full-budget/full-player-pool baseline. This league has keepers for the first time this season, which breaks that assumption — some players and money/roster slots are already committed before the auction starts. Added a new Layer 0 to [MODELING.md](MODELING.md): treat keepers as pre-auction purchases (remove player from pool, subtract cost from that team's budget, subtract the roster slot), and compute everything else — including what's displayed as "pre-draft value" — from that post-keeper state.

**Why:** without this, the displayed "pre-draft value" would be actively wrong from the moment the app is opened, not just increasingly wrong as the draft progresses — which is the exact problem this whole project exists to fix, just moved earlier in the timeline.

**Uncertain / must verify empirically before Phase 1 can implement this, do not assume:**
- How this specific league's keepers are represented in Sleeper's API data.
- The league's keeper cost formula — this is a league-rule fact only the user can supply, not something the API alone can answer.

**Calibration impact:** the historical drafts available for this league all predate keepers, so this season's economics (total spendable money, positional distribution) will genuinely differ from that history. Historical calibration constants should lean more heavily toward the neutral default this season than usual.

**Resolved 2026-08-12** (same day, after checking the real league, ID `1389362840074199040`): confirmed Sleeper tracks keepers natively per roster (`keepers` array on each roster object, `max_keepers: 2`), but does not store their cost. User's cost rule: `max(round(last_season_price * 1.2), 5)`, or flat `$5` if the player has no prior-season auction price (e.g. a waiver pickup, in-season trade acquisition, or rookie not in last year's league). Last season's price is looked up via the `previous_league_id` chain to the prior draft. Also discovered while checking this league: it's a **2QB/SuperFlex** league, not standard single-QB — recorded in [ARCHITECTURE.md](ARCHITECTURE.md) "Confirmed League Facts" since it materially changes QB scarcity math and was not something to assume generically.

**Operational note:** keeper declarations are changeable until the deadline (7 days before draft in this league) — the app must re-fetch close to draft day, not cache an early read. Only 3 of 12 teams had declared keepers as of the 2026-08-12 check.
