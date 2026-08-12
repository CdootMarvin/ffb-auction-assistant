# Architecture

## Decision

Browser-based single-page application. TypeScript + React + Vite, deployed as a static site to GitHub Pages. No backend, no database. See [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) for the full comparison against a local desktop app and a Python/TypeScript hybrid, and why browser-only won.

## Why this works here (and why no backend is needed)

Sleeper's public API is read-only and requires no API key or auth token. There is no secret to hide, which removes the usual reason to put a backend between the client and a third-party API. The browser can call Sleeper directly.

Live draft updates are handled by polling Sleeper's picks endpoint on an interval (Sleeper has no public websocket for third parties) — this is standard practice for third-party Sleeper tools.

## Major Components

1. **Sleeper data layer** — fetches/polls league, users, rosters, draft, picks, and the players database. Normalizes Sleeper's raw shapes into the app's internal model.
2. **Projections import** — parses a user-supplied CSV of season projections/rankings into the internal player model, since Sleeper doesn't provide this.
3. **League state model** — derived, recomputed on every poll: remaining players per position, remaining budget/roster-slots per team, money spent so far, picks history. Initialized from a **post-keeper** starting state, not a clean full-budget/full-pool state — this league has keepers for the first time this year, so kept players, their cost, and their roster-slot impact must be subtracted before pick 1 is even considered. See [MODELING.md](MODELING.md) Layer 0. How keepers are represented in this league's Sleeper data is not yet confirmed.
4. **Valuation engine** — pure functions, no side effects, operating only on the league state model. See [MODELING.md](MODELING.md) for the actual formulas. Kept isolated from the UI and from Sleeper-specific data shapes so it's independently testable.
5. **Explanation generator** — turns the valuation engine's intermediate factors (inflation index, scarcity, bidder count, etc.) into the plain-language "why" text.
6. **UI** — live player table, current-nomination detail panel, team budget/roster tracker.
7. **Local persistence** — `localStorage`/IndexedDB for imported projections and in-progress draft session state, so a page refresh mid-draft doesn't lose state.

## Data Flow (live draft)

```
Sleeper API (poll every few seconds)
   -> Sleeper data layer (normalize picks/rosters/budgets)
   -> League state model (derive remaining players, team budgets/needs)
   -> Valuation engine (VOR -> inflation -> scarcity -> bidder count -> value + range)
   -> Explanation generator (factors -> plain-language reasons)
   -> UI (table + detail panel + team tracker)
```

## Confirmed League Facts (verified against real league 1389362840074199040, 2026-08-12)

- 12 teams, $200 auction budget/team, 16 rounds.
- **2QB / SuperFlex**: roster requires a dedicated QB slot *and* a SUPER_FLEX slot — QB scarcity/demand is materially higher than a standard single-QB league. This must be reflected in replacement-level and positional-scarcity calculations, not treated as a generic single-QB league.
- Roster positions: QB, RB, RB, WR, WR, TE, FLEX, FLEX, SUPER_FLEX, BN×7. Reserve slots: 2.
- Keepers: max 2 per team, native Sleeper support (see [MODELING.md](MODELING.md) Layer 0 for cost formula and data path). Keeper deadline is 7 days before draft.
- Historical chain confirmed: `previous_league_id` → prior season's league → prior season's completed auction draft, usable both for keeper cost lookups and for backtesting/calibration.

## Data Sources

**From Sleeper (no auth key needed):**
- `/league/{league_id}` — settings, budget, roster requirements
- `/league/{league_id}/users`, `/league/{league_id}/rosters` — teams
- `/draft/{draft_id}`, `/draft/{draft_id}/picks` — draft settings and live picks (poll this)
- `/players/nfl` — full player database (cache; refetch rarely, not per poll)
- `api.sleeper.com/projections/nfl/{season}?season_type=regular&position[]={pos}` — season-long projected points (PPR/half-PPR/standard) and ADP. **Undocumented** (not in Sleeper's official API docs), confirmed working via live test 2026-08-12, but could change or disappear without notice since it's unofficial.
- Prior-season league chain via `previous_league_id`, if present — source of historical draft data for calibration

**Fallback only (not primary):** manual CSV import of projections/rankings (e.g. FantasyPros), used only if the undocumented Sleeper projections endpoint stops working.

**Computed locally:** VOR, remaining budgets/slots, positional scarcity, inflation index, realistic bidder set, dynamic value, ranges, explanations.

## Storage

No database. `localStorage`/IndexedDB in the browser only, scoped to the user's own session. Historical draft data pulled for calibration is treated as static data (fetched from Sleeper, cached locally or committed as a data file), not a live database.

## Deployment

GitHub repo → GitHub Pages via the standard Vite build + Pages deploy workflow. $0. No custom domain required (optional later).

## Known Open Items (verify empirically, see [ROADMAP.md](ROADMAP.md) Phase 0)

- ~~Confirm Sleeper API CORS headers permit direct browser `fetch` calls.~~ **Confirmed 2026-08-12** — league/users/rosters/draft/picks endpoints all fetch successfully directly from the browser (tested against both a real completed draft and the real current pre-draft league), no CORS errors.
- Confirm Sleeper's rate limits comfortably accommodate a multi-second polling interval during a live draft — 3s polling used in Phase 1 with no issues so far, but not yet tested across a full multi-hour live draft.
- Confirm the undocumented projections endpoint also permits direct browser `fetch` (CORS) — still untested from the browser; not needed until Phase 2.
- ~~Determine how this league represents keepers in Sleeper's data.~~ **Confirmed** — see [MODELING.md](MODELING.md) Layer 0 and Phase 1 verification in [ROADMAP.md](ROADMAP.md).
