# Rithmic Sidecar

Direct Rithmic protocol integration is intentionally not implemented in this repository.

The official Rithmic API page lists:

- R | API+,
- R | Protocol API,
- R | Diamond API.

R | Protocol API is documented by Rithmic as a WebSocket + Google Protocol Buffers interface. Implementing it correctly requires official SDK/proto files, entitlement details, and broker-approved API access. This repository must not guess or reverse engineer private protocol messages.

Future implementation requirements:

- use official Rithmic SDK/proto files supplied locally by the user,
- keep credentials outside the repository,
- remain read-only market data ingest,
- write rows to `RITHMIC_GC_JSONL_PATH`,
- preserve this futures JSONL schema:

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

TODO: implement after the user provides official Rithmic SDK/proto files and entitlement documentation.
