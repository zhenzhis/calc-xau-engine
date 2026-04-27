import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendJsonl } from "./jsonl-writer.js";

test("appendJsonl writes one valid JSON line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xau-jsonl-"));
  const filePath = join(dir, "feed.jsonl");

  await appendJsonl(filePath, { timestampMs: 1, bid: 10, ask: 11 });

  const text = await readFile(filePath, "utf8");
  assert.equal(text.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(text.trim()), { timestampMs: 1, bid: 10, ask: 11 });
});

test("appendJsonl rotates when JSONL_MAX_BYTES limit is exceeded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xau-jsonl-"));
  const filePath = join(dir, "feed.jsonl");
  await writeFile(filePath, `${JSON.stringify({ old: true })}\n`, "utf8");

  await appendJsonl(filePath, { fresh: true }, { maxBytes: 10 });

  const archiveFiles = await readdir(join(dir, "archive"));
  assert.equal(archiveFiles.length, 1);
  assert.match(archiveFiles[0], /^feed-\d{8}-\d{6}\.jsonl$/);
  const active = await readFile(filePath, "utf8");
  assert.deepEqual(JSON.parse(active.trim()), { fresh: true });
});
