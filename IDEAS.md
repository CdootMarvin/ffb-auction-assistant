# Ideas — Parking Lot

Things that came up during design discussion and are worth remembering, but are explicitly **not** part of V1. Don't implement anything here without first moving it into [ROADMAP.md](ROADMAP.md) as a deliberate decision.

- **Monte Carlo simulation** of auction outcomes, once real historical bid data exists to calibrate distribution parameters. See [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) for why this was deferred rather than built first.
- **Behavioral/strategy inference per manager** — detecting stars-and-scrubs vs. balanced spending patterns, year-over-year behavior shifts (e.g. "everyone overpays early this year because they remember last year's bargains").
- **Statistical/ML model of bidder behavior**, if a much larger dataset ever becomes available (multiple leagues, many seasons).
- **Multi-league / cross-league historical data pooling** for calibration, as a way to get more signal than one league's history provides.
- **League-wide sharing** — letting other managers in the league use the tool (would need to consider fairness/information-asymmetry implications).
- **Offline support / PWA** — not needed since Sleeper API access requires internet regardless.
- **Mobile-first UI polish** — responsive layout is in scope for V1; a dedicated mobile experience is not.
- **Voice or faster input methods** for marking nominations/prices during a fast-moving live auction.
- **Post-draft analysis view** — how actual results compared to model predictions, roster grade, etc.
