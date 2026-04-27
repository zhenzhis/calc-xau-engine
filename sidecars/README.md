# Market Data Sidecars

Sidecars are read-only market data adapters. They write JSONL files that the main `xau-state-discord` process already knows how to ingest.

## Security Rules

- Do not commit credentials.
- Do not commit `.env.sidecar` or any sidecar env file.
- Treat demo credentials as production secrets.
- Load credentials from `/quant/calc/config/xau-sidecars.env` or process environment.
- Sidecars must not place orders. They are market-data only.
- The main system does not connect directly to broker APIs.

## Environment File

Create the production env file outside the repository:

```bash
sudo mkdir -p /quant/calc/config
sudo install -m 600 /dev/null /quant/calc/config/xau-sidecars.env
sudo editor /quant/calc/config/xau-sidecars.env
```

Example structure:

```dotenv
JSONL_MAX_BYTES=52428800

PEPPERSTONE_XAU_JSONL_PATH=/quant/calc/data/xau-state-discord/pepperstone-xau.jsonl
PEPPERSTONE_QUOTE_URL=http://127.0.0.1:8787/pepperstone/xau
PEPPERSTONE_POLL_MS=1000
PEPPERSTONE_MAX_SPREAD=5

TRADOVATE_ENV=demo
TRADOVATE_USERNAME=
TRADOVATE_PASSWORD=
TRADOVATE_APP_ID=
TRADOVATE_APP_VERSION=
TRADOVATE_CID=
TRADOVATE_SEC=
TRADOVATE_GC_CONTRACT=GCM6
RITHMIC_GC_JSONL_PATH=/quant/calc/data/xau-state-discord/rithmic-gc.jsonl
TRADOVATE_MAX_RECONNECT_MS=60000
```

## Start Sidecars

```bash
npm run sidecar:pepperstone
npm run sidecar:tradovate
```

Run each sidecar under a process manager such as systemd. They log JSON events and emit a heartbeat every 30 seconds.

## Check Ingest

```bash
npm run check:ingest
```

The command reads the last five rows from the futures and Pepperstone JSONL files and prints:

- `futures_ok`
- `pepperstone_ok`
- `futures_age_ms`
- `pepperstone_age_ms`
- latest futures price
- Pepperstone mid and spread

Missing files or stale rows are reported as `false` health, not hidden as success.

## Confirm Discord Is No Longer Fallback

After both JSONL feeds are fresh, run:

```bash
npm run dry-run
```

The Discord payload should no longer show `FALLBACK DATA`. It should show live primary data health and Pepperstone broker quote status. If Pepperstone is stale or absent, the title can show `BROKER QUOTE MISSING`.

## Stale Data Handling

The main system uses `MAX_TICK_AGE_MS` and source health scoring to mark stale feeds. If `check:ingest` reports stale ages:

- confirm the sidecar process is running,
- inspect the JSON heartbeat logs,
- verify bridge/API connectivity,
- verify the JSONL path matches the main runtime env.

## JSONL Rotation

Set `JSONL_MAX_BYTES` to rotate active JSONL files. Rotation moves the current file into an `archive/` directory beside the active file. Rotation failures are logged and surfaced by the sidecar instead of being silently ignored.
