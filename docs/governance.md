# Governance

This repository follows the Institutional Quant Infrastructure Governance standards maintained in zhenzhis/quant-knowledge-vault.

## Required Operating Rules

- Keep repo AGENTS.md short and executable; complex policy belongs in checked-in docs.
- Report outcomes as Implemented, Verified, Not verified, Failed, and Blocked.
- Do not claim GitHub branch protection, required checks, or CODEOWNERS enforcement is active until verified against GitHub.
- Do not commit secrets, .env, env backups, data dumps, caches, runtime state, logs, SQLite runtime DBs, or generated artifacts.
- Do not use git add .; stage exact allowlisted paths only.

## Quant Boundaries

- Research outputs are observations, states, evidence, and limitations.
- Research cards are not trade instructions.
- Scenario weights are not probabilities unless calibration is registered and verified.
- Missing, stale, or unavailable provider data must be visible; do not silently convert it to neutral evidence.

## Repository Class

- Repository: calc-xau-engine
- Governance class: xau_engine
- GitHub enforcement status: Not verified
