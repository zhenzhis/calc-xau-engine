# Contributing

This repository uses institutional quant governance.

## Commit Standard

Use Conventional Commits:

<type>(<scope>): <imperative summary>

Recommended types: feat, fix, refactor, test, docs, chore, ci, build, perf, security, release, revert.

## PR Requirements

Every PR must include objective, scope, changed files, risk classification, verification performed, not verified items, failures, blocked items, GitHub settings requiring manual verification, and rollback plan.

## Safety Rules

- No secrets, .env, env backups, data dumps, logs, caches, runtime files, SQLite runtime DBs, or generated artifacts.
- No git add .; stage exact paths only.
- Governance changes must not include business logic unless explicitly justified.
- Research output must not become trade execution instructions.
