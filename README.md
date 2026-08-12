# Fantasy Football Auction Assistant

A live-auction-draft assistant that connects to the Sleeper API and computes dynamic, in-draft player values — accounting for money spent, positional scarcity, roster needs, and realistic bidder competition — instead of relying on static preseason cheat-sheet values.

Client-side only (TypeScript + React + Vite), deployed free on GitHub Pages, no backend/database/paid API required.

## Start here

Read these before making any change — they're the source of truth for what this project is and how it should be built:

- [`PROJECT_SPEC.md`](PROJECT_SPEC.md) — what this is, for whom, and what's explicitly out of scope.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system components, data sources, confirmed league facts.
- [`ROADMAP.md`](ROADMAP.md) — the phased build plan and current status.
- [`DESIGN_DECISIONS.md`](DESIGN_DECISIONS.md) — the record of why things are built the way they are.
- [`MODELING.md`](MODELING.md) — the valuation math.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow for AI-assisted sessions working on this repo.
- [`IDEAS.md`](IDEAS.md) — parking lot for deferred ideas.

## Development

```bash
npm install
npm run dev
```

## Deployment

Push to `main` — a GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and publishes to GitHub Pages automatically.
