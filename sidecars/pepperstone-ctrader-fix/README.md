# Pepperstone cTrader FIX XAU Sidecar

This sidecar connects to a cTrader FIX **Price Connection** and writes XAUUSD bid/ask quotes to JSONL. It does not use Trade Connection credentials and does not implement order messages.

## Official cTrader FIX Points Used

- cTrader FIX supports FIX.4.4.
- Messages use SOH (`\x01`) delimiters.
- `BodyLength(9)` and `CheckSum(10)` are calculated for every outbound message.
- Session messages include Logon (`35=A`), Heartbeat (`35=0`), Test Request (`35=1`), Logout (`35=5`), and Reject (`35=3`).
- Market data uses Market Data Request (`35=V`), Snapshot/Full Refresh (`35=W`), Incremental Refresh (`35=X`), and Market Data Request Reject (`35=Y`).
- Price and Trade credentials are separate. Use Price Connection credentials for this sidecar.
- `Symbol(55)` must be the broker-specific cTrader FIX symbol ID, not the text `XAUUSD`.

## Get Credentials

In cTrader, open settings and select FIX API. Copy the **Price Connection** host, port, username, password, sender/target IDs, and sender sub ID. Do not use Trade Connection credentials.

To find the XAUUSD FIX symbol ID, open the XAUUSD symbol information panel in cTrader and copy the FIX symbol ID from the symbol info section. Symbol IDs can differ by broker.

## Environment

Store these values in `.env.sidecar` for local staging or `/quant/calc/config/xau-sidecars.env` for production systemd. Do not commit either file.

```dotenv
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
PEPPERSTONE_XAU_JSONL_PATH=/quant/calc/data/xau-state-discord/pepperstone-xau.jsonl
PEPPERSTONE_MAX_SPREAD=5
```

## Start

```bash
npm run sidecar:pepperstone
```

## Common Errors

- `invalid checksum`: body length or checksum calculation is wrong, or message bytes were altered in transit.
- `wrong SenderCompID`: the sender comp ID must match the exact cTrader Price Connection value.
- `wrong symbol ID`: `55` must be the numeric FIX symbol ID from cTrader symbol info.
- `DateTime not UTC`: `SendingTime(52)` must be UTC.
- duplicate reports: cTrader can duplicate FIX reports when multiple connections are open simultaneously.
- no heartbeat response while quotes are streaming: cTrader FAQ states this is expected for quote feeds.
