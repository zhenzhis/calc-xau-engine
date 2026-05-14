# AGENTS.md

This file gives Codex concise operating guidance for calc-xau-engine.

## Repository Role

calc-xau-engine is classified as xau_engine in the Institutional Quant Infrastructure Governance Mission.

## Required Workflow

- Read docs/governance.md before governance, release, research, data, factor, model, card, replay, or production-boundary changes.
- Keep edits inside the requested scope and allowed governance paths unless the user explicitly approves an exception.
- Do not add trade execution, broker order routing, or directive trading language to research repositories.
- Do not commit secrets, .env, env backups, runtime state, logs, caches, data dumps, SQLite runtime DBs, or generated artifacts.
- Use exact-path staging only; never use git add .

## Verification Reporting

Final reports must distinguish Implemented, Verified, Not verified, Failed, and Blocked. Do not report unverified success.
