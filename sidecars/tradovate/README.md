# Tradovate GC Sidecar

This is a read-only Tradovate Partner API market data sidecar for GC. It writes futures-compatible JSONL rows to `RITHMIC_GC_JSONL_PATH` so the main analysis service can ingest futures data without connecting directly to Tradovate.

## Official Tradovate Points Used

- Demo REST base: `https://demo.tradovateapi.com/v1`
- Live REST base: `https://live.tradovateapi.com/v1`
- Market data WebSocket: `wss://md.tradovateapi.com/v1/websocket`
- Access token request: `POST /auth/accesstokenrequest`
- Token lifetime is documented as 90 minutes; the sidecar renews before expiry and avoids frequent new sessions.
- Quote subscription endpoint: `md/subscribeQuote`
- Market data frames use `e="md"` and quote entries such as `Bid.price`, `Offer.price`, `Trade.price`, and `TotalTradeVolume.size`.

## Environment

Store these values in `.env.sidecar` for staging or `/quant/calc/config/xau-sidecars.env` for production systemd. Do not commit either file.

```dotenv
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

Demo credentials are still secrets.

## GC Contract

Set `TRADOVATE_GC_CONTRACT` to the active GC futures contract, for example `GCM6`. Confirm the contract is listed and that the API user has market data entitlement for that venue.

## Output Schema

```json
{
  "timestampMs": 1770000000000,
  "symbol": "GC",
  "contract": "GCM6",
  "bid": 2350.1,
  "ask": 2350.2,
  "last": 2350.1,
  "volume": 12
}
```

If only `Trade.price` is present, the sidecar can write a last-only row. The main system will score quality accordingly.

The sidecar does not call order, liquidation, position, or account trading endpoints.
