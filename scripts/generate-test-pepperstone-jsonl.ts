import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

const outputPath = process.env.PEPPERSTONE_XAU_JSONL_PATH ?? ".runtime/discord-test/pepperstone-xau.jsonl";
const rows = Math.max(1, Math.floor(numberFromEnv("TEST_PEPPERSTONE_ROWS", 80)));
const base = numberFromEnv("TEST_PEPPERSTONE_BASE", 2350);
const spread = numberFromEnv("TEST_PEPPERSTONE_SPREAD", 0.2);

if (spread <= 0) {
  throw new Error("TEST_PEPPERSTONE_SPREAD must be greater than zero");
}

const now = Date.now();
const lines = Array.from({ length: rows }, (_, index) => {
  const offset = rows - 1 - index;
  const timestampMs = now - offset * 60_000;
  const mid = base + Math.sin(index / 8) * 2 + index * 0.03;
  return JSON.stringify({
    timestampMs,
    symbol: "XAUUSD",
    bid: Number((mid - spread / 2).toFixed(2)),
    ask: Number((mid + spread / 2).toFixed(2)),
    feed: "synthetic_test",
    sidecar: "test-generator",
    sessionVerified: false,
    testData: true
  });
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(JSON.stringify({
  outputPath,
  rows,
  feed: "synthetic_test",
  testData: true,
  warning: "synthetic test data; not for trading"
}));
