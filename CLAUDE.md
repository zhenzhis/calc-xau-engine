# CLAUDE.md

## What This Is

XAUUSD quantitative state analysis Discord broadcaster (`xau-state-discord`). Polls gold futures (GC=F) via Yahoo Finance, runs a multi-factor scoring engine against a static level grid derived from chart analysis, and publishes structured alerts to Discord via webhook.

Naming follows the `calc-*-engine` / `*-state-discord` convention shared with `calc-gex-engine` / `gexbot-state-discord`.

## Commands

```bash
npm run build                 # tsc compile (src/ → dist/)
npm run start                 # build + run broadcaster
npm run dev                   # alias for start
npm run dry-run               # build + fetch → analyze → print JSON (no Discord)
npm run dry-run -- --publish  # same + publish to Discord
```

## Architecture

```
main.ts                        Entry point — config, client, store, service
  ├── config.ts                Loads RuntimeConfig from env vars
  ├── types.ts                 RuntimeConfig type
  │
  ├── data/
  │   └── client.ts            GoldPriceClient — Yahoo Finance GC=F fetcher
  │                            PriceBuffer — 512-point rolling window + disk persist
  │
  ├── levels/
  │   └── grid.ts              Static level grid (exact chart extraction)
  │                            PriceLevel (category-typed), PriceZone, query functions
  │
  ├── analysis/
  │   ├── engine.ts            analyzeGold() — EMA/RSI/ATR/Z-Score/Hurst,
  │   │                        regime detection, trend scoring, breakout probability,
  │   │                        category-weighted target computation, R:R calculation
  │   └── types.ts             GoldAnalysis, GoldPublishState
  │
  ├── discord/
  │   └── webhook.ts           Embed builder (Chinese-language) + HTTP POST
  │
  ├── runtime/
  │   ├── service.ts           BroadcastService — poll loop (60s) + publish gate (15min)
  │   ├── market-hours.ts      CME Globex gold trading hours (Sun 18:00 → Fri 17:00 ET)
  │   └── state-store.ts       PublishStateStore — JSON file persistence for dedup
  │
  ├── lib/
  │   ├── http.ts              getJson() with timeout, exponential backoff + jitter
  │   ├── logger.ts            Level-gated console logger
  │   └── math.ts              EMA, SMA, RSI, stddev, pseudo-ATR, Z-score,
  │                            Hurst exponent, sigmoid, normalCdf
  │
  └── cli/
      └── dry-run.ts           Standalone CLI: fetch → seed buffer → analyze → print
```

### Key Data Flow

1. **Poll** (every 60s): `GoldPriceClient.fetchQuote()` hits Yahoo Finance GC=F chart endpoint.
2. **Buffer**: Push price to 512-point rolling buffer. On startup, seed from 1-min intraday candles.
3. **Analyze**: `analyzeGold()` computes 6-factor model: EMA cross, momentum ROC, level proximity (category-weighted), volatility, zone influence, Hurst bias.
4. **Publish gate** (every 15min or on regime/trend change): Build Discord embed, POST to webhook.
5. **Persist**: `PublishStateStore` writes last-publish JSON for dedup. `PriceBuffer` persists to disk for warm restart.

### Level Grid

Static levels derived from chart analysis (TradingView XAUUSD). Each level has a `category` field (`extreme`, `zone-edge`, `transition`, `pivot`, `indicator`, `key-support`, `deep`) that drives weighted scoring in targets and breakout probability. Update `src/levels/grid.ts` when market structure evolves.

### Design Constraints

- Yahoo Finance GC=F provides free, no-auth gold futures data.
- Price buffer persists to disk — service restarts don't lose indicator history.
- CME Globex gold hours: Sun 18:00 → Fri 17:00 ET, daily 17:00-18:00 maintenance break.
- Publish triggers: (1) 15-min interval elapsed, (2) regime change, (3) trend change.

## Production Deployment

Runs as a systemd service on Ubuntu alongside `gexbot-state-discord`. Directory layout:

- Code: `/quant/calc/calc-xau-engine`
- Config: `/quant/calc/config/xau-state-discord.env`
- State: `/quant/calc/data/xau-state-discord/` (last-publish.json, price-buffer.json)

Service template at `deploy/systemd/xau-state-discord.service`.

## Environment Variables

Required: `DISCORD_WEBHOOK_URL`. All others have defaults — see `.env.example`.
