# Contributing — Workflow for Future (AI-Assisted) Sessions

This project is developed across multiple sessions with an AI coding assistant. The product owner is not a programmer and relies on these documents being accurate and current. Follow this workflow every session:

1. **Read the project documents first**: [PROJECT_SPEC.md](PROJECT_SPEC.md), [ARCHITECTURE.md](ARCHITECTURE.md), [ROADMAP.md](ROADMAP.md), [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md), [MODELING.md](MODELING.md), this file, and [IDEAS.md](IDEAS.md).
2. **Inspect the existing code** before assuming anything about current state.
3. **Explain the plan** for this session in plain English before writing code.
4. **Identify potential problems** with the plan up front.
5. **Wait for explicit approval** before any major architectural decision (anything that would need a new [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) entry, a new dependency, or a deviation from [ARCHITECTURE.md](ARCHITECTURE.md)).
6. **Implement only the requested milestone** from [ROADMAP.md](ROADMAP.md) — don't jump ahead or bundle in adjacent work.
7. **Test the implementation**: unit tests on valuation math where applicable, manual verification for UI/integration work.
8. **Explain what changed**, in plain language.
9. **Update relevant documentation** — especially [ROADMAP.md](ROADMAP.md) status and [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) if any decision was made.
10. **Give a concise manual test list** — exactly what the product owner should check by hand.

## Hard rules

- Do not rewrite unrelated parts of the application.
- Do not introduce new dependencies without explaining why, in plain English, and getting agreement first.
- Do not silently change the architecture described in [ARCHITECTURE.md](ARCHITECTURE.md) — propose it as a decision, get approval, then update the doc.
- Keep the valuation math (in [MODELING.md](MODELING.md)) and its code implementation in sync — if you change one, update the other in the same session.
- New feature ideas that come up mid-session but aren't the current milestone go into [IDEAS.md](IDEAS.md), not into the current change.
