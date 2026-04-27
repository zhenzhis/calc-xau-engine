# Tradovate GC Sidecar

This sidecar is a read-only Tradovate market data adapter for GC. It writes futures-compatible JSONL rows to `RITHMIC_GC_JSONL_PATH` so the main system can use the same futures ingest path.

Official Tradovate documentation checked for this implementation:

- REST demo/live URLs: `https://demo.tradovateapi.com/v1`, `https://live.tradovateapi.com/v1`
- Market data WebSocket: `wss://md.tradovateapi.com/v1/websocket`
- Auth endpoint: `/auth/accesstokenrequest`
- WebSocket protocol: `endpoint\nrequest_id\nheaders\nbody`
- Market data subscription: `md/subscribeQuote`
- Market data frames: `e="md"` with quote entries such as `Bid`, `Offer`, `Trade`, and `TotalTradeVolume`

## Environment

Store these values in `/quant/calc/config/xau-sidecars.env` or process environment. Do not commit them.

```dotenv
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
JSONL_MAX_BYTES=52428800
```

Demo credentials are still credentials and must be treated as secrets.

## Output

Rows use the existing futures schema:

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

If a market data update only contains `Trade`, the sidecar can write a last-only row. Bid/ask rows are preferred when available.

## Runtime Behavior

- requests an access token,
- resolves the configured GC contract,
- connects to the market data WebSocket,
- authorizes the socket,
- subscribes to `md/subscribeQuote`,
- writes valid market data updates to JSONL,
- reconnects with exponential backoff up to `TRADOVATE_MAX_RECONNECT_MS`,
- logs a heartbeat every 30 seconds.

The sidecar does not call order, position, liquidation, or account trading endpoints.
