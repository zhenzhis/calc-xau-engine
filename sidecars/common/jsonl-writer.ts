import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { getNumberEnv } from "./env.js";

export interface AppendJsonlOptions {
  maxBytes?: number;
  retries?: number;
  retryDelayMs?: number;
  logger?: Pick<Console, "error" | "warn">;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

export async function appendJsonl(
  filePath: string,
  object: unknown,
  options: AppendJsonlOptions = {},
): Promise<void> {
  const logger = options.logger ?? console;
  const maxBytes = options.maxBytes ?? getNumberEnv("JSONL_MAX_BYTES", DEFAULT_MAX_BYTES, { min: 0 });
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const line = `${JSON.stringify(object)}\n`;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await rotateIfNeeded(filePath, maxBytes);
      await appendFile(filePath, line, "utf8");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        JSON.stringify({
          event: "jsonl_write_failed",
          filePath,
          attempt,
          retries,
          error: message,
        }),
      );
      if (attempt === retries) {
        throw error;
      }
      await sleep(retryDelayMs * attempt);
    }
  }
}

async function rotateIfNeeded(filePath: string, maxBytes: number): Promise<void> {
  if (maxBytes <= 0) {
    return;
  }

  let size = 0;
  try {
    size = (await stat(filePath)).size;
  } catch (error) {
    if (isMissingFile(error)) {
      return;
    }
    throw error;
  }

  if (size < maxBytes) {
    return;
  }

  const archiveDir = join(dirname(filePath), "archive");
  await mkdir(archiveDir, { recursive: true });
  const rotatedPath = join(archiveDir, `${timestampForFile()}-${basename(filePath, extname(filePath))}${extname(filePath)}`);
  await rename(filePath, rotatedPath);
  console.warn(JSON.stringify({ event: "jsonl_rotated", filePath, rotatedPath, size, maxBytes }));
}

function timestampForFile(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
