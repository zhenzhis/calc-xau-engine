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
  │   ├── engine.ts            analyzeGold() — returns-based multi-factor model:
  │   │                        Multi-TF trend, VR regime, vol-normalized momentum,
  │   │                        Bayesian confidence, logistic breakout probability,
  │   │                        actionable signal (entry/stop/target/R:R)
  │   └── types.ts             GoldAnalysis, GoldPublishState, TradingSignal
  │
  ├── discord/
  │   └── webhook.ts           Embed builder (Chinese-language) + HTTP POST
  │                            Multi-TF table, key levels ladder, quant dashboard
  │
  ├── runtime/
  │   ├── service.ts           BroadcastService — session-aware polling + event triggers
  │   ├── market-hours.ts      CME Globex gold sessions (Asian/London/US-Overlap/US-PM)
  │   └── state-store.ts       PublishStateStore — JSON file persistence for dedup
  │
  ├── lib/
  │   ├── http.ts              getJson() with timeout, exponential backoff + jitter
  │   ├── logger.ts            Level-gated console logger
  │   └── math.ts              Classical: EMA, SMA, RSI, stddev, pseudo-ATR, Z-score,
  │                            Hurst exponent, sigmoid, normalCdf
  │                            Advanced: logReturns, realizedVol, varianceRatio,
  │                            autoCorrelation, KAMA, bollingerBands, resample, linRegSlope
  │
  └── cli/
      └── dry-run.ts           Standalone CLI: fetch → seed buffer → analyze → print
```

### Key Data Flow

1. **Poll** (session-adaptive: 30s–120s): `GoldPriceClient.fetchQuote()` hits Yahoo Finance GC=F.
2. **Buffer**: Push price to 512-point rolling buffer. On startup, seed from 1-min intraday candles.
3. **Analyze**: `analyzeGold()` computes:
   - Log returns → realized volatility, variance ratio, autocorrelation
   - Multi-timeframe resampling (5m, 15m) → per-TF trend, RSI, EMA alignment
   - 8-factor model: EMA cross, normalized momentum, level proximity, vol score, zone influence, Hurst bias, VR bias, TF confluence
   - Evidence-based confidence, logistic breakout probability
   - Actionable signal: entry, stop-loss, targets, R:R
4. **Publish gate** (session-adaptive: 5min–30min, or immediate on event):
   - Triggers: regime change, trend reversal, zone breach, level breach, vol regime shift
   - Build Discord embed, POST to webhook
5. **Persist**: `PublishStateStore` writes last-publish JSON. `PriceBuffer` persists for warm restart.

### Quantitative Model

- **Returns-based**: All volatility/momentum computed on log returns, not raw prices
- **Multi-timeframe**: 1m, 5m, 15m trend confluence with weighted alignment
- **Variance ratio**: Lo-MacKinlay VR(5) test for trending vs mean-reverting regime
- **Normalized momentum**: ROC / realized_vol (sigma units, comparable across vol regimes)
- **Evidence-based confidence**: Accumulates evidence from data quality + factor clarity → sigmoid mapping
- **Logistic breakout model**: Trend, momentum, VR, zone influence, level proximity → sigmoid probability
- **Adaptive proximity**: ATR-scaled sigma for level proximity weights

### Session Schedule (ET)

| Session | Time | Poll | Publish | Liquidity |
|---------|------|------|---------|-----------|
| Asian | 18:00→03:00 | 120s | 30min | Low |
| London | 03:00→08:30 | 60s | 15min | High (LBMA) |
| US-Overlap | 08:30→12:00 | 30s | 5min | Peak |
| US Afternoon | 12:00→17:00 | 60s | 15min | Medium |
| Maintenance | 17:00→18:00 | — | — | Closed |

### Level Grid

Static levels derived from chart analysis (TradingView XAUUSD). Each level has a `category` field (`extreme`, `zone-edge`, `transition`, `pivot`, `indicator`, `key-support`, `deep`) that drives weighted scoring in targets and breakout probability. Update `src/levels/grid.ts` when market structure evolves.

### Design Constraints

- Yahoo Finance GC=F provides free, no-auth gold futures data.
- Price buffer persists to disk — service restarts don't lose indicator history.
- CME Globex gold hours: Sun 18:00 → Fri 17:00 ET, daily 17:00-18:00 maintenance break.

## Production Deployment

Runs as a systemd service on Ubuntu alongside `gexbot-state-discord`. Directory layout:

- Code: `/quant/calc/calc-xau-engine`
- Config: `/quant/calc/config/xau-state-discord.env`
- State: `/quant/calc/data/xau-state-discord/` (last-publish.json, price-buffer.json)

Service template at `deploy/systemd/xau-state-discord.service`.

## Environment Variables

Required: `DISCORD_WEBHOOK_URL`. All others have defaults — see `.env.example`.
