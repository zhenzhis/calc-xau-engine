# Market Data Sidecars

Sidecars are read-only market data adapters. They write JSONL files that the main `xau-state-discord` process already knows how to ingest.

Current low-cost production route is Pepperstone cTrader FIX as broker-primary. In that mode Discord will show `BROKER PRIMARY` and `FUTURES FLOW UNKNOWN`; the system must not describe broker spot quotes as COMEX futures flow.

## Security Rules

- Do not commit credentials.
- Do not commit `.env.sidecar` or production env files.
- Treat demo credentials as production secrets.
- Load credentials from `.env.sidecar`, `/quant/calc/config/xau-sidecars.env`, or process environment.
- Sidecars must not place orders. They are market-data only.
- The main system does not connect directly to broker APIs.
- Logs redact fields containing `password`, `token`, `secret`, `sec`, `accessToken`, or `mdAccessToken`.

## Environment Files

For local staging:

```bash
cp .env.sidecar.example .env.sidecar
```

For production, create the env file outside the repository:

```bash
sudo mkdir -p /quant/calc/config
sudo install -m 600 /dev/null /quant/calc/config/xau-sidecars.env
sudo editor /quant/calc/config/xau-sidecars.env
```

Example structure:

```dotenv
JSONL_MAX_BYTES=52428800

PEPPERSTONE_XAU_JSONL_PATH=/quant/calc/data/xau-state-discord/pepperstone-xau.jsonl
PEPPERSTONE_MAX_SPREAD=5
CTRADER_FIX_HOST=
CTRADER_FIX_PORT=
CTRADER_FIX_SSL=true
CTRADER_FIX_USERNAME=
CTRADER_FIX_PASSWORD=
CTRADER_FIX_SENDER_COMP_ID=
CTRADER_FIX_TARGET_COMP_ID=CSERVER
CTRADER_FIX_SENDER_SUB_ID=QUOTE
CTRADER_FIX_TARGET_SUB_ID=QUOTE
CTRADER_FIX_HEARTBEAT_SEC=30
CTRADER_FIX_RESET_SEQ_NUM=true
CTRADER_FIX_SYMBOL_ID_XAUUSD=

TRADOVATE_ENV=demo
TRADOVATE_USERNAME=
TRADOVATE_PASSWORD=
TRADOVATE_APP_ID=
TRADOVATE_APP_VERSION=1.0
TRADOVATE_CID=
TRADOVATE_SEC=
TRADOVATE_GC_CONTRACT=GCM6
TRADOVATE_MAX_RECONNECT_MS=60000
RITHMIC_GC_JSONL_PATH=/quant/calc/data/xau-state-discord/rithmic-gc.jsonl
```

## Start Sidecars

For the current broker-primary route, start only Pepperstone:

```bash
npm run sidecar:pepperstone
```

Do not start Tradovate unless paid API access and market data entitlement are confirmed. Rithmic is not implemented without official SDK/proto files.

Tradovate remains available as an explicit futures sidecar only after paid API access is confirmed:

```bash
npm run sidecar:tradovate
```

One-shot credential smoke tests:

```bash
npm run sidecar:pepperstone -- --once
npm run sidecar:tradovate -- --once
```

`--once` connects, authenticates, subscribes, writes the first valid quote row, then exits. It fails with a non-zero exit code if no valid quote arrives before `CTRADER_FIX_ONCE_TIMEOUT_MS` or `TRADOVATE_ONCE_TIMEOUT_MS`.

Run each sidecar under a process manager such as systemd. They log JSON events and emit a heartbeat every 30 seconds.

Production systemd can load `/quant/calc/config/xau-sidecars.env` directly. Do not hardcode credentials in package scripts.

```ini
EnvironmentFile=/quant/calc/config/xau-sidecars.env
WorkingDirectory=/quant/calc/calc-xau-engine
ExecStart=/usr/bin/node --env-file-if-exists=/quant/calc/config/xau-sidecars.env dist/sidecars/pepperstone-ctrader-fix/pepperstone-xau-fix-sidecar.js
```

## Check Ingest

```bash
npm run check:ingest
npm run check:ingest -- --strict
```

The command reads the last five rows from the futures and Pepperstone JSONL files and prints:

- `pepperstone_ok`
- `futures_ok`
- `pepperstone_age_ms`
- `futures_age_ms`
- `pepperstone_spread`
- `futures_last`
- diagnostic `messages`

Missing files or stale rows are reported as `false` health with a message, not hidden as success. In `DATA_PRIMARY=broker` with `--strict`, only Pepperstone is required; missing futures emits `futures unavailable; broker-primary mode active` and does not fail strict mode. In other modes, failed required feeds set a non-zero exit code.

## Confirm Discord Is No Longer Fallback

For broker-primary, after the Pepperstone JSONL feed is fresh, run:

```bash
npm run dry-run
```

With `DATA_PRIMARY=broker`, the Discord payload should show `BROKER PRIMARY` and `FUTURES FLOW UNKNOWN`. It should no longer show Yahoo as the primary source. It may still show Yahoo GC=F as a reference or fallback when enabled.

Free or low-cost routes do not provide confirmed COMEX real-time tick, DOM, volume, or open-interest flow. Those fields remain unavailable unless a confirmed futures feed is added.

## Synthetic Test Data

For local Discord or dry-run tests, generate an explicitly marked synthetic Pepperstone JSONL file:

```bash
npm run generate:test-pepperstone
```

Rows produced by this helper include `feed=synthetic_test`, `sidecar=test-generator`, `sessionVerified=false`, and `testData=true`. The main analysis caps this feed to low quality and blocks trade permission. Synthetic data is only for pipeline testing and must not be used for trading decisions.

## Stale Data Handling

The main system uses `MAX_TICK_AGE_MS` and source health scoring to mark stale feeds. If `check:ingest` reports stale ages:

- confirm the sidecar process is running,
- inspect the JSON heartbeat logs,
- verify cTrader FIX / Tradovate API connectivity,
- verify market data entitlements,
- verify the JSONL path matches the main runtime env.

## JSONL Rotation

Set `JSONL_MAX_BYTES` to rotate active JSONL files. Rotation moves the current file into an `archive/` directory beside the active file. Rotation failures are surfaced by the sidecar main loop instead of being silently ignored.

## Node Runtime

The package requires Node.js `>=20`. Tradovate uses native `globalThis.WebSocket` on Node 22+ and falls back to the `ws` package on Node 20.
