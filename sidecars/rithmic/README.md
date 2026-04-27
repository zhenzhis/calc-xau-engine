# Rithmic Sidecar

Direct Rithmic integration is intentionally not implemented in this repository.

Rithmic requires official R | API / SDK access and local user-provided documentation or binaries. This project must not guess or reverse engineer private Rithmic protocols.

Any future Rithmic sidecar must:

- use official Rithmic SDK/API documentation supplied locally by the user,
- keep credentials outside the repository,
- remain read-only market data ingest,
- write rows to `RITHMIC_GC_JSONL_PATH`,
- preserve the existing futures JSONL schema:

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
