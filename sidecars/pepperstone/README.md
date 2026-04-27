# Pepperstone XAU Sidecar

This sidecar implements HTTP quote bridge mode for Pepperstone XAUUSD. It does not log in to cTrader or MT5 directly. A local bridge process must expose a read-only endpoint.

## Bridge Endpoint

Default URL:

```text
http://127.0.0.1:8787/pepperstone/xau
```

Response schema:

```json
{
  "bid": 2349.82,
  "ask": 2350.05,
  "timestampMs": 1770000000000
}
```

`timestampMs` is optional. If omitted, the sidecar uses local receipt time.

## Environment

```dotenv
PEPPERSTONE_XAU_JSONL_PATH=/quant/calc/data/xau-state-discord/pepperstone-xau.jsonl
PEPPERSTONE_QUOTE_URL=http://127.0.0.1:8787/pepperstone/xau
PEPPERSTONE_POLL_MS=1000
PEPPERSTONE_MAX_SPREAD=5
JSONL_MAX_BYTES=52428800
```

## Validation

The sidecar writes only quotes with:

- numeric `bid` and `ask`,
- `ask > bid`,
- spread less than or equal to `PEPPERSTONE_MAX_SPREAD`.

HTTP errors, invalid payloads, and write failures are logged as JSON events. The process keeps retrying.
