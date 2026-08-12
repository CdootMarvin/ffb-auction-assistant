# Project Spec — Fantasy Football Auction Assistant

## Problem

Traditional fantasy auction cheat sheets give static, preseason player values. Actual auction economics shift dramatically as the draft happens — money spent, positions depleted, and manager behavior all change what a player is really worth *right now*, mid-draft. Existing tools don't track this live.

## Goal

During a live Sleeper auction draft, tell the user what each remaining player is actually worth given the current state of the auction — and explain why — so they can make better real-time bid decisions.

## Users

The product owner (Chris), for personal use in their own Sleeper league's live auction draft. Sharing with the league is a possible future step, not a V1 requirement.

## Core Requirements (V1)

- Connect to a Sleeper league/draft (read-only, public API, no auth key).
- Pull season projections from Sleeper's undocumented projections endpoint (manual CSV import as fallback only).
- Account for keepers (first year for this league) before computing any "pre-draft" value — remove kept players from the pool and subtract their cost/roster impact from each team's starting budget/slots. There is no clean full-pool baseline this year; see [MODELING.md](MODELING.md) Layer 0.
- Compute pre-draft (post-keeper) static values (VOR-based) for all rostered-relevant players.
- Track live draft picks, prices, remaining team budgets, and remaining roster slots as the draft happens.
- Recompute dynamic current-market value per remaining player as the draft progresses, accounting for league-wide and positional money/talent inflation.
- Estimate realistic bidder count per player and produce a value range, not just a point estimate.
- Explain each valuation in plain language (which factors moved it, and why).
- Run entirely client-side, $0 cost to operate.

## Non-Goals (V1)

- Monte Carlo simulation (see [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) and [MODELING.md](MODELING.md) for why this is deferred).
- Behavioral/strategy inference (stars-and-scrubs detection, etc.).
- Multi-league or cross-league historical calibration.
- League-wide sharing / multi-user accounts.
- Offline support / PWA.
- Mobile-optimized UI (responsive is fine; mobile-first polish is not a priority).
- Any paid backend, database, or AI API for normal operation.

## Success Criteria

- The tool is usable start-to-finish during a real live Sleeper auction draft without crashing or falling behind the live picks feed.
- Backtested against at least one real historical draft, the dynamic value estimates are meaningfully closer to actual sale prices than the static pre-draft values alone.
- The user can look at any player mid-draft and understand *why* the current value is what it is, without needing to ask.
- Total operating cost: $0.

## Constraints

- Zero-cost hosting and operation (GitHub Pages + free-tier services only).
- No programmer maintaining this day-to-day except via AI-assisted sessions — code and docs must stay simple enough for that workflow to work reliably (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- Sleeper API is read-only and public; no server-side secret to protect.

## Key Dependency (corrected 2026-08-12)

Season fantasy point projections **are** available from Sleeper, via an undocumented endpoint (`api.sleeper.com/projections/nfl/{season}`, confirmed working live — see [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md)) that returns PPR/half-PPR/standard projected points and ADP. This is not in Sleeper's official documentation, so it could change or break without notice. Primary plan: use it directly, no manual import needed. Fallback: manual CSV import (e.g. FantasyPros) stays available as a backup path if the undocumented endpoint stops working.

## Second Key Dependency — Keeper data (resolved 2026-08-12)

This is the league's first keeper year (league ID `1389362840074199040`). Confirmed against the real league: Sleeper tracks keepers natively per roster (`keepers` array, max 2 per team), but not their cost. Cost formula per user: last season's auction price × 1.2, rounded to the nearest dollar, minimum $5; if the player has no prior-season auction price, flat $5. Full mechanism and formula documented in [MODELING.md](MODELING.md) Layer 0. Keeper declarations remain changeable until the league's keeper deadline, so this must be re-fetched close to draft day, not cached from an early check.
